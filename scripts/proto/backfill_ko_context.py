#!/usr/bin/env python3
"""PROTOTYPE (ready-to-enable) — backfill knockout-fixture CONTEXT that the live
pipeline leaves dark, using only free/derived data (no paid API key).

fatigue.json / h2h.json are keyed to GROUP fixtures only, so knockout matches have
no rest / travel / H2H context. This derives what it can offline:

  * rest_days  — days since each side's previous match, from the kickoff
                 chronology (played KO via actual_results, UPCOMING KO via
                 schedule_full). This is the one context signal usable for the
                 remaining fixtures (e.g. a QF side with more rest).
  * travel_km  — great-circle km from the team's previous venue to this venue,
                 when both venues are known (data/venues.json). Best-effort.

Writes data/proto/ko_context.json — NOT the live fatigue.json — so nothing in the
production pipeline changes. Enable for the live cron next tournament (or point
scrape_injuries at $APIFOOTBALL_KEY) once it can pay off across a full bracket.

Run:  python3 scripts/proto/backfill_ko_context.py
"""
from __future__ import annotations

import json
import math
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "data"
OUT = DATA / "proto" / "ko_context.json"
FINAL = {"STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_END_OF_FULL_TIME",
         "STATUS_FINAL_AET", "STATUS_FINAL_PEN"}
KO_TIERS = ("round_of_32", "round_of_16", "quarterfinals", "semifinals", "third_place", "final")


def log(m):
    print(f"[ko-context] {m}", file=sys.stderr, flush=True)


def _parse(dt):
    try:
        return datetime.fromisoformat((dt or "").replace("Z", "+00:00"))
    except Exception:
        return None


def _haversine(a, b):
    if not a or not b:
        return None
    try:
        lat1, lon1, lat2, lon2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    except Exception:
        return None
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return round(2 * 6371 * math.asin(math.sqrt(h)), 1)


def venue_coords():
    """{venue_key -> (lat, lon)} from venues.json, best-effort across schemas."""
    p = DATA / "venues.json"
    if not p.exists():
        return {}
    v = json.loads(p.read_text())
    rows = v if isinstance(v, list) else (v.get("venues") or list(v.values()))
    out = {}
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        lat = r.get("lat") or r.get("latitude")
        lon = r.get("lon") or r.get("lng") or r.get("longitude")
        for key in (r.get("id"), r.get("key"), r.get("name"), r.get("city")):
            if key and isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                out[str(key)] = (float(lat), float(lon))
    return out


def all_fixtures():
    """[(kickoff, tier, a, b, venue, played)] — played KO from actual_results +
    upcoming KO from schedule_full. Group matches included only to seed each
    team's 'previous match' date."""
    results = json.loads((DATA / "actual_results.json").read_text()) if (DATA / "actual_results.json").exists() else {}
    sched = json.loads((DATA / "schedule_full.json").read_text()) if (DATA / "schedule_full.json").exists() else []
    rows = sched if isinstance(sched, list) else sched.get("matches", [])

    fixtures = []
    # played (all tiers) — for chronology
    for tier in ("group_stage",) + KO_TIERS:
        for key, rec in (results.get(tier) or {}).items():
            if "__vs__" not in key or not isinstance(rec, dict):
                continue
            st = rec.get("status")
            if st and st not in FINAL:
                continue
            a, b = key.split("__vs__", 1)
            fixtures.append([rec.get("kickoff_utc") or "", tier, a, b, rec.get("venue"), True])
    # upcoming KO from schedule
    for m in rows:
        stage = (m.get("stage") or "").lower()
        if stage in ("group", "group_stage"):
            continue
        a, b = m.get("team_a"), m.get("team_b")
        if not a or not b or a.startswith(("W", "L", "1", "2", "3")) or b.startswith(("W", "L", "1", "2", "3")):
            continue  # unresolved bracket slot
        fixtures.append([m.get("kickoff_utc") or "", stage, a, b, m.get("venue"), False])
    fixtures.sort(key=lambda r: r[0] or "z")
    return fixtures


def main():
    coords = venue_coords()
    fixtures = all_fixtures()
    last_date = {}
    last_venue = {}
    out = {}
    ko_written = 0
    for koff, tier, a, b, venue, played in fixtures:
        dt = _parse(koff)
        is_ko = tier not in ("group_stage",)
        if is_ko:
            rec = {"tier": tier, "kickoff_utc": koff, "played": played}
            for side, name in (("team_a", a), ("team_b", b)):
                rest = (dt - last_date[name]).days if dt and name in last_date else None
                trav = _haversine(coords.get(str(last_venue.get(name))), coords.get(str(venue)))
                rec[side] = {"team": name, "rest_days": rest, "travel_km": trav}
            out[f"{a}__vs__{b}"] = rec
            ko_written += 1
        if dt:
            last_date[a] = last_date[b] = dt
            last_venue[a] = last_venue[b] = venue

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"__meta__": {"method": "derived rest/travel for KO fixtures (offline, no paid key)",
                                            "n_ko_fixtures": ko_written}, **out},
                              ensure_ascii=True, indent=2) + "\n")
    rest_cov = sum(1 for v in out.values() if v["team_a"]["rest_days"] is not None)
    trav_cov = sum(1 for v in out.values() if v["team_a"]["travel_km"] is not None)
    upcoming = [k for k, v in out.items() if not v["played"]]
    log(f"wrote {ko_written} KO fixtures · rest coverage {rest_cov} · travel coverage {trav_cov}")
    log(f"upcoming KO with derived rest: {', '.join(upcoming) or 'none'}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}")
        raise SystemExit(1)
