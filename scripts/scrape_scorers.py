#!/usr/bin/env python3
"""Top scorers per team. Live-only — runs every 2 h during the tournament.

Pre-tournament this leaves the file as {} so the UI surfaces "no tournament
goals yet". During the WC we pull top-3 scorers per qualified team from ESPN's
soccer-team JSON.

Output:
  data/scorers.json — { "Team Name": [ { name, goals, club }, ... ] }

continue-on-error friendly, rate-limited.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import polite_get, ScrapeError, log, DATA_DIR  # type: ignore


def load(name: str):
    p = DATA_DIR / name
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save(name: str, data) -> None:
    # Atomic + ASCII (repo on-disk convention; staleness watchdog compares diffs).
    path = DATA_DIR / name
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(data, ensure_ascii=True, indent=2) + "\n", encoding="utf-8"
    )
    tmp.replace(path)


def main() -> int:
    out = load("scorers.json")
    if not isinstance(out, dict):
        out = {}
    teams = load("teams.json")
    if not isinstance(teams, dict):
        return 0

    # Snapshot the team rows (excluding __meta__) so we only bump updated_at —
    # and only rewrite the file — when real scorer data changed. A no-op bump
    # would make scorers.json look fresh forever and defeat the staleness check.
    before = {k: v for k, v in out.items() if k != "__meta__"}

    # Gate to the tournament window (FIFA cron-side does this too but
    # double-guard so manual `workflow_dispatch` runs during normal weeks
    # don't pollute the file with junk).
    today = datetime.now(timezone.utc).date()
    if today < datetime(2026, 6, 11, tzinfo=timezone.utc).date():
        log("scorers: pre-tournament; leaving file empty (no updated_at bump)")
        return 0

    refreshed = 0
    for team in teams:
        try:
            res = polite_get(
                f"https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams?search={team}",
                accept_json=True,
            )
            tdata = res.json()
        except (ScrapeError, ValueError):
            continue
        teams_arr = ((tdata.get("sports") or [{}])[0].get("leagues") or [{}])[0].get("teams") or []
        tid = None
        for entry in teams_arr:
            t = (entry or {}).get("team") or {}
            if (t.get("name") or "").lower() == team.lower():
                tid = t.get("id")
                break
        if not tid:
            continue
        try:
            sres = polite_get(
                f"https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams/{tid}/statistics?season=2026",
                accept_json=True,
            )
            sdata = sres.json()
        except (ScrapeError, ValueError):
            continue
        athletes = sdata.get("athletes") or []
        scorers = []
        for a in athletes:
            ath = (a or {}).get("athlete") or {}
            goals = None
            for stat in (a or {}).get("statistics") or []:
                if (stat.get("name") or "").lower() == "goals":
                    try:
                        goals = int(stat.get("value"))
                    except (TypeError, ValueError):
                        pass
                    break
            if goals is None or not ath.get("displayName"):
                continue
            scorers.append({
                "name": ath.get("displayName"),
                "goals": goals,
                "club": (ath.get("team") or {}).get("displayName"),
            })
        scorers.sort(key=lambda r: r["goals"], reverse=True)
        if scorers:
            out[team] = scorers[:3]
            refreshed += 1

    after = {k: v for k, v in out.items() if k != "__meta__"}
    if after == before:
        log("scorers: no data change; leaving updated_at untouched")
        return 0
    out.setdefault("__meta__", {})
    out["__meta__"]["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    save("scorers.json", out)
    log(f"scorers: refreshed {refreshed} teams")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        log(f"scorers: fatal — {e}; continuing")
        raise SystemExit(0)
