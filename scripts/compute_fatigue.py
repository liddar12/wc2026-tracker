#!/usr/bin/env python3
"""Compute travel + rest fatigue numbers for each match in schedule_full.json.

For every match where both team_a and team_b are populated (knockout placeholders
without team assignments are skipped), we compute, per side:

  - days_since_last_match: integer count of days since that team's previous
    fixture in the tournament. None for each team's first match.
  - km_flown_to_this_venue: great-circle distance (haversine) in kilometres
    from the previous venue's lat/lon to this venue's lat/lon. None for the
    first match. 0 if the venue is the same.

Output: data/fatigue.json keyed by match_id:
  { match_id: { team_a: { days_since_last_match, km_flown_to_this_venue },
                team_b: { ... }, updated_at: ISO string } }

No network calls. Pure-Python stdlib. Always succeeds — exits non-zero only if
the input files are malformed.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
EARTH_RADIUS_KM = 6371.0088


def load(name: str):
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def save(name: str, data) -> None:
    (DATA_DIR / name).write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def main() -> int:
    schedule = load("schedule_full.json")
    venues = {v["id"]: v for v in load("venues.json")}

    # Build per-team timeline of (kickoff_dt, venue_id).
    timelines: dict[str, list[tuple[datetime, str, str]]] = {}
    for row in schedule:
        if not row.get("team_a") or not row.get("team_b"):
            continue
        kickoff = datetime.fromisoformat(row["kickoff_utc"].replace("Z", "+00:00"))
        for side in ("team_a", "team_b"):
            timelines.setdefault(row[side], []).append(
                (kickoff, row["venue_id"], row["match_id"])
            )
    for team in timelines:
        timelines[team].sort()

    # Per-team previous match lookup.
    prev_by_team: dict[str, dict[str, tuple[datetime | None, str | None]]] = {}
    for team, rows in timelines.items():
        prev_by_team[team] = {}
        prev: tuple[datetime, str] | None = None
        for kickoff, vid, mid in rows:
            prev_by_team[team][mid] = prev
            prev = (kickoff, vid)

    out: dict[str, dict] = {}
    for row in schedule:
        if not row.get("team_a") or not row.get("team_b"):
            continue
        mid = row["match_id"]
        kickoff = datetime.fromisoformat(row["kickoff_utc"].replace("Z", "+00:00"))
        block = {}
        for side in ("team_a", "team_b"):
            t = row[side]
            prev = prev_by_team.get(t, {}).get(mid)
            if prev is None:
                block[side] = {
                    "days_since_last_match": None,
                    "km_flown_to_this_venue": None,
                }
                continue
            prev_kickoff, prev_vid = prev
            days = (kickoff - prev_kickoff).total_seconds() / 86400.0
            v_here = venues.get(row["venue_id"])
            v_prev = venues.get(prev_vid)
            if v_here and v_prev:
                km = haversine_km(
                    v_prev["lat"], v_prev["lon"], v_here["lat"], v_here["lon"]
                )
            else:
                km = None
            block[side] = {
                "days_since_last_match": round(days, 2),
                "km_flown_to_this_venue": None if km is None else round(km, 1),
            }
        block["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        out[mid] = block

    save("fatigue.json", out)
    print(f"compute_fatigue: wrote fatigue.json with {len(out)} entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
