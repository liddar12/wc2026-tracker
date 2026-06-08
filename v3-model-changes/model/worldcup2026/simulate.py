#!/usr/bin/env python3
"""
CLI entry point: simulate the 2026 World Cup and print/save title odds.

Examples
--------
    python simulate.py
    python simulate.py --sims 50000 --top 20
    python simulate.py --teams data/teams_2026.csv --out results.csv
    python simulate.py --w-elo 0.6 --w-market 0.25 --beta 0.8
"""

from __future__ import annotations

import argparse

from wc2026 import (
    Tournament,
    TournamentConfig,
    RatingConfig,
    MatchConfig,
    load_teams,
)


def main():
    p = argparse.ArgumentParser(description="World Cup 2026 Monte Carlo forecaster")
    p.add_argument("--teams", default="data/teams_2026.csv")
    p.add_argument("--sims", type=int, default=20000)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--top", type=int, default=15, help="rows to print")
    p.add_argument("--out", default=None, help="optional CSV path for full table")

    # rating weights
    p.add_argument("--w-elo", type=float, default=0.50)
    p.add_argument("--w-market", type=float, default=0.30)
    p.add_argument("--w-gdp", type=float, default=0.07)
    p.add_argument("--w-pop", type=float, default=0.05)
    p.add_argument("--w-fifa", type=float, default=0.08)
    p.add_argument("--host-bonus", type=float, default=0.35)

    # match model
    p.add_argument("--mu", type=float, default=0.30)
    p.add_argument("--beta", type=float, default=0.70)

    args = p.parse_args()

    teams = load_teams(args.teams)
    rating_cfg = RatingConfig(
        w_elo=args.w_elo,
        w_market=args.w_market,
        w_gdp=args.w_gdp,
        w_population=args.w_pop,
        w_fifa=args.w_fifa,
        host_bonus=args.host_bonus,
    )
    match_cfg = MatchConfig(mu=args.mu, beta=args.beta)

    tourney = Tournament(teams, rating_config=rating_cfg, match_config=match_cfg)
    result = tourney.run(TournamentConfig(n_sims=args.sims, seed=args.seed))
    table = result.table()

    pct_cols = [c for c in table.columns if c.startswith("P(")]
    shown = table.head(args.top).copy()
    for c in pct_cols:
        shown[c] = (shown[c] * 100).round(1)
    shown["rating"] = shown["rating"].round(2)

    print(f"\nWorld Cup 2026 — {args.sims:,} simulations\n")
    print(shown.to_string(index=False))

    if args.out:
        table.to_csv(args.out, index=False)
        print(f"\nFull 48-team table written to {args.out}")


if __name__ == "__main__":
    main()
