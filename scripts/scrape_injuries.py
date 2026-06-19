#!/usr/bin/env python3
"""Injuries feed → data/injuries.json (by_team + __meta__).

REWRITE (2026-06-19): the old source (an ESPN squad-tracker story page) is a
hard 404, so this wrote 0 entries every run, silently, for the whole tournament
(docs/POSTMORTEM_2026-06-19.md, Track 1).

Investigation finding: ESPN publishes NO structured injury data for the World
Cup — the per-team injuries endpoints all return 200 with 0 items, and the
match summary carries no injuries block.

ADDED (2026-06-19, Track-2 data source): API-Football (api-sports.io) DOES carry
World Cup injuries + suspensions. When $APIFOOTBALL_KEY is set this scraper
merges them in (source "api-football"); with no key it behaves exactly as
before (ESPN-only → empty), so the app degrades gracefully until the secret is
added. See docs/APIFOOTBALL_INTEGRATION.md.

Behaviour:
  1. ESPN per-team injuries endpoint for every WC team (future-proof: populates
     if ESPN ever adds WC injury data).
  2. API-Football /injuries?league=1&season=2026 (1 request covers the whole
     tournament), THROTTLED to ≤1 fetch / 6h — injuries don't change hourly, and
     this caps the cost to ~4 requests/day even on the hourly cron. Between
     fetches the previous run's API-Football entries are carried forward.
  3. Honest __meta__ (sources + counts + last API-Football fetch) so the
     staleness watchdog and the UI reflect reality.

Card SUSPENSIONS also remain surfaced from data/match_events.json. Always exits 0.

Self-test (no key/network): python3 scripts/scrape_injuries.py --selftest
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "injuries.json"
TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams"
INJ_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams/{id}/injuries"
UA = {"User-Agent": "wc26-tracker/1.0", "Accept": "application/json"}
MIN_INTERVAL = 0.4

# API-Football (api-sports.io) — direct host + key header. League 1 = World Cup.
AF_BASE = "https://v3.football.api-sports.io"
AF_LEAGUE_ID = 1
AF_SEASON = 2026
AF_THROTTLE_HOURS = 6      # ≤1 API-Football fetch per this window
AF_MIN_INTERVAL = 1.0

RENAMES = {
    "United States": "USA", "South Korea": "Korea Republic", "Türkiye": "Turkiye",
    "Turkey": "Turkiye", "Czech Republic": "Czechia", "Cape Verde": "Cabo Verde",
    "Ivory Coast": "Cote d'Ivoire", "IR Iran": "Iran", "Congo DR": "DR Congo",
    "Bosnia & Herzegovina": "Bosnia and Herzegovina",
    "Bosnia-Herzegovina": "Bosnia and Herzegovina", "Curaçao": "Curacao",
}
_last = 0.0


def log(m): print(f"[injuries] {m}", file=sys.stderr, flush=True)
def norm(n): n = (n or "").strip(); return RENAMES.get(n, RENAMES.get(n.replace("-", " "), n))
def now() -> datetime: return datetime.now(timezone.utc)


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
        log(f"GET fail {url[-48:]}: {e}")
        return None


# ----- ESPN pass (unchanged behaviour) -----

def team_ids():
    data = get(TEAMS_URL)
    out = {}
    for s in (data or {}).get("sports", []):
        for lg in s.get("leagues", []):
            for entry in lg.get("teams", []):
                t = entry.get("team", {})
                name = norm(t.get("displayName") or t.get("name"))
                if name and t.get("id"):
                    out[name] = t["id"]
    return out


def espn_injuries() -> tuple[dict[str, list], int]:
    ids = team_ids()
    by_team: dict[str, list] = {}
    count = 0
    for name, tid in sorted(ids.items()):
        data = get(INJ_URL.format(id=tid))
        items = (data or {}).get("injuries") or []
        entries = []
        for it in items:
            ath = (it.get("athlete") or {}).get("displayName")
            if not ath:
                continue
            entries.append({
                "player": ath,
                "position": ((it.get("athlete") or {}).get("position") or {}).get("abbreviation", ""),
                "status": it.get("status") or (it.get("type") or {}).get("description", "Out"),
                "injury": (it.get("details") or {}).get("type") or it.get("shortComment") or "Injury",
                "source": "espn",
            })
        if entries:
            by_team[name] = entries
            count += len(entries)
    return by_team, count


# ----- API-Football pass -----

def af_get_injuries(key: str) -> dict | None:
    url = f"{AF_BASE}/injuries?" + urllib.parse.urlencode(
        {"league": AF_LEAGUE_ID, "season": AF_SEASON})
    req = urllib.request.Request(url, headers={
        "x-apisports-key": key, "Accept": "application/json",
        "User-Agent": "wc26-tracker/1.0"})
    try:
        time.sleep(AF_MIN_INTERVAL)
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except Exception as e:  # noqa: BLE001
        log(f"api-football GET fail: {e}")
        return None


def parse_apifootball_injuries(payload: dict | None) -> dict[str, list]:
    """API-Football /injuries response → {team: [entry, ...]} deduped by player.

    type "Missing Fixture" → Out, "Questionable" → Doubtful. reason holds the
    injury/suspension. Players repeat once per upcoming fixture → dedup."""
    by_team: dict[str, dict[str, dict]] = {}
    for row in (payload or {}).get("response", []) or []:
        player = ((row.get("player") or {}).get("name") or "").strip()
        team = norm((row.get("team") or {}).get("name"))
        if not player or not team:
            continue
        typ = (row.get("type") or "").strip()
        status = {"Missing Fixture": "Out", "Questionable": "Doubtful"}.get(typ, typ or "Out")
        reason = (row.get("reason") or "").strip() or "Injury"
        entry = {"player": player, "position": "", "status": status,
                 "injury": reason, "source": "api-football"}
        slot = by_team.setdefault(team, {})
        # keep the most severe (Out > Doubtful) if duplicated
        if player not in slot or (status == "Out" and slot[player].get("status") != "Out"):
            slot[player] = entry
    return {team: sorted(d.values(), key=lambda e: e["player"]) for team, d in by_team.items()}


# ----- merge + throttle helpers -----

def load_prev() -> dict:
    try:
        v = json.loads(OUT.read_text())
        return v if isinstance(v, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def prev_af_entries(prev: dict) -> dict[str, list]:
    """Carry forward previously-fetched API-Football entries (when throttled)."""
    out: dict[str, list] = {}
    for team, entries in (prev.get("by_team") or {}).items():
        af = [e for e in entries if isinstance(e, dict) and e.get("source") == "api-football"]
        if af:
            out[team] = af
    return out


def should_fetch_af(prev: dict, ref: datetime) -> bool:
    ts = (prev.get("__meta__") or {}).get("apifootball_updated_at")
    if not ts:
        return True
    try:
        last = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return True
    return ref - last >= timedelta(hours=AF_THROTTLE_HOURS)


def merge_by_team(*sources: dict[str, list]) -> dict[str, list]:
    out: dict[str, list] = {}
    for src in sources:
        for team, entries in src.items():
            out.setdefault(team, []).extend(entries)
    return dict(sorted(out.items()))


def build() -> dict:
    ref = now()
    espn_by_team, espn_count = espn_injuries()

    prev = load_prev()
    key = os.environ.get("APIFOOTBALL_KEY", "").strip()
    af_by_team: dict[str, list] = {}
    af_count = 0
    af_ts = (prev.get("__meta__") or {}).get("apifootball_updated_at")
    if not key:
        af_status = "disabled (no APIFOOTBALL_KEY)"
    elif should_fetch_af(prev, ref):
        payload = af_get_injuries(key)
        if payload is not None:
            af_by_team = parse_apifootball_injuries(payload)
            af_ts = ref.isoformat(timespec="seconds")
            af_status = "ok"
        else:
            af_by_team = prev_af_entries(prev)
            af_status = "fetch-failed (kept previous)"
    else:
        af_by_team = prev_af_entries(prev)
        af_status = "throttled (kept previous)"
    af_count = sum(len(v) for v in af_by_team.values())

    by_team = merge_by_team(espn_by_team, af_by_team)
    sources = ["espn-team-injuries"] + (["api-football"] if af_count or key else [])
    return {
        "__meta__": {
            "updated_at": ref.isoformat(timespec="seconds"),
            "source": "+".join(sources),
            "espn_entries": espn_count,
            "apifootball_entries": af_count,
            "apifootball_updated_at": af_ts,
            "apifootball_status": af_status,
            "note": ("ESPN exposes no World Cup injury data; injuries/suspensions "
                     "come from API-Football when APIFOOTBALL_KEY is set. "
                     "Suspensions are also surfaced from match_events. See "
                     "docs/APIFOOTBALL_INTEGRATION.md."),
        },
        "by_team": by_team,
        "count": espn_count + af_count,
    }


def selftest() -> int:
    fail = 0

    def check(name, cond):
        nonlocal fail
        print(f"  {'ok  ' if cond else 'FAIL'}: {name}")
        if not cond:
            fail += 1

    sample = {"response": [
        {"player": {"name": "Christian Pulisic"}, "team": {"name": "United States"},
         "type": "Missing Fixture", "reason": "Knee Injury"},
        {"player": {"name": "Christian Pulisic"}, "team": {"name": "United States"},
         "type": "Questionable", "reason": "Knee Injury"},   # dup, less severe
        {"player": {"name": "Hakan Calhanoglu"}, "team": {"name": "Turkey"},
         "type": "Questionable", "reason": "Suspended"},
        {"player": {"name": ""}, "team": {"name": "Brazil"}, "type": "x"},  # skip
    ]}
    parsed = parse_apifootball_injuries(sample)
    check("renamed team keys (USA, Turkiye)", set(parsed) == {"USA", "Turkiye"})
    check("dedup keeps most-severe status (Out)",
          len(parsed["USA"]) == 1 and parsed["USA"][0]["status"] == "Out")
    check("Questionable → Doubtful", parsed["Turkiye"][0]["status"] == "Doubtful")
    check("reason → injury field", parsed["Turkiye"][0]["injury"] == "Suspended")
    check("blank player skipped", "Brazil" not in parsed)
    check("source tagged", parsed["USA"][0]["source"] == "api-football")

    merged = merge_by_team({"USA": [{"player": "A", "source": "espn"}]},
                           {"USA": [{"player": "B", "source": "api-football"}]})
    check("merge unions per team", len(merged["USA"]) == 2)

    base = datetime(2026, 6, 19, 12, 0, tzinfo=timezone.utc)
    check("throttle: no prior ts → fetch", should_fetch_af({}, base) is True)
    fresh = {"__meta__": {"apifootball_updated_at": (base - timedelta(hours=1)).isoformat()}}
    check("throttle: 1h old → skip", should_fetch_af(fresh, base) is False)
    old = {"__meta__": {"apifootball_updated_at": (base - timedelta(hours=7)).isoformat()}}
    check("throttle: 7h old → fetch", should_fetch_af(old, base) is True)
    carry = prev_af_entries({"by_team": {"USA": [
        {"player": "A", "source": "espn"}, {"player": "B", "source": "api-football"}]}})
    check("carry-forward keeps only api-football", carry == {"USA": [{"player": "B", "source": "api-football"}]})

    print(f"selftest: {'PASS' if not fail else f'{fail} FAILURE(S)'}")
    return 1 if fail else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--selftest", action="store_true", help="run transforms (no key/network)")
    args = ap.parse_args()
    if args.selftest:
        return selftest()
    feed = build()
    OUT.write_text(json.dumps(feed, ensure_ascii=False, indent=2) + "\n")
    m = feed["__meta__"]
    log(f"injuries: {m['espn_entries']} ESPN + {m['apifootball_entries']} API-Football "
        f"({m['apifootball_status']}) across {len(feed['by_team'])} team(s)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}")
        raise SystemExit(0)
