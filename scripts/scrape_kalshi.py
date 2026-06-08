#!/usr/bin/env python3
"""Fetch tournament-winner markets from Kalshi public API → data/markets.json.

Anonymous endpoints only — no API key. Rate-limited to ≥1 req / 2 s.
Exits 0 on partial failure (logs errors, writes best-effort output).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
BASE = "https://api.elections.kalshi.com/trade-api/v2"
EVENT_TICKER = "KXMENWORLDCUP-26"
SERIES_TICKER = "KXMENWORLDCUP"
USER_AGENT = "wc26-tracker/1.0 (personal-project)"
MIN_INTERVAL = 2.0
TOP_SPARKLINE_TEAMS = 20
SPARKLINE_DAYS = 30

# Kalshi display names → teams.json keys
KALSHI_TO_TEAM: dict[str, str] = {
    "Turkey": "Turkiye",
    "South Korea": "Korea Republic",
    "Congo DR": "DR Congo",
    "Ivory Coast": "Cote d'Ivoire",
    "Cape Verde": "Cabo Verde",
}

_last_request = 0.0
_errors: list[str] = []


def log(msg: str) -> None:
    print(f"[kalshi] {msg}", file=sys.stderr, flush=True)


def err(msg: str) -> None:
    log(f"ERROR: {msg}")
    _errors.append(msg)


def kalshi_get(path: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
    global _last_request
    qs = urllib.parse.urlencode(params or {})
    url = f"{BASE}{path}" + (f"?{qs}" if qs else "")
    sleep_for = MIN_INTERVAL - (time.monotonic() - _last_request)
    if sleep_for > 0:
        time.sleep(sleep_for)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    log(f"GET {url}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
        _last_request = time.monotonic()
        return json.loads(body)
    except Exception as exc:
        _last_request = time.monotonic()
        raise RuntimeError(f"{url}: {exc}") from exc


def load_teams() -> set[str]:
    path = DATA_DIR / "teams.json"
    with path.open(encoding="utf-8") as f:
        teams = json.load(f)
    return set(teams.keys())


def map_team(kalshi_name: str, valid: set[str]) -> str | None:
    name = KALSHI_TO_TEAM.get(kalshi_name, kalshi_name)
    return name if name in valid else None


def parse_dollars(val: Any) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def implied_prob(market: dict[str, Any]) -> float:
    bid = parse_dollars(market.get("yes_bid_dollars"))
    ask = parse_dollars(market.get("yes_ask_dollars"))
    last = parse_dollars(market.get("last_price_dollars"))
    if bid is not None and ask is not None and bid > 0 and ask > 0:
        return (bid + ask) / 2.0
    if last is not None:
        return last
    if bid is not None:
        return bid
    if ask is not None:
        return ask
    return 0.0


def delta_24h_pp(market: dict[str, Any], prob: float) -> float:
    prev = parse_dollars(market.get("previous_price_dollars"))
    if prev is None:
        return 0.0
    return round((prob - prev) * 100, 1)


def parse_volume(market: dict[str, Any]) -> int:
    vfp = parse_dollars(market.get("volume_fp"))
    if vfp is not None:
        return int(vfp)
    vol = market.get("volume")
    if isinstance(vol, (int, float)):
        return int(vol)
    return 0


def parse_open_interest(market: dict[str, Any]) -> int:
    oi = parse_dollars(market.get("open_interest_fp"))
    if oi is not None:
        return int(oi)
    return 0


def fetch_event_markets() -> list[dict[str, Any]]:
    data = kalshi_get(f"/events/{EVENT_TICKER}", params={"with_nested_markets": "true"})
    event = data.get("event") or {}
    markets = event.get("markets") or []
    if not markets:
        raise RuntimeError(f"No markets nested in event {EVENT_TICKER}")
    return markets


def fetch_sparkline(ticker: str) -> list[float]:
    end_ts = int(time.time())
    start_ts = end_ts - SPARKLINE_DAYS * 86400
    path = f"/series/{SERIES_TICKER}/markets/{ticker}/candlesticks"
    data = kalshi_get(
        path,
        params={
            "period_interval": 1440,
            "start_ts": start_ts,
            "end_ts": end_ts,
        },
    )
    sticks = data.get("candlesticks") or []
    out: list[float] = []
    for c in sticks:
        price = c.get("price") or {}
        close = parse_dollars(price.get("close_dollars"))
        if close is None:
            close = parse_dollars(price.get("mean_dollars"))
        if close is not None:
            out.append(round(close, 4))
    return out


GAME_SERIES = "KXWCGAME"  # per-match 1X2: <teamA> / Tie / <teamB> markets per event
GOAL_LEADER_EVENT = "KXWCGOALLEADER-26"  # Golden Boot Winner (per-player markets)
AWARD_EVENTS = {  # Golden Awards (per-player markets under the KXWCAWARD series)
    "golden_ball": "KXWCAWARD-26GBALL",
    "golden_glove": "KXWCAWARD-26GGLOVE",
    "young_player": "KXWCAWARD-26BYP",
}


def _devigged_players(event_ticker: str) -> list[dict[str, Any]]:
    """A per-player Kalshi event → de-vigged [{player, prob_pct, volume, ...}]."""
    try:
        data = kalshi_get(f"/events/{event_ticker}", params={"with_nested_markets": "true"})
    except RuntimeError as exc:
        err(str(exc))
        return []
    markets = (data.get("event") or {}).get("markets") or []
    raw = []
    for m in markets:
        name = (m.get("yes_sub_title") or m.get("subtitle") or "").strip()
        p = implied_prob(m)
        if name and p > 0:
            raw.append((name, p, m))
    tot = sum(p for _, p, _ in raw)
    return [{
        "player": name,
        "prob_pct": round((p / tot * 100) if tot else 0.0, 1),
        "volume": parse_volume(m),
        "open_interest": parse_open_interest(m),
    } for name, p, m in sorted(raw, key=lambda x: -x[1])]


def fetch_goal_leader() -> list[dict[str, Any]]:
    """Kalshi 'Golden Boot Winner' market → blended into the Golden Boot model."""
    return _devigged_players(GOAL_LEADER_EVENT)


def fetch_awards() -> dict[str, list[dict[str, Any]]]:
    """Golden Ball / Golden Glove / Best Young Player markets → blended per award."""
    return {key: _devigged_players(ev) for key, ev in AWARD_EVENTS.items()}


def _canonical_matchups() -> dict[frozenset, tuple[str, str]]:
    """team-set → (team_a, team_b) orientation from group_matchups.json, so stored
    keys match the app's matchOutcomeKey orientation and team_a_prob aligns with
    the match's team_a (markets.getMatchOutcome looks up team_a__vs__team_b)."""
    try:
        with (DATA_DIR / "group_matchups.json").open(encoding="utf-8") as f:
            gm = json.load(f)
    except Exception:
        return {}
    out: dict[frozenset, tuple[str, str]] = {}
    for g in gm.values():
        for m in (g.get("matches") or []):
            a, b = m.get("team_a"), m.get("team_b")
            if a and b:
                out[frozenset((a, b))] = (a, b)
    return out


def fetch_match_outcomes(valid: set[str]) -> dict[str, Any]:
    """Per-match win/draw/loss from the live KXWCGAME series (each event has three
    markets: team-A win / Tie / team-B win). Only matches with live prices are
    included — empty until Kalshi prices a game (e.g. close to kickoff / in-play),
    at which point it auto-populates. Probabilities are de-vigged (normalised to 1)."""
    try:
        data = kalshi_get("/events", params={"series_ticker": GAME_SERIES, "limit": 200, "status": "open"})
    except RuntimeError as exc:
        err(str(exc))
        return {}
    canon = _canonical_matchups()
    outcomes: dict[str, Any] = {}
    for ev in (data.get("events") or []):
        ticker = ev.get("event_ticker") or ""
        try:
            nested = kalshi_get(f"/events/{ticker}", params={"with_nested_markets": "true"})
        except RuntimeError as exc:
            err(str(exc))
            continue
        markets = (nested.get("event") or {}).get("markets") or []
        team_probs: dict[str, float] = {}
        draw_prob: float | None = None
        for m in markets:
            sub = (m.get("yes_sub_title") or m.get("subtitle") or "").strip()
            p = implied_prob(m)
            if p <= 0:
                continue
            if sub.lower() in ("tie", "draw"):
                draw_prob = p
            else:
                t = map_team(sub, valid)
                if t:
                    team_probs[t] = p
        if len(team_probs) != 2 or draw_prob is None:
            continue  # illiquid or unmapped — skip; auto-fills once priced
        ta, tb = list(team_probs.keys())
        a, b = canon.get(frozenset((ta, tb)), (ta, tb))  # canonical orientation
        pa, pb = team_probs[a], team_probs[b]
        tot = pa + draw_prob + pb
        if tot <= 0:
            continue
        outcomes[f"{a}__vs__{b}"] = {
            "team_a": a,
            "team_b": b,
            "team_a_prob": round(pa / tot, 4),
            "draw_prob": round(draw_prob / tot, 4),
            "team_b_prob": round(pb / tot, 4),
            "event_ticker": ticker,
            "source": "kalshi-KXWCGAME",
        }
    log(f"match_outcomes: {len(outcomes)} priced match market(s)")
    return outcomes


def build_markets(*, skip_sparklines: bool = False) -> dict[str, Any]:
    valid_teams = load_teams()
    raw_markets = fetch_event_markets()

    rows: list[dict[str, Any]] = []
    for m in raw_markets:
        kalshi_team = m.get("yes_sub_title") or m.get("no_sub_title") or ""
        team = map_team(kalshi_team, valid_teams)
        if not team:
            continue
        prob = implied_prob(m)
        prob_pct = round(prob * 100, 1)
        rows.append(
            {
                "team": team,
                "ticker": m.get("ticker"),
                "prob_pct": prob_pct,
                "delta_24h_pp": delta_24h_pp(m, prob),
                "volume": parse_volume(m),
                "open_interest": parse_open_interest(m),
                "sparkline": [],
            }
        )

    rows.sort(key=lambda r: r["prob_pct"], reverse=True)

    if not skip_sparklines:
        for row in rows[:TOP_SPARKLINE_TEAMS]:
            ticker = row.get("ticker")
            if not ticker:
                continue
            try:
                row["sparkline"] = fetch_sparkline(ticker)
            except RuntimeError as exc:
                err(str(exc))

    biggest = sorted(rows, key=lambda r: abs(r["delta_24h_pp"]), reverse=True)[:5]

    match_outcomes: dict[str, Any] = {}
    try:
        match_outcomes = fetch_match_outcomes(valid_teams)
    except RuntimeError as exc:
        err(str(exc))

    goal_leader: list[dict[str, Any]] = []
    awards: dict[str, list[dict[str, Any]]] = {}
    try:
        goal_leader = fetch_goal_leader()
    except RuntimeError as exc:
        err(str(exc))
    try:
        awards = fetch_awards()
    except RuntimeError as exc:
        err(str(exc))

    return {
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "kalshi",
        "tournament_winner": rows,
        "match_outcomes": match_outcomes,
        "goal_leader": goal_leader,
        "awards": awards,
        "biggest_movers": biggest,
    }


def save_markets(payload: dict[str, Any]) -> None:
    path = DATA_DIR / "markets.json"
    tmp = path.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp.replace(path)
    log(f"wrote markets.json ({len(payload.get('tournament_winner', []))} teams)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--skip-sparklines",
        action="store_true",
        help="Skip candlestick fetches (faster local dev)",
    )
    args = ap.parse_args()

    try:
        payload = build_markets(skip_sparklines=args.skip_sparklines)
        save_markets(payload)
    except RuntimeError as exc:
        err(str(exc))
        # Write minimal stub so validate still passes if we had prior data.
        stub_path = DATA_DIR / "markets.json"
        if stub_path.exists():
            log("Keeping existing markets.json after fatal error")
        else:
            save_markets(
                {
                    "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "source": "kalshi",
                    "tournament_winner": [],
                    "match_outcomes": {},
                    "biggest_movers": [],
                }
            )

    if _errors:
        log(f"Completed with {len(_errors)} error(s)")
    else:
        log("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
