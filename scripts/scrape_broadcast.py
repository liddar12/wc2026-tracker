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
import re
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


def iso2epoch(s):
    """Tolerant ISO → UTC epoch seconds. Handles 'Z' and missing seconds
    (ESPN emits '...T19:00Z'; our schedule emits '...T19:00:00Z')."""
    if not s:
        return None
    s = str(s).strip().replace(" ", "T")
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    s = re.sub(r"T(\d{2}:\d{2})(?=[+\-])", r"T\1:00", s)  # pad seconds before offset
    s = re.sub(r"T(\d{2}:\d{2})$", r"T\1:00", s)
    try:
        d = datetime.fromisoformat(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return int(d.timestamp())
    except Exception:
        return None


def fetch_espn(dates, valid):
    """Returns (team_map, kick_map) from ESPN geoBroadcasts:
      team_map: frozenset(team_a, team_b) → broadcast dict (team-matched, unchanged).
      kick_map: kickoff-epoch → broadcast dict, ONLY for timestamps with exactly one
        ESPN event that carries an EXACT English channel. This is the additive
        fallback for matches ESPN lists with placeholder teams (knockouts: "2A",
        "W74") that can't be team-matched. kickoff+slot is unique per match, so a
        single-event timestamp maps unambiguously; ambiguous (simultaneous) ones
        are dropped, so this can only ever ADD an exact channel, never mislabel."""
    out = {}
    by_kick_all = {}
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
            bcast = {
                "english_channel": eng, "spanish_channel": spa, "stream_url": stream_url,
                "english_stream": ", ".join(s for s in streams if "Peacock" not in s) or "Tubi (free), Fox Sports app",
                "spanish_stream": "Peacock, Telemundo app", "source": "espn",
            }
            if len(teams) == 2:
                out[frozenset(teams)] = bcast
            # additive kickoff index — only when ESPN gave an EXACT english channel
            ep = iso2epoch(e.get("date"))
            if en and ep is not None:
                by_kick_all.setdefault(ep, []).append(bcast)
        time.sleep(MIN_INTERVAL)
    by_kick = {ep: lst[0] for ep, lst in by_kick_all.items() if len(lst) == 1}
    return out, by_kick


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

    espn, by_kick = {}, {}
    try:
        espn, by_kick = fetch_espn(dates, valid)
    except Exception as exc:
        print(f"  espn fetch skipped: {exc}", file=sys.stderr)

    try:
        ov = (json.load(open(dpath("broadcast_overrides.json"))) or {}).get("by_match", {})
    except Exception:
        ov = {}

    n = exact = kfill = 0
    for m in rows:
        if not isinstance(m, dict):
            continue
        n += 1
        b = dict(DEFAULT)
        key = frozenset((m.get("team_a"), m.get("team_b")))
        if key in espn:
            b.update(espn[key]); exact += 1
        else:
            # placeholder/knockout fallback: match ESPN by unique kickoff time
            ep = iso2epoch(m.get("kickoff_utc"))
            if ep is not None and ep in by_kick:
                b.update(by_kick[ep]); exact += 1; kfill += 1
        mid = str(m.get("match_id") or m.get("match_number") or "")
        if mid in ov and isinstance(ov[mid], dict):
            b.update(ov[mid]); b["source"] = "official"
        m.setdefault("broadcast", {})["us"] = b

    json.dump(sched, open(dpath("schedule_full.json"), "w"), indent=2)
    print(f"broadcast: {n} matches · {exact} from ESPN (exact channels"
          f"{f'; {kfill} via kickoff-match for placeholder/knockout' if kfill else ''}) · "
          f"{n - exact} on default FOX/Telemundo · {datetime.now(timezone.utc).date()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
