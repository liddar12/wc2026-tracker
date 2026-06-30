#!/usr/bin/env python3
"""refresh_players.py — RJ30-7: unfreeze data/players.json from free ESPN rosters.

data/players.json is a FLAT list of player rows that feeds the Golden Boot
(app/lib/golden-boot.js) and the Golden Awards (app/lib/golden-awards.js). It was
frozen at the 2026-05-27 snapshot, so a cut player still projects and a fresh
call-up never appears. This script refreshes the *roster membership* of teams
still alive in the tournament from ESPN's free fifa.world roster endpoint while
PRESERVING the offline-derived base ratings (overall/scoring/offense/defense/
pace/efficiency) — those have no free per-player live source and recomputing them
would destabilize the z-scored Awards field.

Design (see docs/rj30/RJ30-E-squads-bugs.md):
  - PRESERVE base ratings for every player already present (match by
    (team, normalized-name)). Never recompute ratings from the roster feed.
  - UPDATE roster membership only for ACTIVE teams: append new call-ups with a
    conservative default rating (so a new name can't top the Boot/Ball), drop
    players ESPN no longer lists, refresh club/age when ESPN provides them.
  - ELIMINATED teams are left UNTOUCHED (z-score stability + non-blank pages).
  - SAFE-BY-DEFAULT: an ESPN outage/empty roster keeps prior rows; a refresh that
    would drop > DROP_FRAC of a team's prior count (or shrink the whole list
    below MIN_TOTAL) aborts that team's write and keeps prior. Always exits 0.
  - LIVE GOALS are max-merged into row.goals (display only) from
    match_events.json + scorers.json; the deterministic Boot reads live goals
    from events, NOT players.json.goals, so this is cosmetic and cannot move odds.

Run from repo root:
    python3 scripts/refresh_players.py
    python3 scripts/refresh_players.py --self-test   # pure-logic guards, no network

Free endpoint (same fifa.world family already used by scrape_scorers.py):
    GET https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams?search={team}
    GET https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams/{tid}/roster
"""
from __future__ import annotations

import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world"
UA = {"User-Agent": "wc26-tracker/1.0", "Accept": "application/json"}
MIN_INTERVAL = 0.7  # seconds between ESPN requests (mirrors scrape_lineups.py)
_last = 0.0

# ESPN position abbreviations → our {GK,DEF,MID,FWD}. Unknown → MID so the Boot
# still considers a call-up at MID weight (and validate's VALID_POSITIONS holds).
POSITION_MAP = {
    "G": "GK", "GK": "GK", "GOALKEEPER": "GK",
    "D": "DEF", "DEF": "DEF", "DEFENDER": "DEF", "CB": "DEF", "LB": "DEF", "RB": "DEF",
    "M": "MID", "MID": "MID", "MIDFIELDER": "MID", "CM": "MID", "DM": "MID", "AM": "MID",
    "F": "FWD", "FW": "FWD", "FWD": "FWD", "FORWARD": "FWD", "ST": "FWD", "W": "FWD",
}

# Conservative default rating for a new ESPN call-up (low z-score; cannot top
# Boot/Ball/Glove). Matches the acceptance criteria in US-7.1.
DEFAULT_RATING = {
    "overall": 50, "scoring": 30, "offense": 30,
    "defense": 50, "pace": 40, "efficiency": 50, "goals": 0,
}
RATING_KEYS = ("overall", "scoring", "offense", "defense", "pace", "efficiency")

# Safety floors (US-7.4): never shrink the whole list below MIN_TOTAL, and never
# drop more than DROP_FRAC of a single active team's prior roster in one run.
MIN_TOTAL = 600
DROP_FRAC = 0.40

# Same accent/punct strip the app uses (app/lib/golden-boot.js normPlayerName):
# NFD strip diacritics, keep alnum, lowercase — so ESPN "Julián Quiñones" merges
# with the squad list's "Julian Quinones" (no duplicate insert).
def norm_name(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return "".join(c for c in s if c.isalnum()).lower()


def log(m):
    print(f"[refresh_players] {m}", file=sys.stderr, flush=True)


def _get(url):
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
        log(f"GET fail {url[:72]}…: {e}")
        return None


def load(name):
    p = DATA / name
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def save_players(players):
    # Atomic + ensure_ascii=True (repo on-disk convention — no diff churn; the
    # staleness watchdog & other writers compare the same encoding).
    path = DATA / "players.json"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(players, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)
    log(f"wrote players.json ({len(players)} rows)")


# ---- active-team gating ----------------------------------------------------
def active_teams(schedule, forecast, now=None):
    """A team is ACTIVE if it has a FUTURE fixture in schedule_full.json OR any
    remaining round-reach probability in forecast.json. Eliminated → untouched."""
    now = now or datetime.now(timezone.utc)
    active = set()
    rows = schedule if isinstance(schedule, list) else (schedule or {}).get("matches", [])
    for m in rows or []:
        ko = m.get("kickoff_utc")
        try:
            k = datetime.fromisoformat(str(ko).replace("Z", "+00:00")) if ko else None
        except ValueError:
            k = None
        if k and k > now:
            for t in (m.get("team_a"), m.get("team_b")):
                if t and not _is_placeholder(t):
                    active.add(t)
    for r in ((forecast or {}).get("teams") or []):
        t = r.get("team")
        reach = (r.get("r32", 0) or 0) + (r.get("r16", 0) or 0) + (r.get("qf", 0) or 0) \
            + (r.get("sf", 0) or 0) + (r.get("final", 0) or 0)
        if t and reach > 0:
            active.add(t)
    return active


def _is_placeholder(s):
    if not isinstance(s, str):
        return True
    return bool(re.match(r"^\d[A-L]$|^3 [A-L]+$|^W\d+$|^L\d+$", s))


# ---- ESPN roster fetch -----------------------------------------------------
def espn_team_id(team):
    data = _get(f"{ESPN}/teams?search={urllib.parse.quote(team)}")
    if not data:
        return None
    arr = ((data.get("sports") or [{}])[0].get("leagues") or [{}])[0].get("teams") or []
    for entry in arr:
        t = (entry or {}).get("team") or {}
        if (t.get("name") or "").lower() == team.lower() or (t.get("displayName") or "").lower() == team.lower():
            return t.get("id")
    # fall back to the first result when the names don't match exactly
    for entry in arr:
        t = (entry or {}).get("team") or {}
        if t.get("id"):
            return t.get("id")
    return None


def espn_roster(tid):
    """Return [{displayName, position, age, club}, ...] for a team id, or []."""
    data = _get(f"{ESPN}/teams/{tid}/roster")
    if not data:
        return []
    athletes = data.get("athletes") or []
    # ESPN roster may be flat (list of athletes) or grouped by position bucket.
    out = []
    for a in athletes:
        if isinstance(a, dict) and "items" in a:  # grouped shape
            for it in a.get("items") or []:
                out.append(_espn_athlete(it))
        else:
            out.append(_espn_athlete(a))
    return [x for x in out if x and x.get("displayName")]


def _espn_athlete(a):
    a = a or {}
    pos = (a.get("position") or {})
    abbr = (pos.get("abbreviation") or pos.get("name") or "").upper()
    club = None
    team = a.get("team") or {}
    if isinstance(team, dict):
        club = team.get("displayName") or team.get("name")
    return {
        "displayName": a.get("displayName") or a.get("fullName"),
        "position": POSITION_MAP.get(abbr, "MID"),
        "age": a.get("age"),
        "club": club,
    }


# ---- within-team de-dup ----------------------------------------------------
def _dedup_by_norm(rows):
    """Collapse rows that share a norm_name within a single team (the squad
    snapshot shipped a few — e.g. two 'Cesar Huerta' rows for Mexico). Keep the
    higher-`overall` row (more rating signal), preserving first-seen order. The
    Boot/Awards index by name, so a duplicate would otherwise double-count or
    shadow — and the output contract forbids duplicate (team, normPlayerName)."""
    best = {}
    order = []
    for r in rows:
        nk = norm_name(r.get("name"))
        if nk not in best:
            best[nk] = r
            order.append(nk)
        else:
            cur = best[nk]
            if (r.get("overall", 0) or 0) > (cur.get("overall", 0) or 0):
                best[nk] = r
    return [best[nk] for nk in order]


# ---- pure merge (unit-tested via --self-test) ------------------------------
def merge_team(prior_rows, espn_roster_list, team, group_default):
    """Merge one ACTIVE team's prior rows with its ESPN roster.

    PRESERVES base ratings for matched players; appends default-rated call-ups
    (in first-seen ESPN order at the END of the team block); drops players absent
    from ESPN ONLY when the safety floor allows. ESPN-empty → keep all prior.
    Returns the new list of rows for this team (orientation: existing first, then
    new call-ups appended).

    SAFETY FLOOR (US-7.4): if applying ESPN's roster would drop > DROP_FRAC of
    this team's prior rows, the two squad lists have diverged too far to trust the
    diff (ESPN naming vs the offline squad snapshot) — so we ABORT the whole write
    for that team and keep its prior rows BYTE-IDENTICAL. We do NOT append in that
    case: appending a full ESPN roster on top of an unmatched prior squad would
    bloat the team to ~50 rows and destabilize the z-scored Awards field. "Keep
    prior" means exactly that.
    """
    if not espn_roster_list:
        return list(prior_rows)  # outage/empty → keep prior unchanged

    group = group_default
    for r in prior_rows:
        if r.get("group"):
            group = r.get("group")
            break

    # Surviving prior rows (still on ESPN's roster), ratings preserved.
    kept = []
    dropped = 0
    espn_by_norm = {}
    for a in espn_roster_list:
        nk = norm_name(a.get("displayName"))
        if nk and nk not in espn_by_norm:
            espn_by_norm[nk] = a
    for r in prior_rows:
        nk = norm_name(r.get("name"))
        if nk in espn_by_norm:
            a = espn_by_norm[nk]
            new = dict(r)  # preserve ALL existing fields incl. ratings
            if a.get("age") is not None:
                new["age"] = a["age"]
            if a.get("club"):
                new["club"] = a["club"]
            if a.get("position"):
                new["position"] = a["position"]
            kept.append(new)
        else:
            dropped += 1

    # Safety floor: if dropping would remove > DROP_FRAC of this team's prior
    # roster, the squad lists have diverged too far — abort the WHOLE write for
    # this team and keep prior rows untouched (no drops AND no appends).
    prior_n = len(prior_rows)
    if prior_n and dropped / prior_n > DROP_FRAC:
        log(f"{team}: would drop {dropped}/{prior_n} (> {int(DROP_FRAC*100)}%) — keeping prior untouched")
        return [dict(r) for r in prior_rows]

    kept_norms = {norm_name(r.get("name")) for r in kept}
    # Append new ESPN call-ups (first-seen order) that aren't already present.
    seen = set(kept_norms)
    for a in espn_roster_list:
        nk = norm_name(a.get("displayName"))
        if not nk or nk in seen:
            continue
        seen.add(nk)
        row = {
            "name": a["displayName"],
            "team": team,
            "group": group,
            "position": a.get("position") or "MID",
            "club": a.get("club") or "",
            "caps": 0,
            "age": a.get("age") if a.get("age") is not None else 0,
            **DEFAULT_RATING,
        }
        kept.append(row)
    return kept


# ---- live-goal max-merge ---------------------------------------------------
def tournament_goals(match_events, scorers):
    """norm_name → tournament goals (max across the two sources)."""
    goals = {}
    me = match_events or {}
    if isinstance(me, dict):
        for k, rec in me.items():
            if k == "__meta__" or not isinstance(rec, dict):
                continue
            for e in rec.get("events") or []:
                if e.get("type") in ("goal", "pen-goal") and e.get("player"):
                    nk = norm_name(e["player"])
                    goals[nk] = goals.get(nk, 0) + 1
    sc = scorers or {}
    if isinstance(sc, dict):
        for team, rows in sc.items():
            if team == "__meta__" or not isinstance(rows, list):
                continue
            for r in rows:
                nm = r.get("name") or r.get("player")
                g = r.get("goals")
                if nm and isinstance(g, (int, float)):
                    nk = norm_name(nm)
                    goals[nk] = max(goals.get(nk, 0), int(g))
    elif isinstance(sc, list):
        for r in sc:
            nm = r.get("player") or r.get("name")
            g = r.get("goals")
            if nm and isinstance(g, (int, float)):
                nk = norm_name(nm)
                goals[nk] = max(goals.get(nk, 0), int(g))
    return goals


def apply_live_goals(players, goals):
    """row.goals = max(existing, tournament) — idempotent, never decremented."""
    for r in players:
        nk = norm_name(r.get("name"))
        tg = goals.get(nk, 0)
        if tg:
            r["goals"] = max(int(r.get("goals", 0) or 0), tg)
    return players


# ---- main ------------------------------------------------------------------
def main():
    players = load("players.json")
    if not isinstance(players, list) or not players:
        log("players.json missing/empty — nothing to refresh")
        return 0
    teams = load("teams.json") or {}
    schedule = load("schedule_full.json")
    forecast = load("forecast.json")

    active = active_teams(schedule, forecast)
    log(f"{len(active)} active team(s)")

    # Index prior rows by team, preserving first-seen order.
    by_team = {}
    order = []
    for r in players:
        t = r.get("team")
        if t not in by_team:
            by_team[t] = []
            order.append(t)
        by_team[t].append(r)

    refreshed = 0
    for team in order:
        if team not in active:
            continue  # eliminated / not-yet-active → untouched
        tid = espn_team_id(team)
        if not tid:
            log(f"{team}: ESPN team-id miss — keeping prior rows")
            continue
        roster = espn_roster(tid)
        if not roster:
            log(f"{team}: empty ESPN roster — keeping prior rows")
            continue
        group_default = (teams.get(team) or {}).get("group", "")
        new_rows = merge_team(by_team[team], roster, team, group_default)
        if new_rows != by_team[team]:
            by_team[team] = new_rows
            refreshed += 1

    # Rebuild the flat list in the original team order; new call-ups appended at
    # the end of their team block (do not re-sort the whole list). Collapse any
    # within-team norm_name duplicates the snapshot shipped (a handful — e.g. two
    # 'Cesar Huerta' rows for Mexico) so the output never carries a duplicate
    # (team, normPlayerName) pair the Boot/Awards would double-count. This is
    # data-cleaning (an accidental exact-name dupe), not roster churn, so it runs
    # for every team incl. eliminated ones.
    out = []
    for team in order:
        out.extend(_dedup_by_norm(by_team[team]))

    # Whole-list safety floor: never shrink below MIN_TOTAL.
    if len(out) < MIN_TOTAL:
        log(f"refused: refreshed list {len(out)} < floor {MIN_TOTAL} — keeping prior players.json")
        return 0

    # Live-goal max-merge (display-only; cannot move the deterministic Boot).
    goals = tournament_goals(load("match_events.json"), load("scorers.json"))
    apply_live_goals(out, goals)

    if out != players:
        save_players(out)
        log(f"refreshed {refreshed} active team(s); {len(out)} rows total")
    else:
        log("no changes")
    return 0


# ---- self-test (pure, no network) ------------------------------------------
def _self_test():
    # US-7.1: preserve ratings, append default-rated call-up
    prior = [{"name": "Old Star", "team": "X", "group": "A", "position": "FWD",
              "overall": 88, "scoring": 90, "offense": 85, "defense": 40,
              "pace": 80, "efficiency": 75, "goals": 3, "club": "C", "caps": 50, "age": 28}]
    roster = [{"displayName": "Old Star", "position": "FWD", "age": 29, "club": "C2"},
              {"displayName": "New Kid", "position": "MID", "age": 19, "club": "C3"}]
    out = merge_team(prior, roster, "X", "A")
    old = next(r for r in out if r["name"] == "Old Star")
    new = next(r for r in out if r["name"] == "New Kid")
    assert old["overall"] == 88 and old["scoring"] == 90, old
    assert old["age"] == 29 and old["club"] == "C2", old  # club/age refreshed
    assert new["overall"] == 50 and new["scoring"] == 30, new
    assert new["team"] == "X" and new["group"] == "A", new
    assert out.index(old) < out.index(new), "call-up appended after existing"

    # US-7.1 drop: [A,B,C] vs ESPN [A,B] → C dropped (1/3 = 33% < 40%)
    p3 = [{"name": n, "team": "X", "group": "A", "position": "MID",
           "overall": 60, "scoring": 50, "offense": 50, "defense": 50,
           "pace": 50, "efficiency": 50, "goals": 0} for n in ("A", "B", "C")]
    out = merge_team(p3, [{"displayName": "A"}, {"displayName": "B"}], "X", "A")
    assert {r["name"] for r in out} == {"A", "B"}, out

    # Safety floor: dropping 2/3 (67% > 40%) → keep all prior, append-only
    out = merge_team(p3, [{"displayName": "A"}], "X", "A")
    assert {r["name"] for r in out} == {"A", "B", "C"}, out

    # US-7.4: ESPN empty → keep prior [A,B,C]
    out = merge_team(p3, [], "X", "A")
    assert {r["name"] for r in out} == {"A", "B", "C"}, out

    # norm_name merges accents (no duplicate)
    pq = [{"name": "Julián Quiñones", "team": "X", "group": "A", "position": "FWD",
           "overall": 70, "scoring": 70, "offense": 70, "defense": 40,
           "pace": 70, "efficiency": 60, "goals": 1}]
    out = merge_team(pq, [{"displayName": "Julian Quinones", "position": "FWD"}], "X", "A")
    assert len(out) == 1 and out[0]["overall"] == 70, out

    # live goals max-merge (idempotent, never decrement)
    rows = [{"name": "Scorer", "team": "X", "goals": 2}]
    g = tournament_goals({"M1": {"events": [{"type": "goal", "player": "Scorer"},
                                            {"type": "pen-goal", "player": "Scorer"},
                                            {"type": "goal", "player": "Scorer"}]}}, None)
    apply_live_goals(rows, g)
    assert rows[0]["goals"] == 3, rows  # max(2, 3 tournament)
    apply_live_goals(rows, g)  # re-run
    assert rows[0]["goals"] == 3, rows  # idempotent

    # eliminated team untouched: active_teams excludes a team with no future game
    sched = [{"team_a": "X", "team_b": "Y", "kickoff_utc": "2030-01-01T00:00:00Z"}]
    fc = {"teams": [{"team": "Z", "r32": 0, "r16": 0, "qf": 0, "sf": 0, "final": 0}]}
    act = active_teams(sched, fc)
    assert "X" in act and "Y" in act and "Z" not in act, act

    print("refresh_players self-test: OK")
    return 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(_self_test())
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}")
        raise SystemExit(0)
