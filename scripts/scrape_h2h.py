#!/usr/bin/env python3
"""Head-to-head history scraper (ESPN).

For every group-stage matchup, pulls recent meetings between the two teams from
ESPN's match summary (`headToHeadGames`) and writes the 5 most-recent into
data/h2h.json keyed by "<team_a>__vs__<team_b>", as rows
  { date, comp, score_a, score_b, winner }
oriented to team_a/team_b (winner = a canonical team name or 'draw').

Replaces the previous club-league source, which never carried national-team
meetings — so h2h.json always came back empty.

ESPN public endpoints (no key). Safe under continue-on-error: on any failure we
keep existing entries and exit 0.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SB = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary"
UA = {"User-Agent": "wc26-tracker/1.0", "Accept": "application/json"}
MIN_INTERVAL = 0.7

# ESPN display names → our canonical teams.json keys (only the differing ones).
ESPN_TO_TEAM = {
    "United States": "USA", "South Korea": "Korea Republic", "Türkiye": "Turkiye",
    "Turkey": "Turkiye", "Czech Republic": "Czechia", "Cape Verde": "Cabo Verde",
    "Ivory Coast": "Cote d'Ivoire", "IR Iran": "Iran", "Congo DR": "DR Congo",
    "Bosnia & Herzegovina": "Bosnia and Herzegovina", "Bosnia-Herzegovina": "Bosnia and Herzegovina",
}
_last = 0.0


def log(m): print(f"[h2h] {m}", file=sys.stderr, flush=True)
def norm(n): n = (n or "").strip(); return ESPN_TO_TEAM.get(n, n)


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
        log(f"GET fail {url[:64]}…: {e}")
        return None


def main():
    sched = json.loads((DATA / "schedule_full.json").read_text())
    rows = sched if isinstance(sched, list) else sched.get("matches", [])
    matches = [(m["team_a"], m["team_b"], (m.get("kickoff_utc") or "")[:10])
               for m in rows
               if m.get("stage") == "group" and m.get("team_a") and m.get("team_b")]

    try:
        out = json.loads((DATA / "h2h.json").read_text())
        if not isinstance(out, dict):
            out = {}
    except Exception:  # noqa: BLE001
        out = {}

    # Index ESPN event ids by team-set, querying each match date's scoreboard once.
    event_by_pair = {}
    for d in sorted({d for _, _, d in matches if d}):
        data = get(f"{SB}?dates={d.replace('-', '')}")
        for ev in (data or {}).get("events", []):
            comp = (ev.get("competitions") or [{}])[0]
            names = [norm((c.get("team") or {}).get("displayName") or (c.get("team") or {}).get("name"))
                     for c in comp.get("competitors", [])]
            names = [n for n in names if n]
            if len(names) == 2 and ev.get("id"):
                event_by_pair[frozenset(names)] = ev["id"]

    fetched = 0
    for a, b, _ in matches:
        eid = event_by_pair.get(frozenset((a, b)))
        if not eid:
            continue
        s = get(f"{SUMMARY}?event={eid}")
        if not s:
            continue
        # ESPN team id → our canonical name (from the summary header competitors)
        hcomp = (s.get("header", {}).get("competitions") or [{}])[0]
        idname = {}
        for c in hcomp.get("competitors", []):
            tid = str((c.get("team") or {}).get("id") or c.get("id") or "")
            nm = norm((c.get("team") or {}).get("displayName") or (c.get("team") or {}).get("name"))
            if tid and nm:
                idname[tid] = nm

        seen, uniq = set(), []
        for block in s.get("headToHeadGames", []):
            for ev in block.get("events", []):
                hname = idname.get(str(ev.get("homeTeamId") or ""))
                aname = idname.get(str(ev.get("awayTeamId") or ""))
                if hname not in (a, b) or aname not in (a, b) or hname == aname:
                    continue
                try:
                    hs, as_ = int(ev.get("homeTeamScore")), int(ev.get("awayTeamScore"))
                except (TypeError, ValueError):
                    continue
                score_a, score_b = (hs, as_) if hname == a else (as_, hs)
                winner = a if score_a > score_b else (b if score_b > score_a else "draw")
                date = (ev.get("gameDate") or "")[:10]
                key = (date, score_a, score_b)
                if key in seen:
                    continue
                seen.add(key)
                uniq.append({
                    "date": date,
                    "comp": ev.get("competitionName") or ev.get("leagueName"),
                    "score_a": score_a, "score_b": score_b, "winner": winner,
                })
        if uniq:
            uniq.sort(key=lambda r: r["date"], reverse=True)
            out[f"{a}__vs__{b}"] = uniq[:5]
            fetched += 1

    out.setdefault("__meta__", {})
    out["__meta__"]["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out["__meta__"]["source"] = "espn"
    (DATA / "h2h.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    log(f"h2h: refreshed {fetched}/{len(matches)} pairings (ESPN)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"h2h: fatal — {e}; continuing")
        raise SystemExit(0)
