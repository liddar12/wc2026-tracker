#!/usr/bin/env python3
"""Backtest the MARKET leg using Polymarket historical odds on resolved tournaments.

The current hybrid blends ⅓ z(J5L) + ⅓ z(DT) + ⅓ z(market strength), where the
market third is the tournament-winner implied probability. Kalshi has no price
history, so that leg has never been validated (data/backtest.json says as much —
its "market"/"hybrid" rows are admitted estimates).

Polymarket DOES expose history + resolution for past tournaments, so this script
answers, with real numbers: how skillful is the tournament-winner market as a
forecaster? For each resolved tournament we take the de-vigged implied
probabilities as of kickoff-eve and score them against who actually won.

Public Gamma + CLOB endpoints, no auth. Read-only; writes data/polymarket-backtest.json.
"""
from __future__ import annotations

import json
import math
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
UA = {"User-Agent": "wc26-tracker/1.0 (backtest)", "Accept": "application/json"}
MIN_INTERVAL = 0.25
EPS = 1e-6  # logloss clip

# Resolved tournaments to score. kickoff = first match (used to pick pre-tournament odds).
TOURNAMENTS = [
    {"slug": "euro-2024-winner", "name": "Euro 2024", "kickoff": "2024-06-14"},
    {"slug": "copa-america-winner", "name": "Copa América 2024", "kickoff": "2024-06-20"},
    {"slug": "which-country-will-win-the-2022-world-cup", "name": "World Cup 2022", "kickoff": "2022-11-20"},
]

_last = 0.0


def log(msg: str) -> None:
    print(f"[pm-backtest] {msg}", file=sys.stderr, flush=True)


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
                raise
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


def pre_tournament_price(token: str, kickoff_ts: int) -> float | None:
    """Implied prob from the last history point at/before kickoff (fallback: first point)."""
    try:
        h = get(f"{CLOB}/prices-history?market={token}&interval=max&fidelity=1440")
    except Exception as e:  # noqa: BLE001
        log(f"  history error {token[:12]}…: {e}")
        return None
    hist = (h or {}).get("history") or []
    if not hist:
        return None
    pick = None
    for pt in hist:
        if pt.get("t", 0) <= kickoff_ts:
            pick = pt
        else:
            break
    pick = pick or hist[0]
    p = pick.get("p")
    return float(p) if p is not None else None


def score_tournament(t: dict) -> dict | None:
    log(f"{t['name']} ({t['slug']})")
    kickoff_ts = int(datetime.fromisoformat(t["kickoff"]).replace(tzinfo=timezone.utc).timestamp())
    ev = get(f"{GAMMA}/events?slug={t['slug']}")
    if not ev:
        log("  event not found — skipping")
        return None
    e = ev[0] if isinstance(ev, list) else ev
    teams = []  # {team, raw_price, won}
    winner = None
    for m in e.get("markets", []):
        team = m.get("groupItemTitle") or m.get("question")
        toks = as_list(m.get("clobTokenIds"))
        op = as_list(m.get("outcomePrices"))
        if not team or not toks:
            continue
        won = 1 if (op and str(op[0]) == "1") else 0
        if won:
            winner = team
        price = pre_tournament_price(toks[0], kickoff_ts)
        if price is None:
            log(f"  no history for {team} — excluded")
            continue
        teams.append({"team": team, "raw": price, "won": won})
    if not teams or winner is None:
        log("  unresolved or no priced teams — skipping")
        return None

    # de-vig: normalise YES prices across priced teams
    tot = sum(x["raw"] for x in teams) or 1.0
    for x in teams:
        x["p"] = x["raw"] / tot
    teams.sort(key=lambda x: -x["p"])
    for i, x in enumerate(teams):
        x["rank"] = i + 1

    n = len(teams)
    fav = teams[0]
    win_row = next(x for x in teams if x["won"])
    # pooled metrics over every (team, won) pair
    brier = sum((x["p"] - x["won"]) ** 2 for x in teams) / n
    logloss = -sum(
        x["won"] * math.log(min(max(x["p"], EPS), 1 - EPS))
        + (1 - x["won"]) * math.log(1 - min(max(x["p"], EPS), 1 - EPS))
        for x in teams
    ) / n
    # uniform baseline (1/n per team) on the identical set
    u = 1.0 / n
    brier_u = sum((u - x["won"]) ** 2 for x in teams) / n
    logloss_u = -sum(
        x["won"] * math.log(u) + (1 - x["won"]) * math.log(1 - u) for x in teams
    ) / n

    return {
        "tournament": t["name"],
        "teams_priced": n,
        "winner": winner,
        "winner_implied_pct": round(win_row["p"] * 100, 1),
        "winner_rank": win_row["rank"],
        "favorite": fav["team"],
        "favorite_implied_pct": round(fav["p"] * 100, 1),
        "favorite_won": bool(fav["won"]),
        "winner_in_top4": win_row["rank"] <= 4,
        "brier": round(brier, 5),
        "brier_uniform": round(brier_u, 5),
        "logloss": round(logloss, 5),
        "logloss_uniform": round(logloss_u, 5),
        "brier_skill_vs_uniform": round(1 - brier / brier_u, 3) if brier_u else None,
        "ladder": [
            {"rank": x["rank"], "team": x["team"], "implied_pct": round(x["p"] * 100, 1), "won": bool(x["won"])}
            for x in teams[:6]
        ],
    }


def main() -> int:
    results = [r for t in TOURNAMENTS if (r := score_tournament(t))]
    if not results:
        log("no tournaments scored — aborting")
        return 1

    # pooled across tournaments (champion calibration sample)
    n_fav_won = sum(1 for r in results if r["favorite_won"])
    n_top4 = sum(1 for r in results if r["winner_in_top4"])
    # weight pooled metrics by teams_priced
    tot_teams = sum(r["teams_priced"] for r in results)
    pooled_brier = sum(r["brier"] * r["teams_priced"] for r in results) / tot_teams
    pooled_logloss = sum(r["logloss"] * r["teams_priced"] for r in results) / tot_teams
    pooled_brier_u = sum(r["brier_uniform"] * r["teams_priced"] for r in results) / tot_teams

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "polymarket",
        "method": "De-vigged tournament-winner implied probability as of kickoff-eve, scored vs actual champion. Brier/log-loss pooled over every priced (team, outcome) pair; uniform = 1/N baseline.",
        "tournaments_scored": len(results),
        "favorite_won": f"{n_fav_won}/{len(results)}",
        "winner_in_top4": f"{n_top4}/{len(results)}",
        "pooled_brier": round(pooled_brier, 5),
        "pooled_brier_uniform": round(pooled_brier_u, 5),
        "pooled_brier_skill_vs_uniform": round(1 - pooled_brier / pooled_brier_u, 3) if pooled_brier_u else None,
        "pooled_logloss": round(pooled_logloss, 5),
        "results": results,
    }

    out = DATA_DIR / "polymarket-backtest.json"
    out.write_text(json.dumps(summary, indent=2) + "\n")

    # human report
    print("\n" + "=" * 64)
    print("POLYMARKET TOURNAMENT-WINNER BACKTEST (market leg)")
    print("=" * 64)
    for r in results:
        flag = "✓" if r["favorite_won"] else "✗"
        print(f"\n{r['tournament']}  ({r['teams_priced']} teams priced)")
        print(f"  Champion: {r['winner']}  — market had it #{r['winner_rank']} @ {r['winner_implied_pct']}%")
        print(f"  Favorite: {r['favorite']} @ {r['favorite_implied_pct']}%  → favorite won? {flag}")
        print(f"  Brier {r['brier']} (uniform {r['brier_uniform']}, skill {r['brier_skill_vs_uniform']}) · log-loss {r['logloss']}")
        top = ", ".join(f"{x['team']} {x['implied_pct']}%" + ("★" if x["won"] else "") for x in r["ladder"][:4])
        print(f"  Top of board: {top}")
    print("\n" + "-" * 64)
    print(f"POOLED ({tot_teams} team-outcomes over {len(results)} tournaments)")
    print(f"  Favorite won:    {summary['favorite_won']}")
    print(f"  Winner in top-4: {summary['winner_in_top4']}")
    print(f"  Brier {summary['pooled_brier']} vs uniform {summary['pooled_brier_uniform']}  → skill {summary['pooled_brier_skill_vs_uniform']}")
    print(f"  Log-loss {summary['pooled_logloss']}")
    print(f"\n→ wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
