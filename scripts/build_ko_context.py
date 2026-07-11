#!/usr/bin/env python3
"""R23: knockout-fixture CONTEXT (rest days + travel km) → data/ko_context.json.

fatigue.json / h2h.json are keyed to GROUP fixtures, so knockout matches carry
no rest/travel context. This derives both from data we already have — no paid
API, no network:

  * rest_days  — days since each side's previous match, from the kickoff
                 chronology (played matches via actual_results, upcoming KO via
                 schedule_full).
  * travel_km  — great-circle km from the team's previous venue to this one
                 (data/venues.json lat/lon; venue joined back to played pairs
                 through the schedule row, since results carry no venue).

Primary consumer: scripts/generate_previews.py folds these typed numbers into
the AI preview prompt for knockout matches (final-four context: a rested side
vs one that flew cross-country after extra time). Promoted from
scripts/proto/backfill_ko_context.py (validated 28/28 rest+travel coverage).

Pure stdlib. Idempotent (anti-churn: file untouched when nothing changed).
Exits 0 on error leaving the previous file in place.

Run:  python3 scripts/build_ko_context.py
      python3 scripts/build_ko_context.py --self-test
"""
from __future__ import annotations

import json
import math
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import load_json, log as _log, save_json  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
FINAL = {"STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_END_OF_FULL_TIME",
         "STATUS_FINAL_AET", "STATUS_FINAL_PEN"}
KO_TIERS = ("round_of_32", "round_of_16", "quarterfinals", "semifinals", "third_place", "final")


def log(m): _log(f"ko-context: {m}")


def _parse(dt):
    try:
        return datetime.fromisoformat((dt or "").replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        return None


def haversine_km(a, b):
    """Great-circle km between (lat, lon) pairs; None on bad input."""
    if not a or not b:
        return None
    try:
        lat1, lon1, lat2, lon2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    except (TypeError, ValueError, IndexError):
        return None
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return round(2 * 6371 * math.asin(math.sqrt(h)), 1)


def venue_coords(venues) -> dict:
    """{venue_key -> (lat, lon)} best-effort across venues.json schemas."""
    rows = venues if isinstance(venues, list) else \
        ((venues or {}).get("venues") or list((venues or {}).values()))
    out = {}
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        lat = r.get("lat") or r.get("latitude")
        lon = r.get("lon") or r.get("lng") or r.get("longitude")
        if not (isinstance(lat, (int, float)) and isinstance(lon, (int, float))):
            continue
        for key in (r.get("id"), r.get("key"), r.get("name"), r.get("city")):
            if key:
                out[str(key)] = (float(lat), float(lon))
    return out


def all_fixtures(results, schedule_rows):
    """[(kickoff, tier, a, b, venue, played)] chronological. Group matches are
    included only to seed each team's previous-match date/venue chronology."""
    venue_by_pair = {}
    for m in schedule_rows:
        if m.get("team_a") and m.get("team_b") and m.get("venue_id"):
            venue_by_pair[frozenset((m["team_a"], m["team_b"]))] = m["venue_id"]

    fixtures = []
    for tier in ("group_stage",) + KO_TIERS:
        for key, rec in ((results or {}).get(tier) or {}).items():
            if "__vs__" not in key or not isinstance(rec, dict):
                continue
            st = rec.get("status")
            if st and st not in FINAL:
                continue
            a, b = key.split("__vs__", 1)
            venue = rec.get("venue_id") or rec.get("venue") or venue_by_pair.get(frozenset((a, b)))
            fixtures.append([rec.get("kickoff_utc") or "", tier, a, b, venue, True])
    for m in schedule_rows:
        stage = (m.get("stage") or "").lower()
        if stage in ("group", "group_stage"):
            continue
        a, b = m.get("team_a"), m.get("team_b")
        if not a or not b or a.startswith(("W", "L", "1", "2", "3")) or b.startswith(("W", "L", "1", "2", "3")):
            continue  # unresolved bracket slot
        fixtures.append([m.get("kickoff_utc") or "", stage, a, b, m.get("venue_id") or m.get("venue"), False])
    fixtures.sort(key=lambda r: r[0] or "z")
    return fixtures


def build_context(results, schedule_rows, venues) -> dict:
    """{pair_key -> {tier, kickoff_utc, played, team_a: {...}, team_b: {...}}}
    for every knockout fixture (played + resolved-upcoming)."""
    coords = venue_coords(venues)
    last_date: dict = {}
    last_venue: dict = {}
    out: dict = {}
    for koff, tier, a, b, venue, played in all_fixtures(results, schedule_rows):
        dt = _parse(koff)
        if tier != "group_stage":
            rec = {"tier": tier, "kickoff_utc": koff, "played": played}
            for side, name in (("team_a", a), ("team_b", b)):
                rest = (dt - last_date[name]).days if dt and name in last_date else None
                trav = haversine_km(coords.get(str(last_venue.get(name))), coords.get(str(venue)))
                rec[side] = {"team": name, "rest_days": rest, "travel_km": trav}
            # Played entries are stable; upcoming entries refresh as slots resolve.
            out[f"{a}__vs__{b}"] = rec
        if dt:
            last_date[a] = last_date[b] = dt
            last_venue[a] = last_venue[b] = venue
    return out


def main() -> int:
    results = load_json("actual_results.json") or {}
    sched = load_json("schedule_full.json") or []
    schedule_rows = sched if isinstance(sched, list) else sched.get("matches", [])
    venues = load_json("venues.json") or {}

    ctx = build_context(results, schedule_rows, venues)
    out = {"__meta__": {"method": "derived rest/travel for KO fixtures (offline)",
                        "n_ko_fixtures": len(ctx)}, **ctx}

    try:
        prior = load_json("ko_context.json") or {}
    except (OSError, json.JSONDecodeError):
        prior = {}  # first run / unreadable — write fresh
    if {k: v for k, v in prior.items() if k != "__meta__"} == ctx:
        log(f"no change ({len(ctx)} KO fixtures); leaving file untouched")
        return 0
    save_json("ko_context.json", out)
    rest_cov = sum(1 for v in ctx.values() if v["team_a"]["rest_days"] is not None)
    trav_cov = sum(1 for v in ctx.values() if v["team_a"]["travel_km"] is not None)
    log(f"wrote {len(ctx)} KO fixtures · rest coverage {rest_cov} · travel coverage {trav_cov}")
    return 0


def _self_test() -> int:
    venues = [{"id": "V1", "name": "Alpha Stadium", "lat": 40.0, "lon": -74.0},
              {"id": "V2", "name": "Beta Field", "lat": 34.0, "lon": -118.0}]
    # NY→LA is ~3940 km; same venue is 0.
    coords = venue_coords(venues)
    d = haversine_km(coords["V1"], coords["V2"])
    assert d and 3800 < d < 4100, f"NY→LA ≈ 3.9k km (got {d})"
    assert haversine_km(coords["V1"], coords["V1"]) == 0.0
    assert haversine_km(None, coords["V1"]) is None

    results = {
        "group_stage": {
            "A__vs__B": {"status": "STATUS_FULL_TIME", "score_a": 1, "score_b": 0,
                         "kickoff_utc": "2026-07-01T00:00:00Z"},
        },
        "quarterfinals": {},
    }
    schedule_rows = [
        {"team_a": "A", "team_b": "B", "stage": "group", "venue_id": "V1",
         "kickoff_utc": "2026-07-01T00:00:00Z"},
        # upcoming QF at the other coast, 5 days later
        {"team_a": "A", "team_b": "C", "stage": "quarterfinals", "venue_id": "V2",
         "kickoff_utc": "2026-07-06T00:00:00Z"},
        # unresolved slot must be skipped
        {"team_a": "W99", "team_b": "W100", "stage": "semifinals", "venue_id": "V1",
         "kickoff_utc": "2026-07-10T00:00:00Z"},
    ]
    ctx = build_context(results, schedule_rows, venues)
    assert "A__vs__C" in ctx and "W99__vs__W100" not in ctx, ctx.keys()
    qf = ctx["A__vs__C"]
    assert qf["team_a"]["rest_days"] == 5, qf
    assert qf["team_a"]["travel_km"] == d, "travel from V1 (group) to V2 (QF)"
    assert qf["team_b"]["rest_days"] is None, "C has no prior match — no fake zero"
    assert qf["played"] is False

    print("selftest: PASS")
    return 0


if __name__ == "__main__":
    try:
        if "--self-test" in sys.argv or "--selftest" in sys.argv:
            raise SystemExit(_self_test())
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}; leaving ko_context.json untouched")
        raise SystemExit(0)
