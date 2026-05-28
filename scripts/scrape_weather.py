#!/usr/bin/env python3
"""Weather forecast per venue per matchday.

Source: Open-Meteo (https://api.open-meteo.com/v1/forecast) — free, no key,
no auth, no third-party tracking. We only request the days that have a match
at that venue, and we cache the result.

Output:
  data/weather.json
    { venue_id: { "YYYY-MM-DD": { temp_c, condition_code, humidity_pct, wind_kph } } }

Idempotent and safe under continue-on-error.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import polite_get, ScrapeError, log, DATA_DIR  # type: ignore


def load(name: str):
    p = DATA_DIR / name
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save(name: str, data) -> None:
    (DATA_DIR / name).write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> int:
    schedule = load("schedule_full.json")
    venues = {v["id"]: v for v in load("venues.json")}
    out = load("weather.json")
    if not isinstance(out, dict):
        out = {}

    needed: dict[str, set[str]] = defaultdict(set)
    for row in schedule:
        if not row.get("venue_id") or not row.get("kickoff_utc"):
            continue
        date = row["kickoff_utc"].split("T")[0]
        needed[row["venue_id"]].add(date)

    # Open-Meteo's `forecast` endpoint covers a sliding ~16-day window. Skip
    # any (venue, date) outside [today, today+15].
    today = datetime.now(timezone.utc).date()

    refreshed = 0
    for vid, dates in needed.items():
        v = venues.get(vid)
        if not v:
            continue
        block = out.setdefault(vid, {})
        for date in sorted(dates):
            try:
                d = datetime.strptime(date, "%Y-%m-%d").date()
            except ValueError:
                continue
            days_out = (d - today).days
            if days_out < 0 or days_out > 15:
                continue
            if date in block:
                continue
            url = (
                "https://api.open-meteo.com/v1/forecast"
                f"?latitude={v['lat']}&longitude={v['lon']}"
                "&daily=temperature_2m_max,relative_humidity_2m_max,"
                "wind_speed_10m_max,weathercode"
                f"&start_date={date}&end_date={date}&timezone=UTC"
            )
            try:
                res = polite_get(url, accept_json=True)
                payload = res.json()
            except (ScrapeError, ValueError) as e:
                log(f"weather: {vid} {date}: {e}")
                continue
            daily = payload.get("daily") or {}
            try:
                block[date] = {
                    "temp_c": daily["temperature_2m_max"][0],
                    "condition_code": daily["weathercode"][0],
                    "humidity_pct": daily["relative_humidity_2m_max"][0],
                    "wind_kph": round(float(daily["wind_speed_10m_max"][0]) * 3.6, 1),
                }
                refreshed += 1
            except (KeyError, IndexError, TypeError):
                continue

    out.setdefault("__meta__", {})
    out["__meta__"]["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    save("weather.json", out)
    log(f"weather: refreshed {refreshed} venue-day points")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        log(f"weather: fatal — {e}; continuing")
        raise SystemExit(0)
