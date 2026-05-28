"""Pull live tournament results from the public ESPN scoreboard JSON.

Active only during the WC26 tournament window (11 Jun – 19 Jul 2026).
The workflow gates calls outside the window; this script also guards
itself in case it gets run manually too early.

ESPN scoreboard endpoint:
  https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard
Public, undocumented but stable; returns ESPN's `events` list with team
names and scores.
"""
from __future__ import annotations

import datetime as dt
import sys

from _common import ScrapeError, load_json, log, polite_get, save_json, update_meta

SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
WINDOW_START = dt.date(2026, 6, 11)
WINDOW_END = dt.date(2026, 7, 20)

STAGE_KEYS = {
    "group": "group_stage",
    "round_of_32": "round_of_32",
    "round_of_16": "round_of_16",
    "quarterfinal": "quarterfinals",
    "semifinal": "semifinals",
    "third-place": "third_place",
    "final": "final",
}


def in_window(today: dt.date) -> bool:
    return WINDOW_START <= today <= WINDOW_END


def fetch_events() -> list[dict]:
    try:
        res = polite_get(SCOREBOARD, accept_json=True)
        data = res.json()
    except (ScrapeError, ValueError) as e:
        log(f"results: {e}")
        return []
    return data.get("events", [])


def classify_stage(event: dict) -> str:
    name = (event.get("season", {}).get("type", {}).get("name") or "").lower()
    short = (event.get("name") or "").lower()
    for k, v in STAGE_KEYS.items():
        if k in name or k in short:
            return v
    return "group_stage"


def main() -> int:
    today = dt.date.today()
    if not in_window(today):
        log(f"results: outside tournament window ({today}); skipping")
        return 0

    events = fetch_events()
    if not events:
        log("results: no events returned; skipping")
        return 0

    actual = load_json("actual_results.json")
    changed = 0
    for ev in events:
        comp = (ev.get("competitions") or [None])[0]
        if not comp:
            continue
        if (comp.get("status", {}).get("type", {}).get("state") or "") != "post":
            continue  # only completed matches
        competitors = comp.get("competitors") or []
        if len(competitors) != 2:
            continue
        ta = competitors[0]["team"]["displayName"]
        tb = competitors[1]["team"]["displayName"]
        sa = int(competitors[0].get("score", 0))
        sb = int(competitors[1].get("score", 0))
        winner = ta if sa > sb else tb if sb > sa else None
        stage_key = classify_stage(ev)
        bucket = actual.setdefault(stage_key, {})
        key = f"{ta}__vs__{tb}"
        rec = {
            "team_a": ta, "team_b": tb,
            "score_a": sa, "score_b": sb,
            "winner": winner,
            "completed_at": ev.get("date"),
        }
        if bucket.get(key) != rec:
            bucket[key] = rec
            changed += 1

    actual["last_updated"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    save_json("actual_results.json", actual)
    if changed:
        update_meta()
    log(f"results: {changed} match record(s) updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
