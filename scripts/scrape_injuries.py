#!/usr/bin/env python3
"""Injuries feed → data/injuries.json (by_team + __meta__).

REWRITE (2026-06-19): the old source (an ESPN squad-tracker story page) is a
hard 404, so this wrote 0 entries every run, silently, for the whole tournament
(docs/POSTMORTEM_2026-06-19.md, Track 1).

Investigation finding: ESPN publishes NO structured injury data for the World
Cup — the per-team injuries endpoints all return 200 with 0 items, and the
match summary carries no injuries block. So there is no automated source that
can flag e.g. Christian Pulisic as injured. The only reliable, automatically
available availability signal is SUSPENSIONS (red cards + accumulated yellows),
which we already capture in data/match_events.json.

This scraper therefore:
  1. Queries ESPN's per-team injuries endpoint for every WC team (correct URL,
     no 404) — future-proof: it populates if ESPN ever adds WC injury data.
  2. Records honest status in __meta__ (source + whether ESPN returned anything)
     so the staleness watchdog and the UI reflect reality instead of a dead 404.

Card SUSPENSIONS remain surfaced by the app from match_events (injuries-view's
Suspensions section); propagating those into the match view + model is the
recommended P1 (B2). Always exits 0.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "injuries.json"
TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams"
INJ_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams/{id}/injuries"
UA = {"User-Agent": "wc26-tracker/1.0", "Accept": "application/json"}
MIN_INTERVAL = 0.4

RENAMES = {
    "United States": "USA", "South Korea": "Korea Republic", "Türkiye": "Turkiye",
    "Czech Republic": "Czechia", "Cape Verde": "Cabo Verde", "Ivory Coast": "Cote d'Ivoire",
    "IR Iran": "Iran", "Congo DR": "DR Congo", "Bosnia & Herzegovina": "Bosnia and Herzegovina",
    "Bosnia-Herzegovina": "Bosnia and Herzegovina", "Curaçao": "Curacao",
}
_last = 0.0


def log(m): print(f"[injuries] {m}", file=sys.stderr, flush=True)
def norm(n): n = (n or "").strip(); return RENAMES.get(n, RENAMES.get(n.replace("-", " "), n))


def get(url):
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
            _last = time.monotonic()
            return json.load(r)
    except Exception as e:  # noqa: BLE001
        _last = time.monotonic()
        log(f"GET fail {url[-48:]}: {e}")
        return None


def team_ids():
    data = get(TEAMS_URL)
    out = {}
    for s in (data or {}).get("sports", []):
        for lg in s.get("leagues", []):
            for entry in lg.get("teams", []):
                t = entry.get("team", {})
                name = norm(t.get("displayName") or t.get("name"))
                if name and t.get("id"):
                    out[name] = t["id"]
    return out


def build():
    ids = team_ids()
    by_team = {}
    espn_count = 0
    for name, tid in sorted(ids.items()):
        data = get(INJ_URL.format(id=tid))
        items = (data or {}).get("injuries") or []
        entries = []
        for it in items:
            ath = (it.get("athlete") or {}).get("displayName")
            if not ath:
                continue
            entries.append({
                "player": ath,
                "position": ((it.get("athlete") or {}).get("position") or {}).get("abbreviation", ""),
                "status": it.get("status") or (it.get("type") or {}).get("description", "Out"),
                "injury": (it.get("details") or {}).get("type") or it.get("shortComment") or "Injury",
                "source": "espn",
            })
        if entries:
            by_team[name] = entries
            espn_count += len(entries)
    return {
        "__meta__": {
            "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "espn-team-injuries",
            "espn_entries": espn_count,
            "note": ("ESPN currently exposes no World Cup injury data; suspensions "
                     "(red/2-yellow) are surfaced from match_events. See "
                     "docs/POSTMORTEM_2026-06-19.md."),
        },
        "by_team": dict(sorted(by_team.items())),
        "count": espn_count,
    }


def main():
    feed = build()
    OUT.write_text(json.dumps(feed, ensure_ascii=False, indent=2) + "\n")
    log(f"injuries: {feed['count']} ESPN entries across {len(feed['by_team'])} team(s) "
        f"(ESPN WC injury data is currently empty — expected)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}")
        raise SystemExit(0)
