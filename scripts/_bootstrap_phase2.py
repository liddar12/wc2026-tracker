#!/usr/bin/env python3
"""Phase 2 bootstrap — one-shot generator for the new data files.

This is intentionally idempotent and deterministic. Running it twice produces
the same output.

What it does:

1. Generates data/schedule_full.json:
   - 72 group-stage matches sourced from data/group_matchups.json with
     match_id = "<team_a>__vs__<team_b>"
   - 32 knockout placeholders (24 R32 + 8 R16 + 4 QF + 2 SF + 1 third-place
     + 1 final = 40 actually, but the WC26 format is 32 R32 -> 16 R16 -> 8
     QF -> 4 SF -> 1 third + 1 final = 32 KO matches total)
   - Kickoff slots spread deterministically across June 11 - July 19 2026 in
     UTC, venues round-robin.
   - Broadcast fields all null (so the UI surfaces "Channel TBA").

2. Cross-links each match in data/group_matchups.json with its match_id so
   the matchup-detail view can look up the venue/time/broadcast row.

3. Writes well-formed empty stubs for the new data files so the loader has
   stable shapes:
     lineups.json, referees.json, match_referees.json,
     h2h.json, form.json, scorers.json, weather.json

Run after a fresh clone or whenever group_matchups.json is rebuilt. Safe to
re-run; produces identical output for identical inputs.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Fixed WC26 timeline
GROUP_START = datetime(2026, 6, 11, tzinfo=timezone.utc)   # opening match day
GROUP_END = datetime(2026, 6, 27, tzinfo=timezone.utc)     # last group-stage day
R32_START = datetime(2026, 6, 28, tzinfo=timezone.utc)
R16_START = datetime(2026, 7, 4, tzinfo=timezone.utc)
QF_START = datetime(2026, 7, 9, tzinfo=timezone.utc)
SF_START = datetime(2026, 7, 14, tzinfo=timezone.utc)
THIRD_DATE = datetime(2026, 7, 18, tzinfo=timezone.utc)
FINAL_DATE = datetime(2026, 7, 19, tzinfo=timezone.utc)

# Kickoff slots in UTC (16:00 = noon ET, 19:00 = 3pm ET, 22:00 = 6pm ET, 01:00+1 = 9pm ET).
GROUP_SLOTS_UTC = [(16, 0), (19, 0), (22, 0), (1, 0)]   # last slot is next-day UTC
KO_SLOTS_UTC = [(20, 0), (23, 0)]                       # 4pm + 7pm ET
FINAL_SLOT_UTC = (19, 0)                                # 3pm ET kickoff


def load(name: str):
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def save(name: str, data) -> None:
    path = DATA_DIR / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {name}")


def group_match_id(team_a: str, team_b: str) -> str:
    return f"{team_a}__vs__{team_b}"


def ko_match_id(stage: str, n: int) -> str:
    return f"{stage}__{n:02d}"


def kickoff_for_group(idx: int) -> str:
    """Spread the 72 group matches across June 11-27 with 4 slots/day.

    Days 1-2 (opening day + USA opener day): 2 matches each (curated).
    Day 17 (June 27): final group day, last 4 matches.
    Other days carry the remainder.
    """
    # Distribute as deterministic 4-per-day across 17 days = 68. Add two extras
    # on the busiest mid-tournament days and we land at 72.
    # Simpler: produce a fixed schedule of 72 (day, slot) tuples.
    schedule = []
    day = GROUP_START
    matches_per_day = [
        2,   # June 11 (opening day)
        2,   # June 12 (USA opener day)
        4,   # June 13
        4,   # June 14
        4,   # June 15
        4,   # June 16
        4,   # June 17
        4,   # June 18
        4,   # June 19
        4,   # June 20
        4,   # June 21
        4,   # June 22
        4,   # June 23
        4,   # June 24
        4,   # June 25
        4,   # June 26
        12,  # June 27 (final group day, simultaneous kickoffs across groups)
    ]
    assert sum(matches_per_day) == 72, sum(matches_per_day)
    for d_idx, n in enumerate(matches_per_day):
        d = GROUP_START + timedelta(days=d_idx)
        for s in range(n):
            slot = GROUP_SLOTS_UTC[s % len(GROUP_SLOTS_UTC)]
            extra_day = 1 if slot == (1, 0) else 0
            ts = (d + timedelta(days=extra_day)).replace(hour=slot[0], minute=slot[1])
            schedule.append(ts.isoformat().replace("+00:00", "Z"))
    return schedule[idx]


def main() -> int:
    venues = load("venues.json")
    venue_ids = [v["id"] for v in venues]

    gm = load("group_matchups.json")

    full = []  # list of match records

    # 1) Group matches: deterministic flatten in group order A..L then match index.
    group_order = list("ABCDEFGHIJKL")
    flat_groups = []
    for g in group_order:
        for m in gm[g]["matches"]:
            flat_groups.append((g, m))

    # Match the canonical openers from schedule.json:
    #   June 11 opening:  Mexico vs South Africa (Group A)
    #   June 12 USA open: USA vs Paraguay (Group D)
    def find_idx(g, a, b):
        for i, (gp, m) in enumerate(flat_groups):
            if gp == g and {m["team_a"], m["team_b"]} == {a, b}:
                return i
        return None

    open_idx = find_idx("A", "Mexico", "South Africa")
    if open_idx is not None and open_idx != 0:
        flat_groups.insert(0, flat_groups.pop(open_idx))

    usa_idx = find_idx("D", "USA", "Paraguay")
    if usa_idx is not None and usa_idx != 2:
        flat_groups.insert(2, flat_groups.pop(usa_idx))

    # Canonical venue pins straight out of schedule.json (the curated key dates).
    venue_pins = {
        ("A", "Mexico", "South Africa"): "azteca",     # opening match
        ("D", "USA", "Paraguay"): "sofi",              # USA opener
    }

    for i, (g, m) in enumerate(flat_groups):
        mid = group_match_id(m["team_a"], m["team_b"])
        venue_id = venue_pins.get((g, m["team_a"], m["team_b"]))
        if not venue_id:
            venue_id = venue_pins.get((g, m["team_b"], m["team_a"]))
        if not venue_id:
            venue_id = venue_ids[i % len(venue_ids)]
        kickoff = kickoff_for_group(i)
        full.append({
            "match_id": mid,
            "stage": "group",
            "group": g,
            "team_a": m["team_a"],
            "team_b": m["team_b"],
            "kickoff_utc": kickoff,
            "venue_id": venue_id,
            "broadcast": {
                "us": {
                    "english_channel": None,
                    "spanish_channel": None,
                    "stream_url": None,
                },
            },
        })

    # 2) Cross-link group_matchups.json with match_id.
    for g in group_order:
        for m in gm[g]["matches"]:
            m["match_id"] = group_match_id(m["team_a"], m["team_b"])

    # 3) Knockout placeholders. WC26 KO bracket: 32 R32 -> 16 R16 -> 8 QF ->
    #    4 SF -> 1 third place -> 1 final. 24 + 8 + 4 + 2 + 1 + 1 wait that's
    #    24 R32? Actually: R32 has 16 matches (32 teams -> 16). R16 has 8.
    #    QF 4. SF 2. Third 1. Final 1. = 32 KO matches total. ✓
    ko_stages = [
        ("r32", 16, R32_START, 4),    # 4 days, 4 matches/day
        ("r16", 8, R16_START, 2),     # 2 days, 4 matches/day -> 8
        ("qf",  4, QF_START, 2),      # 2 days, 2 matches/day
        ("sf",  2, SF_START, 2),      # 2 days, 1 match/day
        ("third_place", 1, THIRD_DATE, 1),
        ("final", 1, FINAL_DATE, 1),
    ]
    venue_idx = 0
    for stage, count, start, span_days in ko_stages:
        for n in range(1, count + 1):
            mid = ko_match_id(stage, n)
            d_idx = (n - 1) // max(1, count // span_days)
            d = start + timedelta(days=d_idx)
            if stage == "final":
                slot = FINAL_SLOT_UTC
            else:
                slot = KO_SLOTS_UTC[(n - 1) % len(KO_SLOTS_UTC)]
            ts = d.replace(hour=slot[0], minute=slot[1])
            venue_id = venue_ids[venue_idx % len(venue_ids)]
            if stage == "final":
                venue_id = "metlife"   # MetLife hosts the final per FIFA.
            if stage == "third_place":
                venue_id = "att"       # Arlington commonly cited candidate.
            venue_idx += 1
            full.append({
                "match_id": mid,
                "stage": stage,
                "group": None,
                "team_a": None,
                "team_b": None,
                "kickoff_utc": ts.isoformat().replace("+00:00", "Z"),
                "venue_id": venue_id,
                "broadcast": {
                    "us": {
                        "english_channel": None,
                        "spanish_channel": None,
                        "stream_url": None,
                    },
                },
            })

    assert len(full) == 104, len(full)
    save("schedule_full.json", full)
    save("group_matchups.json", gm)

    # 4) Empty stubs.
    save("lineups.json", {})
    save("referees.json", {})
    save("match_referees.json", {})
    save("h2h.json", {})
    save("form.json", {})
    save("scorers.json", {})
    save("weather.json", {})

    print(f"OK: {len(full)} matches in schedule_full.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
