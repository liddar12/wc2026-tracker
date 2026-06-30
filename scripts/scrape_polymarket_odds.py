#!/usr/bin/env python3
"""Per-match W/D/L odds from the Polymarket Gamma API → data/polymarket_odds.json.

Why this exists: the matchup-detail market bar + the Parlay of the Day want a
real per-match market price. Polymarket's Gamma API is FREE, KEYLESS and has no
documented rate limit, so this is a zero-cost source that never needs a secret.

We pull the WC2026 event group (Gamma tag), and for each 3-way moneyline event
(teamA / "Draw" / teamB) read the YES price of each leg, de-vig (divide by the
sum so the triple sums to 1), map the two non-draw names to canonical
teams.json keys, orient to the app's canonical team_a (reusing the exact
canonical_matchups() logic from scrape_apifootball_odds.py), and emit a record
in the same match_outcomes shape as Kalshi / API-Football so the app reuses one
read path (parlay precedence + mergedMarkets()).

SAFE BY DEFAULT:
  • Keyless/public — always attempts the fetch (no secret gate).
  • Always exits 0; on any error the existing file is left untouched.
  • Only emits a fixture whose team-set appears in canonical_matchups() (a real
    scheduled WC fixture). Unmapped/illiquid markets are dropped, never emitted.

Output (consumed by app/components/parlay.js via data.polymarketOdds and by
app/markets.js#mergedMarkets, same match_outcomes shape as Kalshi):
  { "source": "polymarket", "updated_at": ISO,
    "match_outcomes": { "<A>__vs__<B>": {
        "team_a": A, "team_b": B,
        "team_a_prob": .., "draw_prob": .., "team_b_prob": ..,   # de-vigged, sum→1
        "source": "polymarket"
    }, ... } }

Self-test (no network): python3 scripts/scrape_polymarket_odds.py --selftest
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "polymarket_odds.json"

GAMMA = "https://gamma-api.polymarket.com"
WC2026_TAG = 102232            # Polymarket WC2026 event group tag
UA = {"User-Agent": "wc26-tracker/1.0 (polymarket-odds)", "Accept": "application/json"}
MIN_INTERVAL = 0.2

# Polymarket display names → teams.json / canonical keys (mirror of the RENAMES
# in scrape_apifootball_odds.py / live-scores.js — keep in sync).
RENAMES = {
    "United States": "USA", "USA": "USA", "South Korea": "Korea Republic",
    "Korea Republic": "Korea Republic", "Türkiye": "Turkiye", "Turkey": "Turkiye",
    "Czech Republic": "Czechia", "Cape Verde": "Cabo Verde",
    "Ivory Coast": "Cote d'Ivoire", "IR Iran": "Iran", "Iran": "Iran",
    "Congo DR": "DR Congo", "DR Congo": "DR Congo", "Congo": "DR Congo",
    "Bosnia & Herzegovina": "Bosnia and Herzegovina",
    "Bosnia-Herzegovina": "Bosnia and Herzegovina", "Curaçao": "Curacao",
    "Curacao": "Curacao",
}

_last = 0.0


def log(m: str) -> None:
    print(f"[polymarket-odds] {m}", file=sys.stderr, flush=True)


def norm(n: str | None) -> str:
    n = (n or "").strip()
    return RENAMES.get(n, RENAMES.get(n.replace("-", " "), n))


def get(url: str) -> Any:
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                _last = time.monotonic()
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                _last = time.monotonic()
                log(f"GET fail {url[:80]}…: {e}")
                return None
            time.sleep(1.0 + attempt)
    return None


def as_list(v: Any) -> list:
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:  # noqa: BLE001
            return []
    return []


# ----- pure transforms (unit-tested via --selftest) -----

def devig(prices: list[float]) -> list[float] | None:
    """Normalise a YES-price triple so it sums to 1 (removes the vig). None if
    the sum is non-positive (an illiquid / unpriced leg)."""
    tot = sum(prices)
    if tot <= 0:
        return None
    return [p / tot for p in prices]


def valid_teams() -> set[str]:
    try:
        t = json.loads((DATA / "teams.json").read_text())
        return set(t.keys()) if isinstance(t, dict) else set()
    except Exception:  # noqa: BLE001
        return set()


def parse_event(event: dict[str, Any], teams: set[str] | None = None
                ) -> tuple[str, dict[str, Any]] | None:
    """One Gamma event (3 markets: teamA / Draw / teamB) → (key, match_outcome)
    oriented home__vs__away (pre-canonical). Returns None on any malformed /
    illiquid / unmappable event. `teams` (when given) is the valid-team set; an
    event whose two non-draw names don't both map into it is dropped."""
    mkts = event.get("markets") or []
    if len(mkts) != 3:
        return None
    home = away = None
    draw_price = None
    home_price = away_price = None
    for m in mkts:
        git = (m.get("groupItemTitle") or "").strip()
        op = as_list(m.get("outcomePrices"))
        if not git or not op:
            return None
        try:
            yes = float(op[0])
        except (TypeError, ValueError):
            return None
        if git.lower() == "draw":
            draw_price = yes
        elif home is None:
            home, home_price = git, yes
        elif away is None:
            away, away_price = git, yes
        else:
            return None  # >2 non-draw legs — not a clean 3-way
    if home is None or away is None or draw_price is None:
        return None
    a_name, b_name = norm(home), norm(away)
    if teams is not None and (a_name not in teams or b_name not in teams):
        return None  # unmapped / new spelling — drop, never emit non-canonical
    deviged = devig([home_price, draw_price, away_price])
    if deviged is None:
        return None
    pa, pd, pb = deviged
    out = {
        "team_a": a_name, "team_b": b_name,
        "team_a_prob": round(pa, 4),
        "draw_prob": round(pd, 4),
        "team_b_prob": round(pb, 4),
        "source": "polymarket",
    }
    return f"{a_name}__vs__{b_name}", out


# Bracket-slot placeholders — mirror scrape_apifootball_odds.py exactly.
_KNOCKOUT_STAGES = {"round_of_32", "round_of_16", "quarterfinals", "semifinals", "third_place", "final"}
_PLACEHOLDER_RE = re.compile(r"^\d[A-L]$|^[A-L]\d|^3[A-L/_]|^3 |^W\d|^L\d|^1[A-L]|^2[A-L]|^RU", re.I)


def _is_placeholder(name: str | None) -> bool:
    return not name or bool(_PLACEHOLDER_RE.match(str(name).strip()))


def canonical_matchups() -> dict[frozenset, tuple[str, str]]:
    """team-set → (team_a, team_b) orientation matching the app (group_matchups +
    resolved knockout rows from schedule_full). Reused verbatim from
    scrape_apifootball_odds.py so polymarket_odds orients identically."""
    out: dict[frozenset, tuple[str, str]] = {}
    try:
        gm = json.loads((DATA / "group_matchups.json").read_text())
    except Exception:  # noqa: BLE001
        gm = {}
    for g in (gm.values() if isinstance(gm, dict) else []):
        for m in (g.get("matches") or []):
            a, b = m.get("team_a"), m.get("team_b")
            if a and b:
                out[frozenset((a, b))] = (a, b)
    try:
        sched = json.loads((DATA / "schedule_full.json").read_text())
    except Exception:  # noqa: BLE001
        sched = []
    for m in (sched if isinstance(sched, list) else []):
        if m.get("stage") not in _KNOCKOUT_STAGES:
            continue
        a, b = m.get("team_a"), m.get("team_b")
        if a and b and not _is_placeholder(a) and not _is_placeholder(b):
            out.setdefault(frozenset((a, b)), (a, b))
    return out


def orient(key_rec: tuple[str, dict[str, Any]],
           canon: dict[frozenset, tuple[str, str]]) -> tuple[str, dict[str, Any]] | None:
    """Re-orient a parse_event record to canonical team_a, swapping probs if the
    canonical orientation flips home/away. Returns None when the fixture is NOT a
    real scheduled WC matchup (its team-set isn't in canon)."""
    _, rec = key_rec
    home, away = rec["team_a"], rec["team_b"]
    fs = frozenset((home, away))
    if fs not in canon:
        return None
    a, b = canon[fs]
    if a == home:
        pa, pb = rec["team_a_prob"], rec["team_b_prob"]
    else:
        pa, pb = rec["team_b_prob"], rec["team_a_prob"]
    out = {
        "team_a": a, "team_b": b,
        "team_a_prob": pa,
        "draw_prob": rec["draw_prob"],
        "team_b_prob": pb,
        "source": "polymarket",
    }
    return f"{a}__vs__{b}", out


def build_from_events(events: list[dict[str, Any]], teams: set[str],
                      canon: dict[frozenset, tuple[str, str]]) -> dict[str, Any]:
    """All Gamma events → match_outcomes oriented + validated against schedule."""
    match_outcomes: dict[str, Any] = {}
    for ev in events or []:
        parsed = parse_event(ev, teams)
        if not parsed:
            continue
        oriented = orient(parsed, canon)
        if not oriented:
            log(f"dropping {parsed[0]} — not in schedule (or bracket unresolved)")
            continue
        match_outcomes[oriented[0]] = oriented[1]
    return match_outcomes


# ----- orchestration -----

def build() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    events = get(f"{GAMMA}/events?tag_id={WC2026_TAG}&closed=false&limit=500") or []
    if not isinstance(events, list):
        events = []
    teams = valid_teams()
    canon = canonical_matchups()
    match_outcomes = build_from_events(events, teams, canon)
    return {
        "source": "polymarket",
        "updated_at": now.isoformat(timespec="seconds"),
        "match_outcomes": match_outcomes,
    }


def write_out(payload: dict[str, Any]) -> None:
    # New file, no legacy churn → ensure_ascii=False (matches markets.json /
    # consensus_odds.json encoding). Atomic tmp + replace.
    tmp = OUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(OUT)


def selftest() -> int:
    fail = 0

    def check(name: str, cond: bool) -> None:
        nonlocal fail
        print(f"  {'ok  ' if cond else 'FAIL'}: {name}")
        if not cond:
            fail += 1

    # de-vig of [0.6, 0.3, 0.2] (sum 1.1) → [0.545, 0.273, 0.182] summing to 1.
    dv = devig([0.6, 0.3, 0.2])
    check("de-vig sums to 1", dv is not None and abs(sum(dv) - 1.0) < 1e-9)
    check("de-vig home ~0.545", dv is not None and abs(dv[0] - 0.6 / 1.1) < 1e-6)
    check("de-vig draw ~0.273", dv is not None and abs(dv[1] - 0.3 / 1.1) < 1e-6)
    check("de-vig away ~0.182", dv is not None and abs(dv[2] - 0.2 / 1.1) < 1e-6)
    check("de-vig zero-sum → None", devig([0.0, 0.0, 0.0]) is None)

    # RENAMES
    check("RENAMES United States→USA", norm("United States") == "USA")
    check("RENAMES Turkey→Turkiye", norm("Turkey") == "Turkiye")
    check("RENAMES Curaçao→Curacao", norm("Curaçao") == "Curacao")

    # parse_event: Brazil / Draw / Japan with YES prices .60/.25/.15
    ev = {"markets": [
        {"groupItemTitle": "Brazil", "outcomePrices": ["0.60"]},
        {"groupItemTitle": "Draw", "outcomePrices": ["0.25"]},
        {"groupItemTitle": "Japan", "outcomePrices": ["0.15"]},
    ]}
    parsed = parse_event(ev, {"Brazil", "Japan"})
    check("parse_event keyed Brazil__vs__Japan", parsed is not None and parsed[0] == "Brazil__vs__Japan")
    # de-vig of [.60,.25,.15] sums to 1.0 already → team_a_prob ≈ 0.60
    check("parse_event team_a_prob ≈ 0.60", parsed is not None and abs(parsed[1]["team_a_prob"] - 0.60) < 1e-3)
    check("parse_event draw ≈ 0.25", parsed is not None and abs(parsed[1]["draw_prob"] - 0.25) < 1e-3)
    check("parse_event source polymarket", parsed is not None and parsed[1]["source"] == "polymarket")

    # canonical flip: canon maps {Brazil,Japan}→(Japan,Brazil) → emitted team_a=Japan, probs swap
    oriented = orient(parsed, {frozenset(("Brazil", "Japan")): ("Japan", "Brazil")})
    check("canonical flip → team_a=Japan", oriented is not None and oriented[1]["team_a"] == "Japan")
    check("canonical flip key Japan__vs__Brazil", oriented is not None and oriented[0] == "Japan__vs__Brazil")
    check("canonical flip swaps probs (team_a_prob now Japan's .15)",
          oriented is not None and abs(oriented[1]["team_a_prob"] - 0.15) < 1e-3
          and abs(oriented[1]["team_b_prob"] - 0.60) < 1e-3)
    check("canonical flip keeps draw", oriented is not None and abs(oriented[1]["draw_prob"] - 0.25) < 1e-3)

    # no-flip canonical orientation keeps home/away
    oriented2 = orient(parsed, {frozenset(("Brazil", "Japan")): ("Brazil", "Japan")})
    check("no-flip keeps team_a=Brazil", oriented2 is not None and oriented2[1]["team_a"] == "Brazil"
          and abs(oriented2[1]["team_a_prob"] - 0.60) < 1e-3)

    # unmapped team → event dropped (parse_event returns None, no crash)
    ev_unmapped = {"markets": [
        {"groupItemTitle": "Atlantis", "outcomePrices": ["0.5"]},
        {"groupItemTitle": "Draw", "outcomePrices": ["0.3"]},
        {"groupItemTitle": "Japan", "outcomePrices": ["0.2"]},
    ]}
    check("unmapped team → parse_event None", parse_event(ev_unmapped, {"Brazil", "Japan"}) is None)

    # fixture not in schedule → orient returns None (dropped)
    check("fixture absent from canon → orient None", orient(parsed, {}) is None)

    # malformed: 2 markets, missing draw, bad price
    check("non-3-market event → None", parse_event({"markets": [ev["markets"][0]]}, {"Brazil"}) is None)
    check("missing draw → None", parse_event({"markets": [
        {"groupItemTitle": "Brazil", "outcomePrices": ["0.6"]},
        {"groupItemTitle": "Argentina", "outcomePrices": ["0.2"]},
        {"groupItemTitle": "Japan", "outcomePrices": ["0.2"]},
    ]}, {"Brazil", "Argentina", "Japan"}) is None)
    check("bad price string → None", parse_event({"markets": [
        {"groupItemTitle": "Brazil", "outcomePrices": ["x"]},
        {"groupItemTitle": "Draw", "outcomePrices": ["0.25"]},
        {"groupItemTitle": "Japan", "outcomePrices": ["0.15"]},
    ]}, {"Brazil", "Japan"}) is None)

    # empty input → no records, no crash
    check("empty events → {}", build_from_events([], {"Brazil", "Japan"},
          {frozenset(("Brazil", "Japan")): ("Brazil", "Japan")}) == {})

    # full pipeline on one in-schedule event
    built = build_from_events([ev], {"Brazil", "Japan"},
                              {frozenset(("Brazil", "Japan")): ("Brazil", "Japan")})
    check("build_from_events emits Brazil__vs__Japan", "Brazil__vs__Japan" in built)

    # as_list helper (JSON-string arrays from Gamma)
    check("as_list parses stringified array", as_list('["0.6"]') == ["0.6"])

    print(f"selftest: {'PASS' if not fail else f'{fail} FAILURE(S)'}")
    return 1 if fail else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--selftest", action="store_true", help="run transform self-tests (no network)")
    args = ap.parse_args()
    if args.selftest:
        return selftest()

    try:
        payload = build()
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}; keeping existing data")
        return 0
    if not payload["match_outcomes"]:
        # Pre-tournament / nothing priced → still write the empty-but-valid stub
        # so the file exists and validate_data sees source=="polymarket".
        if not OUT.exists():
            write_out(payload)
            log("no priced fixtures — wrote empty polymarket_odds.json stub")
        else:
            log("no priced fixtures in window — keeping existing polymarket_odds.json")
        return 0
    write_out(payload)
    log(f"wrote polymarket_odds.json ({len(payload['match_outcomes'])} match(es))")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}")
        raise SystemExit(0)
