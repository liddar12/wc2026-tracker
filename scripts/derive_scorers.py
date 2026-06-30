#!/usr/bin/env python3
"""Per-team top scorers DERIVED from data/match_events.json → data/scorers.json.

Replaces the dark scrape_scorers.py (which hit an ESPN team-statistics endpoint
that historically returns nothing). This derives the per-team top-3 scorers from
goal events we ALREADY have, at zero cost and no new network call.

Counting rule MIRRORS app/lib/golden-boot.js#liveGoalsByPlayer so the per-team
card and the live Golden-Boot leaderboard agree (the cross-feed invariant locked
by tests/feature/rj30-feeds-agree.test.mjs):
  • count an event as a goal for e.player iff e.type in {"goal","pen-goal"}
  • own-goal is EXCLUDED from any player's tally (it credits the opponent on the
    scoreboard, never the listed scorer — FIFA lists own-goals separately)
  • cards (yellow/red) never count
  • group by e.team (the scoring team on the event)
  • aggregate by accent-insensitive normalized name (mirror normPlayerName)
  • resolve to players.json canonical display name + club when a normalized
    match exists; else keep the event's raw name with club=null

Output (the existing per-team contract app/components/scorers.js consumes):
  data/scorers.json — { "<Team>": [ {name, goals, club}, ... top 3 ], …,
                        "__meta__": { updated_at } }

continue-on-error friendly; exits 0 on any error.
Self-test (no I/O): python3 scripts/derive_scorers.py --selftest
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import save_json, log  # type: ignore  # noqa: E402

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

GOAL_TYPES = {"goal", "pen-goal"}  # own-goal + cards excluded (matches golden-boot.js)


def load(name: str) -> Any:
    p = DATA_DIR / name
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def norm_player_name(s: Any) -> str:
    """Accent/punctuation-insensitive key — mirror of golden-boot.js#normPlayerName:
    NFD-decompose, strip combining marks, drop non-alphanumerics, lowercase."""
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s.lower())


def build_player_index(players: Any) -> dict[str, dict[str, Any]]:
    """normalized name → {name (canonical display), club} from players.json
    (a list of player objects). First-seen wins."""
    idx: dict[str, dict[str, Any]] = {}
    for p in (players if isinstance(players, list) else []):
        name = p.get("name")
        if not name:
            continue
        nk = norm_player_name(name)
        if nk and nk not in idx:
            idx[nk] = {"name": name, "club": p.get("club")}
    return idx


def derive(match_events: dict[str, Any], player_idx: dict[str, dict[str, Any]] | None = None,
           valid_teams: set[str] | None = None) -> dict[str, list[dict[str, Any]]]:
    """match_events → { team: [ {name, goals, club}, … top 3 by goals ] }.

    Groups by the scoring team (e.team). Aggregates per team by normalized name,
    keeping the first-seen raw display name and resolving canonical name + club
    from player_idx when available."""
    player_idx = player_idx or {}
    # team -> norm_name -> {name (raw first-seen), goals}
    by_team: dict[str, dict[str, dict[str, Any]]] = {}
    for k, rec in (match_events or {}).items():
        if k == "__meta__" or not isinstance(rec, dict):
            continue
        events = rec.get("events")
        if not isinstance(events, list):
            continue
        for e in events:
            if not isinstance(e, dict):
                continue
            if e.get("type") not in GOAL_TYPES:
                continue
            player = e.get("player")
            team = e.get("team")
            if not player or not team:
                continue
            if valid_teams is not None and team not in valid_teams:
                continue
            nk = norm_player_name(player)
            if not nk:
                continue
            tslot = by_team.setdefault(team, {})
            cur = tslot.get(nk)
            if cur is None:
                tslot[nk] = {"name": player, "goals": 1}
            else:
                cur["goals"] += 1

    out: dict[str, list[dict[str, Any]]] = {}
    for team, players in by_team.items():
        rows = []
        for nk, agg in players.items():
            resolved = player_idx.get(nk)
            name = resolved["name"] if resolved else agg["name"]
            club = resolved["club"] if resolved else None
            rows.append({"name": name, "goals": agg["goals"], "club": club})
        rows.sort(key=lambda r: (-r["goals"], r["name"]))
        out[team] = rows[:3]
    return out


# ----- orchestration -----

def main() -> int:
    existing = load("scorers.json")
    out: dict[str, Any] = existing if isinstance(existing, dict) else {}

    # Snapshot non-meta rows so we only bump updated_at (and only rewrite) when
    # the derived scorer set actually changed — a no-op bump would make the file
    # look fresh forever and defeat the staleness watchdog.
    before = {k: v for k, v in out.items() if k != "__meta__"}

    # Tournament-window gate (mirror scrape_scorers.py): pre-tournament, leave the
    # file empty so the UI surfaces "No tournament goals yet".
    today = datetime.now(timezone.utc).date()
    if today < datetime(2026, 6, 11, tzinfo=timezone.utc).date():
        log("scorers: pre-tournament; leaving file empty (no updated_at bump)")
        return 0

    match_events = load("match_events.json")
    if not isinstance(match_events, dict):
        log("scorers: no match_events.json; nothing to derive")
        return 0
    players = load("players.json")
    teams = load("teams.json")
    valid_teams = set(teams.keys()) if isinstance(teams, dict) else None

    derived = derive(match_events, build_player_index(players), valid_teams)

    # Replace the per-team rows with the freshly derived set (drop stale teams).
    new_out: dict[str, Any] = {team: rows for team, rows in derived.items()}
    after = {k: v for k, v in new_out.items()}
    if after == before:
        log("scorers: no data change; leaving updated_at untouched")
        return 0

    meta = out.get("__meta__") if isinstance(out.get("__meta__"), dict) else {}
    meta = dict(meta)
    meta["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    new_out["__meta__"] = meta
    save_json("scorers.json", new_out)
    log(f"scorers: derived {len(derived)} team(s) from match_events")
    return 0


def selftest() -> int:
    fail = 0

    def check(name: str, cond: bool) -> None:
        nonlocal fail
        print(f"  {'ok  ' if cond else 'FAIL'}: {name}")
        if not cond:
            fail += 1

    # own-goal/card excluded, pen-goal counted, accent-merge across matches.
    me = {
        "__meta__": {"updated_at": "2026-06-20T00:00:00+00:00"},
        "Mexico__vs__USA": {"events": [
            {"minute": "9'", "type": "goal", "player": "Julián Quiñones", "team": "Mexico"},
            {"minute": "17'", "type": "pen-goal", "player": "Raúl Jiménez", "team": "Mexico"},
            {"minute": "30'", "type": "own-goal", "player": "Foo Bar", "team": "Mexico"},
            {"minute": "45'", "type": "yellow", "player": "Baz", "team": "Mexico"},
        ]},
        "Mexico__vs__Canada": {"events": [
            # unaccented variant — must merge with the accented entry above.
            {"minute": "12'", "type": "goal", "player": "Julian Quinones", "team": "Mexico"},
        ]},
    }
    d = derive(me)
    mex = d.get("Mexico", [])
    by_name = {norm_player_name(r["name"]): r["goals"] for r in mex}

    check("Quiñones merged across matches = 2", by_name.get(norm_player_name("Julián Quiñones")) == 2)
    check("Jiménez pen-goal counted = 1", by_name.get(norm_player_name("Raúl Jiménez")) == 1)
    total = sum(r["goals"] for r in mex)
    check("Mexico total goals = 3 (2 Quiñones + 1 Jiménez pen)", total == 3)
    check("own-goal scorer 'Foo Bar' absent", norm_player_name("Foo Bar") not in by_name)
    check("card-only player 'Baz' absent", norm_player_name("Baz") not in by_name)
    check("entries are dicts with numeric goals + string name",
          all(isinstance(r["name"], str) and isinstance(r["goals"], int) for r in mex))
    check("sorted descending by goals", all(mex[i]["goals"] >= mex[i + 1]["goals"] for i in range(len(mex) - 1)))
    check("top-3 cap", len(mex) <= 3)

    # player index resolution → canonical name + club
    idx = build_player_index([
        {"name": "Julian Quinones", "club": "América"},
        {"name": "Raul Jimenez", "club": "Fulham"},
    ])
    d2 = derive(me, idx)
    mex2 = {norm_player_name(r["name"]): r for r in d2["Mexico"]}
    qrec = mex2[norm_player_name("Julián Quiñones")]
    check("resolved to players.json canonical name", qrec["name"] == "Julian Quinones")
    check("resolved club attached", qrec["club"] == "América")

    # raw fallback when no squad entry: club is None
    me3 = {"Brazil__vs__Japan": {"events": [
        {"type": "goal", "player": "Wonderkid X", "team": "Brazil"},
    ]}}
    d3 = derive(me3, {})
    check("unmatched scorer kept with club=None",
          d3["Brazil"][0]["name"] == "Wonderkid X" and d3["Brazil"][0]["club"] is None)

    # empty input → no team keys
    check("empty match_events → {}", derive({"__meta__": {}}) == {})

    # valid_teams gate drops an event for an unknown team
    me4 = {"X__vs__Y": {"events": [{"type": "goal", "player": "P", "team": "Atlantis"}]}}
    check("valid_teams gate drops unknown team", derive(me4, {}, {"Brazil"}) == {})

    print(f"selftest: {'PASS' if not fail else f'{fail} FAILURE(S)'}")
    return 1 if fail else 0


if __name__ == "__main__":
    try:
        ap = argparse.ArgumentParser(description=__doc__)
        ap.add_argument("--selftest", action="store_true", help="run derivation self-tests (no I/O)")
        args = ap.parse_args()
        raise SystemExit(selftest() if args.selftest else main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"scorers: fatal — {e}; continuing")
        raise SystemExit(0)
