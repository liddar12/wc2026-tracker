#!/usr/bin/env python3
"""Populate per-match US broadcast + streaming in data/schedule_full.json.

Automatic source: ESPN's public fifa.world scoreboard (same API the app already
scrapes) exposes per-match `geoBroadcasts` — e.g. the opener is FOX, Czechia–Korea
is FS1, both with Telemundo + Peacock. We pull those EXACT channels per match and
fall back to the known WC2026 US rights when ESPN hasn't listed a match yet:
  English → FOX / FS1   · free stream Tubi (+ Fox Sports app)
  Spanish → Telemundo / Universo · stream Peacock (+ Telemundo app)

Precedence per match:  manual override (broadcast_overrides.json) > ESPN > default.
Resilient: any network/parse failure just keeps the accurate defaults. Wired into
the daily + hourly crons after scrape_schedule.py, so exact channels populate
automatically as ESPN/FOX publish them.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
UA = "wc26-tracker/1.0 (personal-project)"
MIN_INTERVAL = 1.0

# ESPN display names → teams.json keys (only the ones that differ)
ESPN_TO_TEAM = {
    "South Korea": "Korea Republic", "Korea Republic": "Korea Republic",
    "United States": "USA", "USA": "USA", "Turkey": "Turkiye",
    "Ivory Coast": "Cote d'Ivoire", "Cote d'Ivoire": "Cote d'Ivoire",
    "Cape Verde": "Cabo Verde", "Congo DR": "DR Congo", "DR Congo": "DR Congo",
    "Czech Republic": "Czechia", "Curacao": "Curacao",
}
EN_NET = {"FOX", "FS1"}
ES_NET = {"Telemundo", "Tele", "Universo"}
STREAM = {"Tubi": "Tubi (free)", "Peacock": "Peacock", "Fox Sports": "Fox Sports app", "Fubo": "Fubo"}

DEFAULT = {
    "english_channel": "FOX / FS1 · stream Tubi (free)",
    "spanish_channel": "Telemundo / Universo · stream Peacock",
    "stream_url": "https://tubitv.com/",
    "english_stream": "Tubi (free), Fox Sports app",
    "spanish_stream": "Peacock, Telemundo app",
    "source": "default-rights",
}


def dpath(f):
    return os.path.join(DATA, f)


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def _map(name, valid):
    n = ESPN_TO_TEAM.get(name, name)
    return n if n in valid else None


def fetch_espn(dates, valid):
    """frozenset(team_a,team_b) → composed broadcast dict, from ESPN geoBroadcasts."""
    out = {}
    for d in sorted(dates):
        try:
            data = _get(f"{ESPN}?dates={d}")
        except Exception as exc:
            print(f"  espn {d}: {exc}", file=sys.stderr)
            time.sleep(MIN_INTERVAL)
            continue
        for e in (data.get("events") or []):
            comp = (e.get("competitions") or [{}])[0]
            teams = []
            for c in (comp.get("competitors") or []):
                t = c.get("team") or {}
                teams.append(_map(t.get("displayName") or t.get("name") or t.get("shortDisplayName"), valid))
            teams = [t for t in teams if t]
            if len(teams) != 2:
                continue
            nets = []
            for g in (comp.get("geoBroadcasts") or []):
                sn = (g.get("media") or {}).get("shortName")
                if sn:
                    nets.append(sn)
            if not nets:
                for b in (comp.get("broadcasts") or []):
                    nets += b.get("names") or []
            en = [n for n in dict.fromkeys(nets) if n in EN_NET]
            es = ["Telemundo" if n == "Tele" else n for n in dict.fromkeys(nets) if n in ES_NET]
            streams = [STREAM[n] for n in dict.fromkeys(nets) if n in STREAM]
            if not (en or es or streams):
                continue
            eng = " / ".join(en) if en else "FOX / FS1"
            spa = " / ".join(es) if es else "Telemundo / Universo"
            if any("Tubi" in s for s in streams):
                eng += " · Tubi (free)"
            if any("Peacock" in s for s in streams):
                spa += " · Peacock"
            stream_url = "https://tubitv.com/" if any("Tubi" in s for s in streams) else (
                "https://www.peacocktv.com/" if any("Peacock" in s for s in streams) else "https://tubitv.com/")
            out[frozenset(teams)] = {
                "english_channel": eng, "spanish_channel": spa, "stream_url": stream_url,
                "english_stream": ", ".join(s for s in streams if "Peacock" not in s) or "Tubi (free), Fox Sports app",
                "spanish_stream": "Peacock, Telemundo app", "source": "espn",
            }
        time.sleep(MIN_INTERVAL)
    return out


def main():
    try:
        sched = json.load(open(dpath("schedule_full.json")))
    except Exception as exc:
        print(f"scrape_broadcast: cannot read schedule_full.json: {exc}", file=sys.stderr)
        return 0
    rows = sched if isinstance(sched, list) else (sched.get("matches") or [])
    valid = set(json.load(open(dpath("teams.json"))).keys())

    # unique fixture dates (UTC) to query
    dates = set()
    for m in rows:
        k = (m.get("kickoff_utc") or "")[:10]
        if k:
            dates.add(k.replace("-", ""))

    espn = {}
    try:
        espn = fetch_espn(dates, valid)
    except Exception as exc:
        print(f"  espn fetch skipped: {exc}", file=sys.stderr)

    try:
        ov = (json.load(open(dpath("broadcast_overrides.json"))) or {}).get("by_match", {})
    except Exception:
        ov = {}

    n = exact = 0
    for m in rows:
        if not isinstance(m, dict):
            continue
        n += 1
        b = dict(DEFAULT)
        key = frozenset((m.get("team_a"), m.get("team_b")))
        if key in espn:
            b.update(espn[key]); exact += 1
        mid = str(m.get("match_id") or m.get("match_number") or "")
        if mid in ov and isinstance(ov[mid], dict):
            b.update(ov[mid]); b["source"] = "official"
        m.setdefault("broadcast", {})["us"] = b

    json.dump(sched, open(dpath("schedule_full.json"), "w"), indent=2)
    print(f"broadcast: {n} matches · {exact} from ESPN (exact channels) · "
          f"{n - exact} on default FOX/Telemundo · {datetime.now(timezone.utc).date()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
