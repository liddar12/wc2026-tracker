#!/usr/bin/env python3
"""Per-match goals + cards from ESPN's summary keyEvents → data/match_events.json.

Powers the matchup-detail "Match events" timeline and the discipline panel
(yellow/red cards this game + tournament totals per player).

Window: matches kicking off within [now - 26h, now + 2h] — covers live games,
same-day backfill, and never touches older matches (their events are final).

Output:
  { "<A__vs__B>": {
      "events": [ { "minute": "9'", "type": "goal"|"own-goal"|"pen-goal"|
                    "yellow"|"red", "player": "Name", "team": "Mexico" }, ... ],
      "updated_at": "ISO"
    }, ..., "__meta__": { "updated_at": "ISO", "source": "espn-summary" } }

Failures keep existing data; always exits 0. Safe under continue-on-error.
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

# ESPN keyEvents type.text → our compact event type. Anything unmapped
# (Kickoff, Halftime, Substitution, Start Delay, …) is skipped.
EVENT_TYPES = {
    "Goal": "goal",
    "Goal - Header": "goal",
    "Goal - Free-kick": "goal",
    "Goal - Volley": "goal",
    "Own Goal": "own-goal",
    "Penalty - Scored": "pen-goal",
    "Yellow Card": "yellow",
    "Red Card": "red",
}
_last = 0.0


def log(m): print(f"[events] {m}", file=sys.stderr, flush=True)


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


def events_from(summary):
    out = []
    for e in summary.get("keyEvents") or []:
        raw = ((e.get("type") or {}).get("text") or "").strip()
        kind = EVENT_TYPES.get(raw)
        if not kind:
            continue
        player = ((e.get("participants") or [{}])[0].get("athlete") or {}).get("displayName")
        team = norm((e.get("team") or {}).get("displayName"))
        minute = (e.get("clock") or {}).get("displayValue") or ""
        if not player and not team:
            continue
        out.append({"minute": minute, "type": kind, "player": player or "", "team": team or ""})
    return out


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
        out = json.loads((DATA / "match_events.json").read_text())
        if not isinstance(out, dict):
            out = {}
    except Exception:  # noqa: BLE001
        out = {}

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
        evs = events_from(s)
        if not evs:
            continue
        out[f"{a}__vs__{b}"] = {"events": evs, "updated_at": now.isoformat(timespec="seconds")}
        updated += 1

    out.setdefault("__meta__", {})
    out["__meta__"].update({"updated_at": now.isoformat(timespec="seconds"), "source": "espn-summary"})
    (DATA / "match_events.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    log(f"events: {updated}/{len(targets)} matches updated")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}; keeping existing data")
        raise SystemExit(0)
