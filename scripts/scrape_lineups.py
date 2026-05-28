#!/usr/bin/env python3
"""Pull starting lineups + manager from ESPN match pages in the kickoff window.

Runs every 10 minutes under .github/workflows/pre_kickoff_update.yml. The
workflow gates this script to "is there a match starting in the next 90 min"
so most invocations should hit zero work.

For each upcoming match in data/schedule_full.json whose kickoff is between
NOW-30min and NOW+90min:

  1. Look up the ESPN fixture URL by querying ESPN's public search.
  2. Parse the lineup JSON embedded in the page (window.espn.preloadedData).
  3. Merge into data/lineups.json keyed by match_id.

If anything fails, leave existing data untouched and exit 0.

Output shape:
  { match_id: {
      team_a: { manager: "Name", xi: ["Player Name", ...] },
      team_b: { manager: "Name", xi: ["Player Name", ...] },
      updated_at: "ISO timestamp"
    },
    ...
  }
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
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
    (DATA_DIR / name).write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def in_kickoff_window(kickoff_iso: str) -> bool:
    try:
        k = datetime.fromisoformat(kickoff_iso.replace("Z", "+00:00"))
    except ValueError:
        return False
    now = datetime.now(timezone.utc)
    return now - timedelta(minutes=30) <= k <= now + timedelta(minutes=90)


def find_espn_url(team_a: str, team_b: str) -> str | None:
    """Best-effort ESPN fixture URL lookup. Returns None if anything fails."""
    q = f"site:espn.com {team_a} vs {team_b}"
    try:
        # ESPN's public search JSON.
        res = polite_get(
            f"https://search.espn.com/api/search/v1/q?query={team_a}+vs+{team_b}",
            accept_json=True,
        )
        data = res.json()
    except (ScrapeError, ValueError):
        return None
    for r in (data.get("results") or [])[:8]:
        href = r.get("url") or ""
        if "/soccer/match" in href:
            return href
    return None


def parse_lineup(html: str) -> dict | None:
    m = re.search(r"window\.espn\.preloadedData\s*=\s*(\{.*?\});\s*</script>", html, re.S)
    if not m:
        return None
    try:
        blob = json.loads(m.group(1))
    except json.JSONDecodeError:
        return None
    return blob


def extract_lineups(blob: dict) -> dict | None:
    """Best-effort traversal of ESPN's nested response. Returns
    {team_a: {manager, xi}, team_b: ...} or None on miss."""
    # ESPN buries the lineup deep in gamepackageJSON.rosters[].entries[].
    rosters = (
        blob.get("page", {})
        .get("content", {})
        .get("gamepackage", {})
        .get("rosters")
    )
    if not isinstance(rosters, list) or len(rosters) < 2:
        return None
    sides: list[dict] = []
    for r in rosters[:2]:
        manager = (r.get("manager") or {}).get("displayName")
        entries = r.get("entries") or r.get("roster") or []
        xi = [
            (e.get("athlete") or {}).get("displayName")
            for e in entries
            if (e.get("starter") or e.get("isStarter"))
        ]
        xi = [n for n in xi if n][:11]
        sides.append({"manager": manager, "xi": xi})
    if not (sides[0].get("xi") and sides[1].get("xi")):
        return None
    return {"team_a": sides[0], "team_b": sides[1]}


def main() -> int:
    schedule = load("schedule_full.json")
    lineups = load("lineups.json")
    if not isinstance(schedule, list):
        log("lineups: schedule_full.json malformed; skipping")
        return 0
    if not isinstance(lineups, dict):
        lineups = {}

    handled = 0
    for row in schedule:
        if not row.get("team_a") or not row.get("team_b"):
            continue
        if not in_kickoff_window(row.get("kickoff_utc", "")):
            continue
        mid = row["match_id"]
        url = find_espn_url(row["team_a"], row["team_b"])
        if not url:
            log(f"lineups: no ESPN url for {mid}")
            continue
        try:
            res = polite_get(url, accept_json=False)
        except ScrapeError as e:
            log(f"lineups: {mid}: {e}")
            continue
        blob = parse_lineup(res.text)
        if not blob:
            log(f"lineups: {mid}: page had no preloadedData; skipping")
            continue
        parsed = extract_lineups(blob)
        if not parsed:
            log(f"lineups: {mid}: no rosters in payload; skipping")
            continue
        parsed["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        lineups[mid] = parsed
        handled += 1
        log(f"lineups: {mid}: ok")

    save("lineups.json", lineups)
    log(f"lineups: {handled} match(es) refreshed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        log(f"lineups: fatal — {e}; continuing")
        raise SystemExit(0)
