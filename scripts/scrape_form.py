#!/usr/bin/env python3
"""Recent form scraper — last 5 international results per qualified team.

Source: ESPN's public soccer-team JSON. Same caveats as other scrapers — it
4xxs at random and the response shape is undocumented. We probe, parse what
we can, and leave existing data alone on any failure.

Output:
  data/form.json — { "Team Name": [
      { date, opponent, score_a, score_b, result }, ...
    ] }

continue-on-error friendly. Rate-limited.
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
    teams = load("teams.json")
    out = load("form.json")
    if not isinstance(out, dict):
        out = {}
    if not isinstance(teams, dict):
        return 0

    # Snapshot the team rows (excluding __meta__) so we only bump updated_at —
    # and only rewrite the file — when real form data actually changed. A
    # no-op bump would otherwise make form.json look fresh forever and defeat
    # the staleness watchdog (P0-A2).
    before = {k: v for k, v in out.items() if k != "__meta__"}

    refreshed = 0
    for team in teams:
        # ESPN's intl team endpoint takes an opaque numeric id. Without a
        # name->id map we hit the public lookup endpoint first.
        try:
            res = polite_get(
                f"https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams?search={team}",
                accept_json=True,
            )
            data = res.json()
        except (ScrapeError, ValueError):
            continue
        teams_arr = ((data.get("sports") or [{}])[0].get("leagues") or [{}])[0].get("teams") or []
        tid = None
        for entry in teams_arr:
            t = (entry or {}).get("team") or {}
            if (t.get("name") or "").lower() == team.lower():
                tid = t.get("id")
                break
        if not tid:
            continue
        try:
            fres = polite_get(
                f"https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams/{tid}/schedule",
                accept_json=True,
            )
            fdata = fres.json()
        except (ScrapeError, ValueError):
            continue

        events = fdata.get("events") or []
        rows = []
        for ev in events:
            comps = ev.get("competitions") or []
            if not comps:
                continue
            comp = comps[0]
            comps_t = comp.get("competitors") or []
            if len(comps_t) != 2:
                continue
            home = comps_t[0]
            away = comps_t[1]
            sh = _to_int(home.get("score"))
            sa = _to_int(away.get("score"))
            if sh is None or sa is None:
                continue
            team_is_home = (home.get("team") or {}).get("displayName", "").lower() == team.lower()
            score_a = sh if team_is_home else sa
            score_b = sa if team_is_home else sh
            opp = (away.get("team") if team_is_home else home.get("team") or {}).get("displayName", "")
            result = "W" if score_a > score_b else ("L" if score_a < score_b else "D")
            rows.append({
                "date": (ev.get("date") or "").split("T")[0],
                "opponent": opp,
                "score_a": score_a,
                "score_b": score_b,
                "result": result,
            })
        rows.sort(key=lambda r: r["date"], reverse=True)
        if rows:
            out[team] = rows[:5]
            refreshed += 1

    after = {k: v for k, v in out.items() if k != "__meta__"}
    if after == before:
        log("form: no data change; leaving updated_at untouched")
        return 0
    out.setdefault("__meta__", {})
    out["__meta__"]["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    save("form.json", out)
    log(f"form: refreshed {refreshed} teams")
    return 0


def _to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        log(f"form: fatal — {e}; continuing")
        raise SystemExit(0)
