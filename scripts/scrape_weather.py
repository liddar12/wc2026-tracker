#!/usr/bin/env python3
"""Weather forecast per venue per matchday.

Source: Open-Meteo (https://api.open-meteo.com/v1/forecast) — free, no key,
no auth, no third-party tracking. We only request venues that have a match
inside Open-Meteo's ~16-day forecast window, and we cache the result.

Output:
  data/weather.json
    { venue_id: { "YYYY-MM-DD": { temp_c, condition_code, humidity_pct, wind_kph } } }

Design (RJ30-4):
  * ONE batched Open-Meteo request per venue (date-range start_date..end_date),
    NOT one request per (venue, date) — collapses wall-clock + rate-limit surface.
  * The forecast is keyed by the VENUE-LOCAL match day (kickoff_local_venue), not
    the UTC date, so a late-UTC kickoff (00:00–05:00Z) maps to the correct local
    match day and the UI (weather.js, same key) renders the right forecast.
  * A single venue's 429/5xx is logged and skipped — every other venue still
    populates (no whole-run abort), and existing good cells are preserved.

Self-test (no network): python3 scripts/scrape_weather.py --selftest

Idempotent and safe under continue-on-error.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import polite_get, ScrapeError, log, DATA_DIR  # type: ignore

# Open-Meteo's `forecast` endpoint covers a sliding ~16-day window.
FORECAST_HORIZON_DAYS = 15


def load(name: str):
    p = DATA_DIR / name
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save(name: str, data) -> None:
    # Atomic + ASCII (repo on-disk convention; the staleness watchdog compares
    # diffs, so a tmp+replace swap never leaves a half-written file behind).
    path = DATA_DIR / name
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(data, ensure_ascii=True, indent=2) + "\n", encoding="utf-8"
    )
    tmp.replace(path)


def local_match_date(row: dict) -> str | None:
    """Venue-local match day, e.g. '2026-06-11'. Falls back to the UTC date when
    kickoff_local_venue is absent. Returns None if neither is present."""
    klv = row.get("kickoff_local_venue") or row.get("kickoff_utc")
    if not klv:
        return None
    return klv.split("T")[0]


def needed_dates(schedule) -> dict[str, set[str]]:
    """venue_id -> set of venue-local match dates (YYYY-MM-DD)."""
    needed: dict[str, set[str]] = defaultdict(set)
    for row in schedule:
        if not row.get("venue_id"):
            continue
        date = local_match_date(row)
        if not date:
            continue
        needed[row["venue_id"]].add(date)
    return needed


def in_window(date: str, today) -> bool:
    """True iff `date` (YYYY-MM-DD) is within [today, today+horizon]."""
    try:
        d = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        return False
    days_out = (d - today).days
    return 0 <= days_out <= FORECAST_HORIZON_DAYS


def build_url(lat, lon, start_date: str, end_date: str, tz: str) -> str:
    return (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        "&daily=temperature_2m_max,relative_humidity_2m_max,"
        "wind_speed_10m_max,weathercode"
        f"&start_date={start_date}&end_date={end_date}&timezone={tz}"
    )


def cells_from_daily(daily: dict, wanted: set[str]) -> dict[str, dict]:
    """Map Open-Meteo's parallel `daily.*` arrays into per-date cells, keyed by
    `daily.time`. Only the `wanted` dates are emitted. Never blind-indexes [0]:
    if `daily.time` is missing/short we just skip the unmatched dates."""
    times = (daily or {}).get("time") or []
    temps = (daily or {}).get("temperature_2m_max") or []
    hums = (daily or {}).get("relative_humidity_2m_max") or []
    winds = (daily or {}).get("wind_speed_10m_max") or []
    codes = (daily or {}).get("weathercode") or []
    out: dict[str, dict] = {}
    for i, day in enumerate(times):
        if day not in wanted:
            continue
        try:
            out[day] = {
                "temp_c": temps[i],
                "condition_code": codes[i],
                "humidity_pct": hums[i],
                "wind_kph": round(float(winds[i]) * 3.6, 1),
            }
        except (IndexError, TypeError, ValueError):
            continue
    return out


def main() -> int:
    schedule = load("schedule_full.json")
    venues = {v["id"]: v for v in load("venues.json")}
    out = load("weather.json")
    if not isinstance(out, dict):
        out = {}

    needed = needed_dates(schedule)
    today = datetime.now(timezone.utc).date()

    refreshed = 0
    for vid, dates in needed.items():
        v = venues.get(vid)
        if not v:
            continue
        if v.get("lat") is None or v.get("lon") is None:
            log(f"weather: {vid} missing lat/lon; skipping")
            continue
        block = out.setdefault(vid, {})

        # In-window dates we don't already have cached. Backfill newly-needed
        # dates even if some older ones are already present.
        wanted = {d for d in dates if in_window(d, today) and d not in block}
        if not wanted:
            continue

        tz = v.get("timezone") or "UTC"
        start_date = min(wanted)
        end_date = max(wanted)
        url = build_url(v["lat"], v["lon"], start_date, end_date, tz)
        try:
            res = polite_get(url, accept_json=True)
            payload = res.json()
        except (ScrapeError, ValueError) as e:
            # One venue's failure must not abort the run (AC-4.5).
            log(f"weather: {vid} {start_date}..{end_date}: {e}")
            continue
        daily = payload.get("daily") or {}
        cells = cells_from_daily(daily, wanted)
        for date, cell in cells.items():
            if date in block:
                continue
            block[date] = cell
            refreshed += 1

    # Only bump updated_at (and rewrite) when real data changed — a no-op bump
    # would make weather.json look fresh forever and defeat the staleness
    # watchdog (mirrors compute_form.py's no-op guard).
    if refreshed == 0:
        log("weather: no new venue-day points; leaving updated_at untouched")
        return 0
    out.setdefault("__meta__", {})
    out["__meta__"]["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    save("weather.json", out)
    log(f"weather: refreshed {refreshed} venue-day points")
    return 0


def selftest() -> int:
    """Validate the date-range collapse + TZ-keying transforms (no network)."""
    fail = 0

    def check(name: str, cond: bool) -> None:
        nonlocal fail
        print(f"  {'ok  ' if cond else 'FAIL'}: {name}")
        if not cond:
            fail += 1

    # TZ-keying: a late-UTC kickoff maps to the previous venue-local day.
    row = {
        "venue_id": "akron",
        "kickoff_utc": "2026-07-02T00:00:00Z",
        "kickoff_local_venue": "2026-07-01T20:00:00-04:00",
    }
    check("local_match_date uses venue-local day, not UTC date",
          local_match_date(row) == "2026-07-01")
    check("local_match_date falls back to UTC date",
          local_match_date({"kickoff_utc": "2026-06-11T19:00:00Z"}) == "2026-06-11")

    # One venue hosting 3 in-window dates collapses to ONE date-range request.
    sched = [
        {"venue_id": "akron", "kickoff_local_venue": "2026-07-01T20:00:00-04:00"},
        {"venue_id": "akron", "kickoff_local_venue": "2026-07-03T16:00:00-04:00"},
        {"venue_id": "akron", "kickoff_local_venue": "2026-07-05T13:00:00-04:00"},
    ]
    nd = needed_dates(sched)
    check("3 fixtures collapse to one venue's date set",
          nd["akron"] == {"2026-07-01", "2026-07-03", "2026-07-05"})
    start, end = min(nd["akron"]), max(nd["akron"])
    check("date-range spans min..max", start == "2026-07-01" and end == "2026-07-05")
    url = build_url(41.0, -81.5, start, end, "America/New_York")
    check("URL carries the venue timezone (not hard UTC)",
          "timezone=America/New_York" in url)
    check("URL carries start_date..end_date range",
          "start_date=2026-07-01" in url and "end_date=2026-07-05" in url)

    # cells_from_daily indexes by daily.time and emits only wanted dates.
    daily = {
        "time": ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"],
        "temperature_2m_max": [30.0, 31.0, 28.0, 29.0, 27.0],
        "relative_humidity_2m_max": [60, 55, 70, 65, 50],
        "wind_speed_10m_max": [5.0, 6.0, 4.0, 3.0, 7.0],
        "weathercode": [1, 2, 61, 3, 0],
    }
    cells = cells_from_daily(daily, {"2026-07-01", "2026-07-03", "2026-07-05"})
    check("only wanted dates emitted (filler days dropped)",
          set(cells.keys()) == {"2026-07-01", "2026-07-03", "2026-07-05"})
    check("cell indexed by daily.time, not [0]",
          cells["2026-07-03"]["temp_c"] == 28.0 and cells["2026-07-03"]["condition_code"] == 61)
    check("wind converted m/s -> km/h",
          cells["2026-07-01"]["wind_kph"] == round(5.0 * 3.6, 1))

    # Short/missing daily.time must NOT blind-index — just yields fewer cells.
    short = {"time": ["2026-07-01"], "temperature_2m_max": [], "weathercode": [],
             "relative_humidity_2m_max": [], "wind_speed_10m_max": []}
    check("short arrays don't crash (graceful skip)",
          cells_from_daily(short, {"2026-07-01"}) == {})

    # in_window honors the [today, today+15] horizon.
    base = datetime(2026, 6, 30).date()
    check("today is in window", in_window("2026-06-30", base))
    check("today+15 is in window", in_window("2026-07-15", base))
    check("today+16 is out of window", not in_window("2026-07-16", base))
    check("past date is out of window", not in_window("2026-06-29", base))

    print(f"selftest: {'PASS' if not fail else f'{fail} FAILURE(S)'}")
    return 1 if fail else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        raise SystemExit(selftest())
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"weather: fatal — {e}; continuing")
        raise SystemExit(0)
