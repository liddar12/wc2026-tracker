#!/usr/bin/env python3
"""Injury / availability tracker — builds a dedicated data/injuries.json feed.

Why a separate file?
  `update_squads.py` flips a player's inline `injury_status` field inside
  players.json. This script materialises a *standalone* injuries feed that the
  UI (and future endpoints) can read without walking the whole player roster,
  grouped by team and timestamped.

Sources we try, in order (all best-effort, robots-respecting, rate-limited):
  1. ESPN World Cup 2026 squad-tracker article (HTML) — same source the squad
     scraper uses; we scan a window around each known player name for injury
     keywords.
  2. The current inline `injury_status` already present in players.json — this
     guarantees injuries.json is never *less* complete than the roster, even if
     every network source is down.

Output:
  data/injuries.json
    {
      "__meta__": { "updated_at": ISO-8601, "source": "espn+roster" },
      "by_team":  { "Team Name": [
          { "player": str, "position": str, "club": str,
            "status": str, "note": str, "source": str }
      ] },
      "count": int
    }

Conventions (mirrors the other scrapers):
  * Respects robots.txt + per-host rate limit + identifying UA via _common.
  * Logs to stderr and ALWAYS exits 0 — a dead source must never fail the build.
  * Idempotent: re-running with no source changes rewrites the same shape.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import ScrapeError, load_json, log, polite_get, save_json  # type: ignore

ESPN_TRACKER = (
    "https://www.espn.com/soccer/world-cup-2026/story/_/id/_/"
    "world-cup-2026-squad-tracker"
)

# Keyword -> normalised status. Order matters (first match wins).
STATUS_KEYWORDS = (
    ("ruled out", "Out"),
    ("out injured", "Out"),
    ("season-ending", "Out"),
    ("withdrawn", "Out"),
    ("withdraws", "Out"),
    ("suspended", "Suspended"),
    ("doubtful", "Doubtful"),
    ("questionable", "Doubtful"),
    ("injury doubt", "Doubtful"),
    ("knock", "Doubtful"),
)


def fetch_article(url: str) -> str:
    """Pull the squad-tracker article HTML. Returns "" on any failure."""
    try:
        return polite_get(url).text
    except ScrapeError as e:
        log(f"injuries: source unavailable ({e})")
        return ""
    except Exception as e:  # network/parse — stay alive
        log(f"injuries: unexpected source error ({e})")
        return ""


def classify(window: str) -> str | None:
    """Return a normalised status for the first injury keyword in `window`."""
    low = window.lower()
    for kw, status in STATUS_KEYWORDS:
        if kw in low:
            return status
    return None


def build() -> dict:
    try:
        players = load_json("players.json")
    except Exception as e:
        log(f"injuries: cannot read players.json ({e}); writing empty feed")
        players = []
    if not isinstance(players, list):
        players = []

    article = fetch_article(ESPN_TRACKER)

    by_team: dict[str, list[dict]] = {}
    count = 0
    for p in players:
        if not isinstance(p, dict):
            continue
        name = p.get("name")
        team = p.get("team")
        if not name or not team:
            continue

        status: str | None = None
        note = ""
        source = ""

        # 1) Article-derived status (preferred — carries context).
        if article:
            idx = article.lower().find(name.lower())
            if idx >= 0:
                window = article[max(0, idx - 220): idx + 220]
                derived = classify(window)
                if derived:
                    status = derived
                    source = "espn"
                    snippet = " ".join(window.split())
                    note = snippet[:160]

        # 2) Fall back to the inline roster flag so the feed is never thinner
        #    than players.json itself.
        if status is None and p.get("injury_status"):
            status = str(p["injury_status"])
            source = "roster"

        if status is None:
            continue

        by_team.setdefault(team, []).append({
            "player": name,
            "position": p.get("position", ""),
            "club": p.get("club", ""),
            "status": status,
            "note": note,
            "source": source,
        })
        count += 1

    return {
        "__meta__": {
            "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "espn+roster",
        },
        "by_team": dict(sorted(by_team.items())),
        "count": count,
    }


def main() -> int:
    feed = build()
    save_json("injuries.json", feed)
    log(f"injuries: wrote {feed['count']} entries across {len(feed['by_team'])} teams")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:  # last-resort guard — never fail the workflow
        log(f"injuries: fatal — {e}; continuing")
        raise SystemExit(0)
