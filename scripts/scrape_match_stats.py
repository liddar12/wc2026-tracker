#!/usr/bin/env python3
"""Per-match boxscore stats + a compact key-events timeline from ESPN's summary
endpoint → data/match_stats.json.

Powers the RJ30.2 "Match Intelligence" panel on the matchup page (possession
bar, shots / on-target, passing %, key stats, momentum timeline, smart
insights, shots-vs-model-xG).

Data source (verified free, already used by the app):
  scoreboard → https://…/soccer/fifa.world/scoreboard?dates=YYYYMMDD  (event ids)
  summary    → https://…/soccer/fifa.world/summary?event=<id>         (boxscore)

boxscore.teams[].statistics carries per-team names:
  possessionPct, totalShots, shotsOnTarget, blockedShots, shotPct, totalPasses,
  passPct, accuratePasses, saves, effectiveTackles, foulsCommitted, offsides,
  totalCrosses (+ wonCorners). ESPN reports shotPct/passPct/crossPct as
  FRACTIONS (0.8 = 80%); we normalize those to 0-100 percent so the client can
  render them directly.

Output — keyed by schedule_full match_id ("<A>__vs__<B>"):
  { "<A__vs__B>": {
      "team_a": "Mexico", "team_b": "South Africa",
      "stats": { "a": {possessionPct, totalShots, …}, "b": {…} },
      "key_events": [ { "minute": "39", "type": "goal", "team": "Norway" }, … ],
      "updated_at": "ISO"
    }, …, "__meta__": { "updated_at": "ISO", "source": "espn-summary", "matches": N } }

Skips matches with no boxscore yet (pre-match → no zeros-for-everything row).
Failures keep existing data and exit 0 (safe under continue-on-error).

Run from repo root:
    python3 scripts/scrape_match_stats.py
    python3 scripts/scrape_match_stats.py --self-test
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SB = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary"
UA = {"User-Agent": "wc26-tracker/1.0", "Accept": "application/json"}
MIN_INTERVAL = 0.7
# Only pull stats for matches near now: live games + same-day backfill. Older
# matches' stats are already final; future ones have no boxscore.
WINDOW_BACK_H, WINDOW_FWD_H = 30, 2

# ESPN display names → canonical teams.json keys (mirrors live-scores.js RENAMES
# and the other scrapers' TEAM_RENAMES — keep in sync).
TEAM_RENAMES = {
    "United States": "USA", "South Korea": "Korea Republic", "Türkiye": "Turkiye",
    "Turkey": "Turkiye", "Czech Republic": "Czechia", "Cape Verde": "Cabo Verde",
    "Ivory Coast": "Cote d'Ivoire", "IR Iran": "Iran", "Congo DR": "DR Congo",
    "Bosnia & Herzegovina": "Bosnia and Herzegovina",
    "Bosnia-Herzegovina": "Bosnia and Herzegovina", "Curaçao": "Curacao",
}

# The boxscore stat names we surface. Order matters only for readability.
WANTED_STATS = (
    "possessionPct", "totalShots", "shotsOnTarget", "blockedShots", "shotPct",
    "totalPasses", "passPct", "accuratePasses", "saves", "effectiveTackles",
    "foulsCommitted", "offsides", "totalCrosses", "wonCorners",
)
# ESPN reports these three as fractions (0.8 → 80%); normalize to 0-100.
FRACTION_PCT = frozenset({"shotPct", "passPct", "crossPct"})

# ESPN keyEvents type.text → compact type. Unmapped rows (Kickoff, Delay,
# Halftime, Substitution, …) are skipped — mirrors scrape_match_events.py.
EVENT_TYPES = {
    "Goal": "goal", "Goal - Header": "goal", "Goal - Free-kick": "goal",
    "Goal - Volley": "goal", "Own Goal": "own-goal",
    "Penalty - Scored": "pen-goal", "Penalty - Missed": "pen-miss",
    "Yellow Card": "yellow", "Red Card": "red",
}

_last = 0.0


def log(m):
    print(f"[stats] {m}", file=sys.stderr, flush=True)


def norm(n):
    n = (n or "").strip()
    return TEAM_RENAMES.get(n, n)


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


def in_window(kick_iso, now):
    try:
        k = datetime.fromisoformat(str(kick_iso).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return False
    return now - timedelta(hours=WINDOW_BACK_H) <= k <= now + timedelta(hours=WINDOW_FWD_H)


def _num(v):
    """ESPN stat displayValues are strings ("14", "47.1", "0.8"). Coerce to a
    number; ints stay ints, floats stay floats; unparseable → None."""
    if v is None:
        return None
    s = str(v).strip().rstrip("%")
    if s == "" or s == "-":
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return int(f) if f.is_integer() else round(f, 2)


def stats_from_team(team_block):
    """One boxscore.teams[] entry → { statName: number } for the WANTED_STATS.

    Pure. Normalizes ESPN's fraction percents (0.8 → 80) so the client renders
    a straight 0-100 value. Missing/blank stats are simply omitted.
    """
    by_name = {}
    for s in team_block.get("statistics") or []:
        name = s.get("name")
        if name in WANTED_STATS or name in FRACTION_PCT:
            by_name[name] = s.get("displayValue")
    out = {}
    for name in WANTED_STATS:
        val = _num(by_name.get(name))
        if val is None:
            continue
        if name in FRACTION_PCT and val is not None and val <= 1.0:
            val = round(val * 100, 1)
        out[name] = val
    return out


def key_events_from(summary):
    """summary.keyEvents → compact [{minute, type, team}] (goals/cards only)."""
    out = []
    for e in summary.get("keyEvents") or []:
        raw = ((e.get("type") or {}).get("text") or "").strip()
        kind = EVENT_TYPES.get(raw)
        if not kind:
            continue
        minute = ((e.get("clock") or {}).get("displayValue") or "").rstrip("'")
        team = norm((e.get("team") or {}).get("displayName"))
        out.append({"minute": minute, "type": kind, "team": team or ""})
    return out


def build_row(sched_a, sched_b, summary):
    """Pure: schedule orientation (team_a/team_b) + an ESPN summary dict →
    the match_stats row, or None when there's no usable boxscore (pre-match).

    Orients the two boxscore.teams[] to schedule team_a/team_b via canonical
    name match (home/away is irrelevant to us). Returns None if either side's
    stats are empty — so a scheduled-but-unplayed match never writes a
    zeros-for-everything row.
    """
    teams = (summary.get("boxscore") or {}).get("teams") or []
    if len(teams) != 2:
        return None
    by_name = {}
    for tb in teams:
        nm = norm((tb.get("team") or {}).get("displayName") or (tb.get("team") or {}).get("name"))
        if nm:
            by_name[nm] = tb
    a_block = by_name.get(sched_a)
    b_block = by_name.get(sched_b)
    if a_block is None or b_block is None:
        return None
    a_stats = stats_from_team(a_block)
    b_stats = stats_from_team(b_block)
    if not a_stats or not b_stats:
        return None
    return {
        "team_a": sched_a,
        "team_b": sched_b,
        "stats": {"a": a_stats, "b": b_stats},
        "key_events": key_events_from(summary),
    }


def main():
    now = datetime.now(timezone.utc)
    sched = json.loads((DATA / "schedule_full.json").read_text())
    rows = sched if isinstance(sched, list) else sched.get("matches", [])
    if "--backfill" in sys.argv:
        # One-time historical sweep: every already-kicked-off match with real
        # team names, regardless of the recency window. ESPN keeps serving
        # boxscores for past matches, so this recovers stats for games played
        # before this scraper existed. Skips rows already on disk (their stats
        # are final) unless --force is also given.
        existing = {} if "--force" in sys.argv else _load_existing()

        def kicked_off(m):
            try:
                k = datetime.fromisoformat(str(m.get("kickoff_utc")).replace("Z", "+00:00"))
            except (ValueError, TypeError):
                return False
            return k <= now

        targets = [m for m in rows
                   if m.get("team_a") and m.get("team_b") and kicked_off(m)
                   and f"{m['team_a']}__vs__{m['team_b']}" not in existing]
        log(f"backfill: {len(targets)} played matches missing stats")
    else:
        targets = [m for m in rows
                   if m.get("team_a") and m.get("team_b") and in_window(m.get("kickoff_utc"), now)]
    if not targets:
        log("no matches in window")
        # Still stamp meta so the freshness row is never "never".
        _stamp_and_write(_load_existing(), now, 0)
        return 0

    out = _load_existing()

    # Join scoreboard events → schedule pairs to get ESPN event ids.
    event_by_pair = {}
    for d in sorted({str(m.get("kickoff_utc"))[:10].replace("-", "") for m in targets}):
        data = get(f"{SB}?dates={d}")
        for ev in (data or {}).get("events", []):
            comp = (ev.get("competitions") or [{}])[0]
            names = [norm((c.get("team") or {}).get("displayName")) for c in comp.get("competitors", [])]
            names = [n for n in names if n]
            if len(names) == 2 and ev.get("id"):
                event_by_pair[frozenset(names)] = ev["id"]

    updated = 0
    for m in targets:
        a, b = m["team_a"], m["team_b"]
        eid = event_by_pair.get(frozenset((a, b)))
        if not eid:
            continue
        summary = get(f"{SUMMARY}?event={eid}")
        if not summary:
            continue
        row = build_row(a, b, summary)
        if row is None:
            continue  # pre-match / no boxscore yet — skip gracefully
        row["updated_at"] = now.isoformat(timespec="seconds")
        out[f"{a}__vs__{b}"] = row
        updated += 1

    _stamp_and_write(out, now, updated)
    log(f"stats: {updated}/{len(targets)} matches updated")
    return 0


def _load_existing():
    try:
        out = json.loads((DATA / "match_stats.json").read_text())
        return out if isinstance(out, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def _stamp_and_write(out, now, updated):
    match_count = sum(1 for k in out if k != "__meta__")
    out.setdefault("__meta__", {})
    out["__meta__"].update({
        "updated_at": now.isoformat(timespec="seconds"),
        "source": "espn-summary",
        "matches": match_count,
        "last_run_updated": updated,
    })
    # ensure_ascii=True matches the repo's on-disk encoding convention.
    (DATA / "match_stats.json").write_text(
        json.dumps(out, ensure_ascii=True, indent=2) + "\n")
    log(f"wrote {DATA / 'match_stats.json'}")


def _self_test():
    """Pure self-test of stats_from_team / build_row / key_events_from.

    Run: python3 scripts/scrape_match_stats.py --self-test
    """
    # A realistic two-team summary (ESPN fraction percents on shotPct/passPct).
    summary = {
        "boxscore": {"teams": [
            {"team": {"displayName": "Ivory Coast"}, "statistics": [
                {"name": "possessionPct", "displayValue": "47.1"},
                {"name": "totalShots", "displayValue": "14"},
                {"name": "shotsOnTarget", "displayValue": "5"},
                {"name": "shotPct", "displayValue": "0.4"},
                {"name": "passPct", "displayValue": "0.8"},
                {"name": "accuratePasses", "displayValue": "339"},
                {"name": "totalPasses", "displayValue": "401"},
                {"name": "saves", "displayValue": "1"},
                {"name": "foulsCommitted", "displayValue": "6"},
                {"name": "offsides", "displayValue": "2"},
            ]},
            {"team": {"displayName": "Norway"}, "statistics": [
                {"name": "possessionPct", "displayValue": "52.9"},
                {"name": "totalShots", "displayValue": "9"},
                {"name": "shotsOnTarget", "displayValue": "4"},
                {"name": "passPct", "displayValue": "0.85"},
            ]},
        ]},
        "keyEvents": [
            {"type": {"text": "Kickoff"}, "clock": {"displayValue": ""}, "team": None},
            {"type": {"text": "Goal"}, "clock": {"displayValue": "39'"}, "team": {"displayName": "Norway"}},
            {"type": {"text": "Yellow Card"}, "clock": {"displayValue": "45'+1'"}, "team": {"displayName": "Norway"}},
            {"type": {"text": "Substitution"}, "clock": {"displayValue": "60'"}, "team": {"displayName": "Norway"}},
        ],
    }

    # 1) stats_from_team: fraction percents normalized to 0-100; ints stay ints.
    a = stats_from_team(summary["boxscore"]["teams"][0])
    assert a["possessionPct"] == 47.1, a
    assert a["totalShots"] == 14 and a["shotsOnTarget"] == 5, a
    assert a["shotPct"] == 40.0, a          # 0.4 → 40
    assert a["passPct"] == 80.0, a          # 0.8 → 80
    assert a["accuratePasses"] == 339, a

    # 2) build_row: canonical rename (Ivory Coast → Cote d'Ivoire) + orientation.
    row = build_row("Cote d'Ivoire", "Norway", summary)
    assert row is not None, "row built"
    assert row["team_a"] == "Cote d'Ivoire" and row["team_b"] == "Norway", row
    assert row["stats"]["a"]["totalShots"] == 14, row
    assert row["stats"]["b"]["totalShots"] == 9, row

    # 3) key_events: only goals/cards, minute stripped of apostrophes.
    ke = row["key_events"]
    assert [e["type"] for e in ke] == ["goal", "yellow"], ke
    assert ke[0]["minute"] == "39" and ke[0]["team"] == "Norway", ke
    assert ke[1]["minute"] == "45'+1", ke     # inner apostrophe preserved

    # 4) pre-match / no boxscore → None (no zeros-for-everything row).
    assert build_row("A", "B", {"boxscore": {"teams": []}}) is None
    # 5) unknown teams (orientation mismatch) → None.
    assert build_row("Wrong", "Teams", summary) is None
    # 6) empty stats side → None.
    empty = {"boxscore": {"teams": [
        {"team": {"displayName": "X"}, "statistics": []},
        {"team": {"displayName": "Y"}, "statistics": []},
    ]}}
    assert build_row("X", "Y", empty) is None

    print("scrape_match_stats self-test: OK")
    return 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(_self_test())
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}; keeping existing data")
        raise SystemExit(0)
