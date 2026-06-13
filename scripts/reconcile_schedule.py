#!/usr/bin/env python3
"""Correct data/schedule_full.json kickoff times from ESPN's scoreboard.

RCA (June 13 2026): schedule_full.json shipped with three group-stage late
games (the 04:00Z doubleheader nightcaps) dated EXACTLY 24h early —
Australia–Türkiye, Austria–Jordan, Tunisia–Japan. The intended self-heal,
scrape_schedule.py, had failed every run (FIFA API robots-blocked + invalid
JSON; "every probe failed; leaving schedule_full.json untouched"), so the bad
seed dates never got corrected and the app showed e.g. "Friday June 12" for a
match that is actually Saturday June 13 (11pm Chicago / 04:00Z Sun).

ESPN's public scoreboard — already authoritative for our live scores, open
CORS, reliably reachable — is the durable source of truth for kickoff times.
This reconciler pulls ESPN for a rolling window and rewrites kickoff_utc for
any match whose BOTH teams are real (not bracket placeholders like "1A"/"W73")
and whose stored kickoff differs from ESPN's. Placeholder matches and pairs
ESPN doesn't list are left untouched. VENUES ARE NOT TOUCHED. Always exits 0.

Window: [now-1d .. now+13d] by default (covers upcoming corrections without
refetching the whole tournament); override with --days-back / --days-fwd.
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SB = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
UA = {"User-Agent": "wc26-tracker/1.0", "Accept": "application/json"}
MIN_INTERVAL = 0.5
DAYS_BACK, DAYS_FWD = 1, 13

# ESPN display names -> our canonical schedule names (kept in sync with the
# other scrapers' TEAM_RENAMES + app/live-scores.js).
RENAMES = {
    "United States": "USA", "South Korea": "Korea Republic", "Türkiye": "Turkiye",
    "Turkey": "Turkiye", "Czech Republic": "Czechia", "Cape Verde": "Cabo Verde",
    "Ivory Coast": "Cote d'Ivoire", "IR Iran": "Iran", "Congo DR": "DR Congo",
    "Bosnia & Herzegovina": "Bosnia and Herzegovina",
    "Bosnia-Herzegovina": "Bosnia and Herzegovina", "Curaçao": "Curacao",
}
# Bracket placeholders: "1A", "2B", "3A/B/C", "W73", "L74", "RU-A" etc.
PLACEHOLDER_RE = re.compile(r"^\d[A-L]$|^[A-L]\d|^3[A-L/]|^3 |^W\d|^L\d|^1[A-L]|^2[A-L]|^RU", re.I)

_last = 0.0


def log(m): print(f"[reconcile] {m}", file=sys.stderr, flush=True)


def norm(n):
    n = (n or "").strip()
    return RENAMES.get(n, RENAMES.get(n.replace("-", " "), n))


def is_placeholder(name):
    return not name or bool(PLACEHOLDER_RE.match(str(name).strip()))


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
        log(f"GET fail {url[-30:]}: {e}")
        return None


def parse_instant(s):
    """Parse an ISO timestamp to an aware UTC datetime, or None."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def canonical_z(dt):
    """Our schedule_full.json convention: 'YYYY-MM-DDTHH:MM:SSZ' (with seconds)."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_espn_map(days_back, days_fwd):
    """{frozenset(canonical names): espn_iso_kickoff}."""
    now = datetime.now(timezone.utc)
    out = {}
    for off in range(-days_back, days_fwd + 1):
        d = (now + timedelta(days=off)).strftime("%Y%m%d")
        data = get(f"{SB}?dates={d}")
        for ev in (data or {}).get("events", []):
            comp = (ev.get("competitions") or [{}])[0]
            names = [norm((c.get("team") or {}).get("displayName")) for c in comp.get("competitors", [])]
            names = [n for n in names if n]
            if len(names) == 2 and ev.get("date"):
                out[frozenset(names)] = ev["date"]
    return out


def reconcile(rows, espn):
    """Pure: rewrite kickoff_utc in-place where ESPN disagrees. Returns list of
    (match_id, old, new) changes. Skips placeholders + pairs ESPN doesn't list."""
    changes = []
    for m in rows:
        a, b = m.get("team_a"), m.get("team_b")
        if is_placeholder(a) or is_placeholder(b):
            continue
        espn_iso = espn.get(frozenset([a, b]))
        if not espn_iso:
            continue
        ours_dt, espn_dt = parse_instant(m.get("kickoff_utc")), parse_instant(espn_iso)
        if not espn_dt:
            continue
        # Compare by INSTANT, not string — "19:00:00Z" and "19:00Z" are equal
        # and must NOT churn. Only rewrite a genuinely different kickoff, and
        # write it in our canonical seconds format.
        if ours_dt != espn_dt:
            old = m.get("kickoff_utc")
            new = canonical_z(espn_dt)
            m["kickoff_utc"] = new
            changes.append((m.get("match_id") or f"{a}__vs__{b}", old, new))
    return changes


def main(days_back=DAYS_BACK, days_fwd=DAYS_FWD):
    path = DATA / "schedule_full.json"
    rows = json.loads(path.read_text())
    if not isinstance(rows, list):
        log("schedule_full.json is not a list; aborting safely")
        return 0
    espn = build_espn_map(days_back, days_fwd)
    if not espn:
        log("no ESPN fixtures fetched; leaving schedule untouched")
        return 0
    changes = reconcile(rows, espn)
    if not changes:
        log(f"schedule already matches ESPN ({len(espn)} fixtures checked)")
        return 0
    # ensure_ascii=True matches schedule_full.json's existing on-disk encoding
    # (scrape_schedule.py writes "·" etc.) — keeps the diff to only the
    # rows whose kickoff actually changed, no cosmetic unicode churn.
    path.write_text(json.dumps(rows, ensure_ascii=True, indent=2) + "\n")
    for mid, old, new in changes:
        log(f"corrected {mid}: {old} -> {new}")
    log(f"reconciled {len(changes)} kickoff time(s)")
    return 0


if __name__ == "__main__":
    db, df = DAYS_BACK, DAYS_FWD
    args = sys.argv[1:]
    if "--days-back" in args:
        db = int(args[args.index("--days-back") + 1])
    if "--days-fwd" in args:
        df = int(args[args.index("--days-fwd") + 1])
    try:
        raise SystemExit(main(db, df))
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}; keeping existing data")
        raise SystemExit(0)
