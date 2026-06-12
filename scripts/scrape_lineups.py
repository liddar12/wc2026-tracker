#!/usr/bin/env python3
"""Starting lineups from ESPN's match-summary rosters → data/lineups.json.

REWRITE (June 11): the original scraped ESPN fixture HTML pages
(window.espn.preloadedData), which never yielded data — lineups.json shipped
as {} and the freshness panel showed "never". ESPN's public summary API
exposes full rosters (jersey, position, starter flags, formation) per event,
the same endpoint family the results/h2h scrapers already use.

For each match in data/schedule_full.json kicking off within
[now - 26h, now + 2h] (post-game backfill + the ~75-min-pre-kickoff window):
  scoreboard(date) → event id by team-set → summary(event) → rosters.starters

Output (consumed by app/components/lineups.js — shape unchanged):
  { "<A__vs__B>": {
      "team_a": { "xi": ["Name", ...], "formation": "4-2-3-1" },
      "team_b": { ... },
      "updated_at": "ISO"
    }, ..., "__meta__": { "updated_at": "ISO", "source": "espn-summary" } }

Failures leave existing data untouched; always exits 0.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SB = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary"
UA = {"User-Agent": "wc26-tracker/1.0", "Accept": "application/json"}
MIN_INTERVAL = 0.7
WINDOW_BACK_H, WINDOW_FWD_H = 26, 2

TEAM_RENAMES = {
    "United States": "USA", "South Korea": "Korea Republic", "Türkiye": "Turkiye",
    "Turkey": "Turkiye", "Czech Republic": "Czechia", "Cape Verde": "Cabo Verde",
    "Ivory Coast": "Cote d'Ivoire", "IR Iran": "Iran", "Congo DR": "DR Congo",
    "Bosnia & Herzegovina": "Bosnia and Herzegovina", "Bosnia-Herzegovina": "Bosnia and Herzegovina", "Curaçao": "Curacao",
}
_last = 0.0


def log(m): print(f"[lineups] {m}", file=sys.stderr, flush=True)


def norm(n):
    n = (n or "").strip()
    return TEAM_RENAMES.get(n, n)


def get(url):
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            _last = time.monotonic()
            return json.load(r)
    except Exception as e:  # noqa: BLE001
        _last = time.monotonic()
        log(f"GET fail {url[:64]}…: {e}")
        return None


def in_window(kick_iso, now):
    try:
        k = datetime.fromisoformat(str(kick_iso).replace("Z", "+00:00"))
    except ValueError:
        return False
    return now - timedelta(hours=WINDOW_BACK_H) <= k <= now + timedelta(hours=WINDOW_FWD_H)


def starters_for(summary, want_team):
    for block in summary.get("rosters") or []:
        team = norm((block.get("team") or {}).get("displayName"))
        if team != want_team:
            continue
        xi = []
        for entry in block.get("roster") or []:
            if not entry.get("starter"):
                continue
            name = (entry.get("athlete") or {}).get("displayName")
            if name:
                xi.append(name)
        if xi:
            side = {"xi": xi}
            if block.get("formation"):
                side["formation"] = block["formation"]
            return side
    return None


def main():
    now = datetime.now(timezone.utc)
    sched = json.loads((DATA / "schedule_full.json").read_text())
    rows = sched if isinstance(sched, list) else sched.get("matches", [])
    targets = [m for m in rows
               if m.get("team_a") and m.get("team_b") and in_window(m.get("kickoff_utc"), now)]
    if not targets:
        log("no matches in window")
        return 0

    try:
        out = json.loads((DATA / "lineups.json").read_text())
        if not isinstance(out, dict):
            out = {}
    except Exception:  # noqa: BLE001
        out = {}

    # event ids by team-set, one scoreboard call per involved date
    event_by_pair = {}
    for d in sorted({str(m.get("kickoff_utc"))[:10].replace("-", "") for m in targets}):
        data = get(f"{SB}?dates={d}")
        for ev in (data or {}).get("events", []):
            comp = (ev.get("competitions") or [{}])[0]
            names = [norm((c.get("team") or {}).get("displayName")) for c in comp.get("competitors", [])]
            names = [n for n in names if n]
            if len(names) == 2 and ev.get("id"):
                event_by_pair[frozenset(names)] = ev["id"]

    updated = 0
    for m in targets:
        a, b = m["team_a"], m["team_b"]
        eid = event_by_pair.get(frozenset((a, b)))
        if not eid:
            continue
        s = get(f"{SUMMARY}?event={eid}")
        if not s:
            continue
        side_a, side_b = starters_for(s, a), starters_for(s, b)
        if not side_a and not side_b:
            continue  # XIs not posted yet
        out[f"{a}__vs__{b}"] = {
            "team_a": side_a, "team_b": side_b,
            "updated_at": now.isoformat(timespec="seconds"),
        }
        updated += 1

    out.setdefault("__meta__", {})
    out["__meta__"].update({"updated_at": now.isoformat(timespec="seconds"), "source": "espn-summary"})
    (DATA / "lineups.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    log(f"lineups: {updated}/{len(targets)} matches updated")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}; keeping existing data")
        raise SystemExit(0)
