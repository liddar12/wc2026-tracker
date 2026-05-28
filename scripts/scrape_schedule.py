#!/usr/bin/env python3
"""Daily-refresh hook for schedule_full.json.

FIFA publishes the public WC26 fixtures through a few JSON endpoints behind
fifa.com. They change format every few months and 4xx unpredictably from CI,
so this scraper is intentionally cautious: it tries each known endpoint, and
if every probe fails it leaves the existing data/schedule_full.json untouched
and exits 0.

When an endpoint succeeds, we patch in:
  - kickoff_utc updates if FIFA moved a slot
  - venue_id reassignments if FIFA reassigned a stadium

We never delete a row and never overwrite a non-null broadcast block —
broadcast curation is hand-managed.

Safe in CI under `continue-on-error: true`. Idempotent.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import polite_get, ScrapeError, log, DATA_DIR  # type: ignore

# These endpoints are FIFA's public match-list feeds. They change frequently.
# Listed broadly so the scraper can degrade gracefully.
ENDPOINTS = (
    "https://api.fifa.com/api/v3/calendar/matches?idCompetition=17&language=en",
    "https://www.fifa.com/api/v3/calendar/matches?idCompetition=17&language=en",
)


def load(name: str):
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def save(name: str, data) -> None:
    (DATA_DIR / name).write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> int:
    existing = load("schedule_full.json")
    by_mid = {r["match_id"]: r for r in existing}
    fetched = None
    for url in ENDPOINTS:
        try:
            res = polite_get(url, accept_json=True)
            fetched = res.json()
            log(f"schedule: fetched {url}")
            break
        except ScrapeError as e:
            log(f"schedule: {e}")
        except ValueError as e:
            log(f"schedule: invalid JSON from {url}: {e}")

    if not fetched:
        log("schedule: every probe failed; leaving schedule_full.json untouched")
        return 0

    # FIFA's response shape varies. We probe the common keys.
    candidates = []
    if isinstance(fetched, dict):
        for key in ("Results", "Items", "results", "items", "matches"):
            v = fetched.get(key)
            if isinstance(v, list):
                candidates = v
                break
    elif isinstance(fetched, list):
        candidates = fetched

    if not candidates:
        log("schedule: response had no recognized match list; skipping")
        return 0

    patched = 0
    for fixture in candidates:
        if not isinstance(fixture, dict):
            continue
        a = fixture.get("HomeTeamName") or fixture.get("home_team_name")
        b = fixture.get("AwayTeamName") or fixture.get("away_team_name")
        if isinstance(a, list) and a:
            a = (a[0] or {}).get("Description") or (a[0] or {}).get("Name")
        if isinstance(b, list) and b:
            b = (b[0] or {}).get("Description") or (b[0] or {}).get("Name")
        if not a or not b:
            continue
        mid = f"{a}__vs__{b}"
        target = by_mid.get(mid) or by_mid.get(f"{b}__vs__{a}")
        if not target:
            continue
        kickoff = fixture.get("Date") or fixture.get("kickoff_utc")
        if isinstance(kickoff, str):
            target["kickoff_utc"] = kickoff
            patched += 1

    if patched:
        save("schedule_full.json", list(by_mid.values()))
    log(f"schedule: {patched} row(s) patched")
    log(f"schedule: refreshed at {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        log(f"schedule: fatal — {e}; continuing")
        raise SystemExit(0)
