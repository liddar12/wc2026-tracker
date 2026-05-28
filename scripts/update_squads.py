"""Update squad announcements + injury notes per team.

Sources we try, in order:
  1. ESPN squad-tracker article (HTML).
  2. Federation news pages — too many domains to enumerate generically.

This scraper is intentionally conservative: it only marks player `injury_status`
based on keyword matches in any article that names the player. If nothing is
found, we leave players unchanged.
"""
from __future__ import annotations

import re
import sys

from _common import ScrapeError, load_json, log, polite_get, save_json, update_meta

ESPN_TRACKER = "https://www.espn.com/soccer/world-cup-2026/story/_/id/_/world-cup-2026-squad-tracker"

INJURY_KEYWORDS = ("out injured", "ruled out", "withdrawn", "doubtful", "questionable")


def fetch_article(url: str) -> str:
    try:
        res = polite_get(url)
        return res.text
    except ScrapeError as e:
        log(f"squads: {e}")
        return ""


def main() -> int:
    text = fetch_article(ESPN_TRACKER)
    if not text:
        log("squads: no article; skipping")
        return 0

    players = load_json("players.json")
    changed = 0
    for p in players:
        name = p.get("name")
        if not name:
            continue
        idx = text.lower().find(name.lower())
        if idx < 0:
            continue
        window = text[max(0, idx - 200): idx + 200].lower()
        if any(k in window for k in INJURY_KEYWORDS):
            if p.get("injury_status") != "Injured":
                p["injury_status"] = "Injured"
                changed += 1
        else:
            # Don't clear an existing status from this scraper — too noisy.
            pass

    if changed:
        save_json("players.json", players)
        update_meta()
        log(f"squads: {changed} players flagged")
    else:
        log("squads: no changes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
