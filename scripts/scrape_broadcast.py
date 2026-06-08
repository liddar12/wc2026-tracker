#!/usr/bin/env python3
"""Populate per-match US broadcast + streaming info in data/schedule_full.json.

WC2026 US rights are already known, so we seed accurate defaults (no more "TBA"):
  English  → FOX / FS1   · free stream on Tubi (+ Fox Sports app)
  Spanish  → Telemundo / Universo · stream on Peacock (+ Telemundo app)

The exact channel-of-two for a given match (FOX vs FS1, Telemundo vs Universo) is
assigned by FOX/Telemundo closer to kickoff. Those go in
data/broadcast_overrides.json (keyed by match_id) and are applied ON TOP of the
defaults — so as the official match-by-match schedule publishes, you just update
that file (by hand or a future fetch) and cron picks it up.

Run AFTER scrape_schedule.py (which regenerates schedule_full.json from source).
"""
from __future__ import annotations

import json
import os
import sys

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def dpath(f: str) -> str:
    return os.path.join(DATA, f)


# Accurate US rights defaults (shown until an exact per-match override exists).
DEFAULT = {
    "english_channel": "FOX / FS1 · stream Tubi (free)",
    "spanish_channel": "Telemundo / Universo · stream Peacock",
    "stream_url": "https://tubitv.com/",
    "english_stream": "Tubi (free), Fox Sports app",
    "spanish_stream": "Peacock, Telemundo app",
    "source": "default-rights",
}


def main() -> int:
    try:
        sched = json.load(open(dpath("schedule_full.json")))
    except Exception as exc:
        print(f"scrape_broadcast: cannot read schedule_full.json: {exc}", file=sys.stderr)
        return 0  # non-fatal; never break the data pipeline
    rows = sched if isinstance(sched, list) else (sched.get("matches") or [])

    try:
        ov = (json.load(open(dpath("broadcast_overrides.json"))) or {}).get("by_match", {})
    except Exception:
        ov = {}

    n = exact = 0
    for m in rows:
        if not isinstance(m, dict):
            continue
        n += 1
        mid = str(m.get("match_id") or m.get("match_number") or "")
        b = dict(DEFAULT)
        if mid in ov and isinstance(ov[mid], dict):
            b.update(ov[mid])
            b["source"] = "official"
            exact += 1
        m.setdefault("broadcast", {})["us"] = b

    json.dump(sched, open(dpath("schedule_full.json"), "w"), indent=2)
    print(f"broadcast: filled {n} matches ({exact} exact per-match overrides, "
          f"{n - exact} default FOX/Telemundo)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
