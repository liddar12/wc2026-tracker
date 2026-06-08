# V3 tuning & validation

The V3 analogue of the live model's IMPROVEMENTS-AND-BACKTESTING.md. The model's
own README says it plainly: *judge calibrated probabilities, not "did I pick the
champion."*

## The recipe (from the model README + `evaluation.py`)

1. Collect recent international **group + knockout** results for 2014/2018/2022
   (and more — `../backtest/` uses 2010–2024).
2. For each match, compute `model.outcome_probs(home_id, away_id)`.
3. Score with `evaluation.multiclass_brier` and `multiclass_log_loss`.
4. Compare against `evaluation.baseline_bookmaker(odds)` **and** a pure-Elo
   variant. If you can't beat the bookmaker baseline, the extra variables aren't
   earning their place.
5. **Grid-search `beta`, `mu`, and the rating weights to minimise log-loss** on a
   held-out split (don't fit and report on the same data).

## What's already been validated (`../backtest/REPORT.md`)

On **610 real WC/Euro/Copa finals (2010–2024)**, point-in-time Elo, held-out test
2021–2024:

| Match model | Brier | Log-loss | 1X2 acc |
|---|---|---|---|
| Canonical Elo logistic (untuned) | 0.5829 | 0.9891 | 56.2% |
| Tuned logistic | 0.5759 | 0.9807 | 56.2% |
| **V3 bivariate-Poisson (Elo-driven)** | **0.5754** | **0.9743** | 56.2% |

→ The V3 scoreline **form** is better calibrated than the live logistic, with no
accuracy loss. **Open:** the Elo **+ market-value** blend (V3's headline edge)
wasn't tested — point-in-time squad values for past tournaments aren't
reconstructable. The harness + `evaluation.py` are ready to ingest them.

## To finish validating the blend (priority order)

1. **Source point-in-time data** for 2014/18/22: squad market values *as of each
   tournament* (or bookmaker closing odds as the baseline). This is the one
   blocking input.
2. Run the harness with `rating = w·z(elo) + (1−w)·z(log market_value)`, sweeping
   `w ∈ [0,1]` and `beta`/`mu`; pick the lowest held-out log-loss. Confirm it
   beats both pure-Elo and the bookmaker baseline.
3. Add a **reliability plot** (predicted vs observed frequency in deciles) to
   check calibration, not just aggregate scores.
4. Only then lock the weights and wire V3 into the live app (adapter:
   `teams.json` → `teams_2026.csv`; add GDP/population lookup).

## Cheap forward check (no historical data needed)

Run `simulate.py` on **current** Transfermarkt values vs `--w-market 0` (Elo-only)
and diff the title odds — quantifies how much the market signal moves WC2026
forecasts. Informative, but not a substitute for the held-out backtest above.
