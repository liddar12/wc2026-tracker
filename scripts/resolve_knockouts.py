#!/usr/bin/env python3
"""Resolve knockout-stage placeholder fixtures in schedule_full.json from ESPN.

WHY: reconcile_schedule.py only re-times matches that ALREADY have real teams and
explicitly SKIPS bracket placeholders ("1A","2B","W74","3 ABCDF",...). Nothing
else fills those slots, so the moment the group stage ends the knockout schedule
+ predictions freeze on placeholders (docs/POSTMORTEM: schedule_full stopped
changing on June 25 while the bracket moved on). See the RCA in chat 2026-06-28.

Once FIFA seeds the bracket, ESPN publishes the resolved fixtures (real teams +
venue + kickoff). This adopts them: for each knockout row whose team_a/team_b is
a placeholder, find the ESPN event at the SAME venue on the SAME day and
overwrite team_a/team_b (+ kickoff_utc) with the real, normalized teams.

Match key: (venue_id, date) — unique per knockout match (one game per stadium
per day). Venue is matched by normalized name (contains-tolerant, so ESPN's
"GEHA Field at Arrowhead Stadium" maps to our "arrowhead") with a city fallback
(ESPN renamed Azteca -> "Estadio Banorte"; same city). Teams must exist in
teams.json or the row is left as a placeholder (re-runs fill in as ESPN
publishes the rest). Always exits 0; on any error the file is left untouched.

Self-test (no network): python3 scripts/resolve_knockouts.py --selftest
Dry run (no write):     python3 scripts/resolve_knockouts.py --dry-run
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SCHED = DATA / "schedule_full.json"
SB = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
UA = {"User-Agent": "wc26-tracker/1.0", "Accept": "application/json"}
MIN_INTERVAL = 0.5

KNOCKOUT_STAGES = {"round_of_32", "round_of_16", "quarterfinals", "semifinals", "third_place", "final"}
# Same placeholder grammar as reconcile_schedule.py ("1A","2B","3 ABCDF","W73"…).
PLACEHOLDER_RE = re.compile(r"^\d[A-L]$|^[A-L]\d|^3[A-L/]|^3 |^W\d|^L\d|^1[A-L]|^2[A-L]|^RU", re.I)

RENAMES = {
    "United States": "USA", "South Korea": "Korea Republic", "Türkiye": "Turkiye",
    "Turkey": "Turkiye", "Czech Republic": "Czechia", "Cape Verde": "Cabo Verde",
    "Ivory Coast": "Cote d'Ivoire", "IR Iran": "Iran", "Congo DR": "DR Congo",
    "Bosnia & Herzegovina": "Bosnia and Herzegovina",
    "Bosnia-Herzegovina": "Bosnia and Herzegovina", "Curaçao": "Curacao",
}
_last = 0.0


def log(m): print(f"[knockouts] {m}", file=sys.stderr, flush=True)
def is_placeholder(n): return not n or bool(PLACEHOLDER_RE.match(str(n).strip()))
def norm_team(n): n = (n or "").strip(); return RENAMES.get(n, RENAMES.get(n.replace("-", " "), n))
def _alnum(s): return re.sub(r"[^a-z0-9]", "", (s or "").lower())
def _city(s): return _alnum(str(s or "").split(",")[0])  # "Houston, Texas" -> "houston"


def get(url):
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
            _last = time.monotonic()
            return json.load(r)
    except Exception as e:  # noqa: BLE001
        _last = time.monotonic()
        log(f"GET fail {url[-40:]}: {e}")
        return None


def build_venue_index(venues):
    """name/city -> venue_id, for resolving an ESPN venue to our venue_id."""
    by_name, by_city = {}, {}
    for v in venues:
        vid = v.get("id")
        if not vid:
            continue
        by_name[_alnum(v.get("name"))] = vid
        by_city.setdefault(_city(v.get("city")), vid)
    return by_name, by_city


def resolve_venue(espn_name, espn_city, by_name, by_city):
    nn = _alnum(espn_name)
    if nn in by_name:
        return by_name[nn]
    # contains-tolerant: "gehafieldatarrowheadstadium" ⊇ "arrowheadstadium"
    for vn, vid in by_name.items():
        if vn and (vn in nn or nn in vn):
            return vid
    return by_city.get(_city(espn_city))  # city fallback (Azteca→Banorte etc.)


def espn_fixtures_for(datestr, by_name, by_city):
    """ESPN scoreboard for YYYY-MM-DD -> [{venue_id, date, home, away}] (real teams only)."""
    data = get(f"{SB}?dates={datestr.replace('-', '')}")
    out = []
    for ev in (data or {}).get("events", []):
        comp = (ev.get("competitions") or [{}])[0]
        ven = comp.get("venue") or {}
        vid = resolve_venue(ven.get("fullName"), (ven.get("address") or {}).get("city"), by_name, by_city)
        if not vid:
            continue
        home = away = None
        for c in comp.get("competitors", []):
            nm = norm_team((c.get("team") or {}).get("displayName") or (c.get("team") or {}).get("name"))
            if c.get("homeAway") == "home":
                home = nm
            elif c.get("homeAway") == "away":
                away = nm
        if home and away:
            out.append({"venue_id": vid, "date": str(ev.get("date"))[:10], "kickoff": str(ev.get("date")), "home": home, "away": away})
    return out


def _norm_kickoff(iso):
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:00Z")
    except ValueError:
        return None


def _days_apart(a, b):
    try:
        return abs((date.fromisoformat(a) - date.fromisoformat(b)).days)
    except ValueError:
        return 99


def resolve(rows, fixtures_by_date, team_names):
    """Mutate rows in place; return list of (match_id, 'A vs B') changes."""
    # flatten fixtures, index by venue_id
    all_fx = [f for fx in fixtures_by_date.values() for f in fx]
    changes = []
    for m in rows:
        if m.get("stage") not in KNOCKOUT_STAGES:
            continue
        if not (is_placeholder(m.get("team_a")) or is_placeholder(m.get("team_b"))):
            continue
        rdate = str(m.get("kickoff_utc"))[:10]
        cand = [f for f in all_fx if f["venue_id"] == m.get("venue_id") and _days_apart(f["date"], rdate) <= 1]
        if not cand:
            continue
        cand.sort(key=lambda f: _days_apart(f["date"], rdate))
        fx = cand[0]
        if fx["home"] not in team_names or fx["away"] not in team_names:
            log(f"{m.get('match_id')}: ESPN teams {fx['home']!r}/{fx['away']!r} not in teams.json — skipped")
            continue
        m["team_a"], m["team_b"] = fx["home"], fx["away"]
        ko = _norm_kickoff(fx["kickoff"])
        if ko:
            m["kickoff_utc"] = ko
        changes.append((m.get("match_id"), f"{fx['home']} vs {fx['away']}"))
    return changes


def main(dry_run=False):
    rows = json.loads(SCHED.read_text(encoding="utf-8"))
    venues = json.loads((DATA / "venues.json").read_text(encoding="utf-8"))
    team_names = set(json.loads((DATA / "teams.json").read_text(encoding="utf-8")).keys())
    by_name, by_city = build_venue_index(venues)

    pending = [m for m in rows if m.get("stage") in KNOCKOUT_STAGES
               and (is_placeholder(m.get("team_a")) or is_placeholder(m.get("team_b")))]
    if not pending:
        log("no placeholder knockout rows — nothing to resolve")
        return 0
    dates = sorted({str(m.get("kickoff_utc"))[:10] for m in pending})
    fixtures_by_date = {d: espn_fixtures_for(d, by_name, by_city) for d in dates}

    changes = resolve(rows, fixtures_by_date, team_names)
    if not changes:
        log(f"{len(pending)} placeholder row(s); ESPN has resolved none yet — left unchanged")
        return 0
    for mid, pair in changes:
        log(f"  resolved {mid} -> {pair}")
    if dry_run:
        log(f"DRY RUN — would resolve {len(changes)}/{len(pending)} placeholder row(s)")
        return 0
    SCHED.write_text(json.dumps(rows, ensure_ascii=True, indent=2), encoding="utf-8")
    log(f"resolved {len(changes)}/{len(pending)} knockout fixture(s) → schedule_full.json")
    return 0


def selftest():
    fail = 0

    def check(name, cond):
        nonlocal fail
        print(f"  {'ok  ' if cond else 'FAIL'}: {name}")
        if not cond:
            fail += 1

    venues = [
        {"id": "nrg", "name": "NRG Stadium", "city": "Houston"},
        {"id": "arrowhead", "name": "Arrowhead Stadium", "city": "Kansas City"},
        {"id": "azteca", "name": "Estadio Azteca", "city": "Mexico City"},
        {"id": "metlife", "name": "MetLife Stadium", "city": "East Rutherford"},
    ]
    by_name, by_city = build_venue_index(venues)
    check("exact venue name", resolve_venue("NRG Stadium", "Houston, Texas", by_name, by_city) == "nrg")
    check("contains (GEHA…Arrowhead)", resolve_venue("GEHA Field at Arrowhead Stadium", "Kansas City, Missouri", by_name, by_city) == "arrowhead")
    check("city fallback (Banorte=Azteca)", resolve_venue("Estadio Banorte", "Mexico City", by_name, by_city) == "azteca")
    check("AT&T-style punctuation tolerant", resolve_venue("MetLife Stadium", "East Rutherford, New Jersey", by_name, by_city) == "metlife")
    check("unknown venue → None", resolve_venue("Some Other Park", "Nowhere", by_name, by_city) is None)

    check("placeholder detect 1A/2B/W74/3 ABCDF", all(is_placeholder(x) for x in ("1A", "2B", "W74", "L101", "3 ABCDF", "RU-A")))
    check("real team not placeholder", not is_placeholder("Brazil") and not is_placeholder("Cote d'Ivoire"))
    check("team rename", norm_team("United States") == "USA" and norm_team("Bosnia-Herzegovina") == "Bosnia and Herzegovina")
    check("kickoff normalized", _norm_kickoff("2026-06-29T17:00Z") == "2026-06-29T17:00:00Z")
    check("days apart", _days_apart("2026-06-30", "2026-06-29") == 1 and _days_apart("2026-06-29", "2026-06-29") == 0)

    rows = [
        {"match_id": "M076__1C__vs__2F", "stage": "round_of_32", "kickoff_utc": "2026-06-29T17:00:00Z", "venue_id": "nrg", "team_a": "1C", "team_b": "2F"},
        {"match_id": "G01", "stage": "group_stage", "kickoff_utc": "2026-06-29T17:00:00Z", "venue_id": "nrg", "team_a": "Brazil", "team_b": "Japan"},
    ]
    fbd = {"2026-06-29": [{"venue_id": "nrg", "date": "2026-06-29", "kickoff": "2026-06-29T17:00Z", "home": "Brazil", "away": "Japan"}]}
    ch = resolve(rows, fbd, {"Brazil", "Japan"})
    check("resolves placeholder by (venue,date)", rows[0]["team_a"] == "Brazil" and rows[0]["team_b"] == "Japan")
    check("rewrites kickoff from ESPN", rows[0]["kickoff_utc"] == "2026-06-29T17:00:00Z")
    check("leaves group/real rows untouched", rows[1]["team_a"] == "Brazil" and len(ch) == 1)
    # unknown team → leave placeholder
    rows2 = [{"match_id": "X", "stage": "final", "kickoff_utc": "2026-07-19T19:00:00Z", "venue_id": "nrg", "team_a": "W101", "team_b": "W102"}]
    resolve(rows2, {"2026-07-19": [{"venue_id": "nrg", "date": "2026-07-19", "kickoff": "2026-07-19T19:00Z", "home": "Atlantis", "away": "Brazil"}]}, {"Brazil"})
    check("unknown team → left placeholder", rows2[0]["team_a"] == "W101")

    print(f"selftest: {'PASS' if not fail else f'{fail} FAILURE(S)'}")
    return 1 if fail else 0


if __name__ == "__main__":
    args = sys.argv[1:]
    try:
        if "--selftest" in args:
            raise SystemExit(selftest())
        raise SystemExit(main(dry_run="--dry-run" in args))
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}; leaving schedule_full.json untouched")
        raise SystemExit(0)
