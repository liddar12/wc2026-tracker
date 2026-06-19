#!/usr/bin/env python3
"""Multi-book CONSENSUS odds (API-Football) → data/consensus_odds.json.

Why this exists: the Parlay of the Day blends our model with a single market
source (near-real-time ESPN/DraftKings, then the hourly Kalshi feed). A
multi-bookmaker CONSENSUS — averaging the de-vigged 1X2 + Over/Under 2.5 across
every book API-Football carries (incl. sharps like Pinnacle) — is a sharper
price than any single book, so it measurably improves the parlay's odds.
See docs/DATA_SOURCES_RESEARCH.md / docs/APIFOOTBALL_INTEGRATION.md.

KEY-GATED + SAFE BY DEFAULT:
  • Reads the key from $APIFOOTBALL_KEY. With NO key it logs and exits 0 WITHOUT
    touching consensus_odds.json — so the app keeps its current behavior until
    the secret is added (the stub ships with empty match_outcomes).
  • Always exits 0; on any error the existing file is left untouched.
  • Request budget (free tier = 100/day): 1 fixtures call per UTC date covered
    (today + tomorrow) + 1 odds call per fixture found. A WC match-day is a
    handful of fixtures, so a pre-kickoff run costs well under 10 requests.

Output (consumed by app/components/parlay.js via data.consensusOdds, same
match_outcomes shape as Kalshi so the parlay reuses one code path):
  { "source": "api-football", "updated_at": ISO, "season": 2026, "league": 1,
    "match_outcomes": { "<A>__vs__<B>": {
        "team_a": A, "team_b": B,
        "team_a_prob": .., "draw_prob": .., "team_b_prob": ..,   # de-vigged, sum→1
        "over25": ..,            # consensus P(total goals > 2.5), or omitted
        "books": N               # bookmakers averaged
    }, ... } }

Self-test (no key/network needed): python3 scripts/scrape_apifootball_odds.py --selftest
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
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "consensus_odds.json"

BASE = "https://v3.football.api-sports.io"
LEAGUE_ID = 1          # FIFA World Cup
SEASON = 2026
MIN_INTERVAL = 6.5     # free tier: ~10 req/min — stay comfortably under
BET_MATCH_WINNER = 1   # API-Football bet id / "Match Winner"
BET_OVER_UNDER = 5     # API-Football bet id / "Goals Over/Under"

# API-Football display names → teams.json / canonical keys (mirror of the
# RENAMES used in scrape_injuries.py / live-scores.js — keep in sync).
RENAMES = {
    "United States": "USA", "USA": "USA", "South Korea": "Korea Republic",
    "Korea Republic": "Korea Republic", "Türkiye": "Turkiye", "Turkey": "Turkiye",
    "Czech Republic": "Czechia", "Cape Verde": "Cabo Verde",
    "Ivory Coast": "Cote d'Ivoire", "IR Iran": "Iran", "Iran": "Iran",
    "Congo DR": "DR Congo", "DR Congo": "DR Congo",
    "Bosnia & Herzegovina": "Bosnia and Herzegovina",
    "Bosnia-Herzegovina": "Bosnia and Herzegovina", "Curaçao": "Curacao",
}
_last = 0.0


def log(m: str) -> None:
    print(f"[apifootball-odds] {m}", file=sys.stderr, flush=True)


def norm(n: str | None) -> str:
    n = (n or "").strip()
    return RENAMES.get(n, RENAMES.get(n.replace("-", " "), n))


def get(path: str, params: dict[str, Any], key: str) -> dict[str, Any] | None:
    global _last
    url = f"{BASE}{path}?" + urllib.parse.urlencode(params)
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={
        "x-apisports-key": key,
        "Accept": "application/json",
        "User-Agent": "wc26-tracker/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            _last = time.monotonic()
            return json.load(r)
    except Exception as e:  # noqa: BLE001
        _last = time.monotonic()
        log(f"GET fail {path}: {e}")
        return None


# ----- pure transforms (unit-tested via --selftest) -----

def devig_match_winner(bookmakers: list[dict[str, Any]]) -> dict[str, float] | None:
    """Average the per-book de-vigged 1X2 across all bookmakers.

    For each book: implied = 1/odd for Home/Draw/Away, normalised to sum 1
    (removes that book's margin). The consensus is the mean of those normalised
    triples across books. Returns {home, draw, away} summing to 1, or None."""
    acc = {"home": 0.0, "draw": 0.0, "away": 0.0}
    books = 0
    for bm in bookmakers or []:
        for bet in bm.get("bets") or []:
            if bet.get("id") != BET_MATCH_WINNER and (bet.get("name") or "").strip() != "Match Winner":
                continue
            o = {}
            for v in bet.get("values") or []:
                label = str(v.get("value", "")).strip().lower()
                try:
                    odd = float(v.get("odd"))
                except (TypeError, ValueError):
                    continue
                if odd <= 1.0:
                    continue
                if label in ("home", "1"):
                    o["home"] = 1.0 / odd
                elif label in ("draw", "x"):
                    o["draw"] = 1.0 / odd
                elif label in ("away", "2"):
                    o["away"] = 1.0 / odd
            if len(o) == 3:
                tot = o["home"] + o["draw"] + o["away"]
                if tot > 0:
                    for k in acc:
                        acc[k] += o[k] / tot
                    books += 1
            break  # one Match Winner bet per book
    if not books:
        return None
    return {k: acc[k] / books for k in acc}


def devig_over_under(bookmakers: list[dict[str, Any]], line: float = 2.5) -> float | None:
    """Consensus P(total goals > line) across books, de-vigged per book."""
    over_t = f"over {line:g}"
    under_t = f"under {line:g}"
    acc = 0.0
    books = 0
    for bm in bookmakers or []:
        for bet in bm.get("bets") or []:
            if bet.get("id") != BET_OVER_UNDER and (bet.get("name") or "").strip() != "Goals Over/Under":
                continue
            over = under = None
            for v in bet.get("values") or []:
                label = str(v.get("value", "")).strip().lower()
                try:
                    odd = float(v.get("odd"))
                except (TypeError, ValueError):
                    continue
                if odd <= 1.0:
                    continue
                if label == over_t:
                    over = 1.0 / odd
                elif label == under_t:
                    under = 1.0 / odd
            if over is not None and under is not None and (over + under) > 0:
                acc += over / (over + under)
                books += 1
            break
    if not books:
        return None
    return acc / books


def parse_fixtures(payload: dict[str, Any] | None) -> dict[int, tuple[str, str]]:
    """/fixtures response → {fixture_id: (home_norm, away_norm)}."""
    out: dict[int, tuple[str, str]] = {}
    for row in (payload or {}).get("response", []) or []:
        fid = (row.get("fixture") or {}).get("id")
        teams = row.get("teams") or {}
        home = norm((teams.get("home") or {}).get("name"))
        away = norm((teams.get("away") or {}).get("name"))
        if isinstance(fid, int) and home and away:
            out[fid] = (home, away)
    return out


def odds_response_bookmakers(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    """/odds?fixture=ID response → the bookmakers list for that fixture."""
    resp = (payload or {}).get("response") or []
    if not resp:
        return []
    return resp[0].get("bookmakers") or []


def canonical_matchups() -> dict[frozenset, tuple[str, str]]:
    """team-set → (team_a, team_b) orientation from group_matchups.json so our
    keys/orientation match the app (parlay looks up team_a__vs__team_b)."""
    try:
        gm = json.loads((DATA / "group_matchups.json").read_text())
    except Exception:  # noqa: BLE001
        return {}
    out: dict[frozenset, tuple[str, str]] = {}
    for g in gm.values():
        for m in (g.get("matches") or []):
            a, b = m.get("team_a"), m.get("team_b")
            if a and b:
                out[frozenset((a, b))] = (a, b)
    return out


def build_outcome(home: str, away: str, bookmakers: list[dict[str, Any]],
                  canon: dict[frozenset, tuple[str, str]]) -> tuple[str, dict[str, Any]] | None:
    """One fixture's bookmakers → (key, match_outcome) oriented to canonical."""
    wdl = devig_match_winner(bookmakers)
    if not wdl:
        return None
    a, b = canon.get(frozenset((home, away)), (home, away))
    # wdl is keyed home/away; map to canonical team_a/team_b.
    if a == home:
        pa, pb = wdl["home"], wdl["away"]
    else:
        pa, pb = wdl["away"], wdl["home"]
    book_count = sum(
        1 for bm in bookmakers
        for bet in (bm.get("bets") or [])
        if bet.get("id") == BET_MATCH_WINNER or (bet.get("name") or "").strip() == "Match Winner"
    )
    out: dict[str, Any] = {
        "team_a": a, "team_b": b,
        "team_a_prob": round(pa, 4),
        "draw_prob": round(wdl["draw"], 4),
        "team_b_prob": round(pb, 4),
        "books": book_count,
        "source": "api-football",
    }
    over = devig_over_under(bookmakers, 2.5)
    if over is not None:
        out["over25"] = round(over, 4)
    return f"{a}__vs__{b}", out


# ----- orchestration -----

def build(key: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    dates = sorted({(now + timedelta(days=d)).strftime("%Y-%m-%d") for d in (0, 1)})
    fixtures: dict[int, tuple[str, str]] = {}
    for d in dates:
        payload = get("/fixtures", {"league": LEAGUE_ID, "season": SEASON, "date": d, "timezone": "UTC"}, key)
        fixtures.update(parse_fixtures(payload))
    canon = canonical_matchups()
    match_outcomes: dict[str, Any] = {}
    for fid, (home, away) in fixtures.items():
        payload = get("/odds", {"fixture": fid}, key)
        bms = odds_response_bookmakers(payload)
        built = build_outcome(home, away, bms, canon)
        if built:
            match_outcomes[built[0]] = built[1]
    return {
        "source": "api-football",
        "updated_at": now.isoformat(timespec="seconds"),
        "season": SEASON,
        "league": LEAGUE_ID,
        "match_outcomes": match_outcomes,
    }


def write_out(payload: dict[str, Any]) -> None:
    tmp = OUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(OUT)


def selftest() -> int:
    """Validate the de-vig + parse transforms against documented sample shapes."""
    fail = 0

    def check(name: str, cond: bool) -> None:
        nonlocal fail
        print(f"  {'ok  ' if cond else 'FAIL'}: {name}")
        if not cond:
            fail += 1

    # Two books; a fair (no-margin) book and a margined book. De-vigged consensus
    # should recover ~the fair probabilities.
    sample_books = [
        {"name": "Fair", "bets": [
            {"id": 1, "name": "Match Winner", "values": [
                {"value": "Home", "odd": "2.0"}, {"value": "Draw", "odd": "4.0"}, {"value": "Away", "odd": "4.0"},
            ]},
            {"id": 5, "name": "Goals Over/Under", "values": [
                {"value": "Over 2.5", "odd": "2.0"}, {"value": "Under 2.5", "odd": "2.0"},
            ]},
        ]},
        {"name": "Margined", "bets": [
            {"id": 1, "name": "Match Winner", "values": [
                {"value": "Home", "odd": "1.9"}, {"value": "Draw", "odd": "3.8"}, {"value": "Away", "odd": "3.8"},
            ]},
        ]},
    ]
    wdl = devig_match_winner(sample_books)
    check("match-winner de-vig sums to 1", wdl is not None and abs(sum(wdl.values()) - 1.0) < 1e-9)
    # Fair book: 1/2, 1/4, 1/4 → home 0.5. Margined book de-vigs to the same ratio.
    check("home prob ~0.5", abs(wdl["home"] - 0.5) < 1e-6)
    check("draw==away ~0.25", abs(wdl["draw"] - 0.25) < 1e-6 and abs(wdl["away"] - 0.25) < 1e-6)
    over = devig_over_under(sample_books, 2.5)
    check("over2.5 consensus ~0.5", over is not None and abs(over - 0.5) < 1e-6)

    fx = parse_fixtures({"response": [
        {"fixture": {"id": 99}, "teams": {"home": {"name": "United States"}, "away": {"name": "Turkey"}}},
        {"fixture": {"id": 100}, "teams": {"home": {"name": "Brazil"}, "away": {"name": "Curaçao"}}},
    ]})
    check("fixtures parsed + renamed", fx.get(99) == ("USA", "Turkiye") and fx.get(100) == ("Brazil", "Curacao"))

    bms = odds_response_bookmakers({"response": [{"bookmakers": sample_books}]})
    built = build_outcome("USA", "Turkiye", bms, {})  # no canon → keep home/away orientation
    key, mo = built
    check("outcome key oriented home__vs__away", key == "USA__vs__Turkiye")
    check("team_a_prob == home consensus", abs(mo["team_a_prob"] - wdl["home"]) < 1e-6)
    check("over25 carried through", "over25" in mo and abs(mo["over25"] - 0.5) < 1e-6)
    check("books counted", mo["books"] == 2)

    # canonical re-orientation flips probs to match group_matchups orientation.
    built2 = build_outcome("USA", "Turkiye", bms, {frozenset(("USA", "Turkiye")): ("Turkiye", "USA")})
    _, mo2 = built2
    check("canonical flip swaps team_a/team_b prob",
          abs(mo2["team_a_prob"] - wdl["away"]) < 1e-6 and mo2["team_a"] == "Turkiye")

    # empty / malformed input → graceful None / no crash
    check("no books → None", devig_match_winner([]) is None)
    check("malformed odds ignored", devig_match_winner(
        [{"bets": [{"id": 1, "values": [{"value": "Home", "odd": "x"}]}]}]) is None)

    print(f"selftest: {'PASS' if not fail else f'{fail} FAILURE(S)'}")
    return 1 if fail else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--selftest", action="store_true", help="run transform self-tests (no key/network)")
    args = ap.parse_args()
    if args.selftest:
        return selftest()

    key = os.environ.get("APIFOOTBALL_KEY", "").strip()
    if not key:
        log("no APIFOOTBALL_KEY set — skipping (leaving consensus_odds.json untouched)")
        return 0
    try:
        payload = build(key)
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}; keeping existing data")
        return 0
    if not payload["match_outcomes"]:
        log("no priced fixtures in window — keeping existing consensus_odds.json")
        return 0
    write_out(payload)
    log(f"wrote consensus_odds.json ({len(payload['match_outcomes'])} match(es))")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}")
        raise SystemExit(0)
