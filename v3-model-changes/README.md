# V3 model changes

Staging area for the **next-generation ("V3") forecasting model** — to adopt
**after the current model is updated** (per owner). Nothing here is wired into
the live app; it's a reviewed, validated drop-in candidate.

## Contents

| Path | What it is |
|---|---|
| `model/worldcup2026/` | The V3 model (uploaded). A Klement-improved forecaster: blends **Elo + squad market value + systemic priors** into one rating → **bivariate-Poisson** scoreline → **Monte-Carlo** of the real 48-team/12-group bracket → calibrated round/title odds. Python, data-driven, swappable layers. See its own `README.md`. |
| `klement-wc-model-deep-dive.md` | Methodology deep-dive: reverse-engineers Klement's model, why "3 champions in a row" is mostly luck, and the build blueprint (lead with Elo + market, demote FIFA, score with Brier/log-loss vs a baseline). |
| `backtest/` | Independent validation of the V3 approach on real history (see `backtest/REPORT.md`). |

## What the backtest found (TL;DR — full numbers in `backtest/REPORT.md`)

Validated on **610 real finals matches** (WC/Euro/Copa 2010–2024) using
point-in-time Elo computed from 49k international matches, held-out test 2021–2024:

- The **V3 bivariate-Poisson match model** is **better calibrated than the live
  J5L logistic** — log-loss 0.989 → **0.974**, Brier slightly better, **1X2
  accuracy unchanged (56.2%)**. Meets the success bar (↓Brier & ↓log-loss, no
  accuracy loss).
- A simple **retune of the live logistic** also beats the untuned baseline — a
  free win even without adopting V3.
- **Open item:** the Elo **+ market-value blend** (the "combine DT + J5L" core)
  could **not** be backtested — point-in-time squad values for past tournaments
  aren't reconstructable, and DT's FBref generator isn't in the repo. The harness
  + V3 `evaluation.py` are ready to validate it the moment point-in-time market
  values (or bookmaker closing odds) are supplied.

## Recommended path (gated, per owner's plan)

1. **Now (validated, no new data):** port the V3 Poisson `outcome_probs` (or the
   tuned logistic) into the live J5L W/D/L layer — calibration win, zero accuracy
   cost.
2. **Then:** plug **current** Transfermarkt squad values into the V3 rating and
   forward-run WC2026 to see how much market value moves the odds.
3. **To fully validate the blend:** source point-in-time market values / bookmaker
   odds for 2014/18/22, run the harness with `rating = w·elo_z + (1−w)·market_z`,
   sweep `w`. Only then bake the talent layer into J5L and un-dormant DT.

## Running the V3 model
```bash
cd model/worldcup2026
pip install -r requirements.txt
python simulate.py                 # 20k sims, title odds (sample data)
python tests/test_smoke.py
```
The shipped `data/teams_2026.csv` is **illustrative** — replace `elo`,
`market_value`, etc. and the `group` draw with real data before any real forecast.
