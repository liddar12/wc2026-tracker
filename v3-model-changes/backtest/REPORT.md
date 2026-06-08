# Backtest report — can combining models + reweighting beat Elo-only?

**Question (from the owner):** un-dormant DT, combine DT + J5L, sweep the
Elo/weighting, and backtest against ~15 years of Copa América / Euros / World
Cups. Does prediction accuracy improve? **Success bar:** lower Brier **and**
log-loss without hurting 1X2 accuracy, vs an Elo-only baseline. Sandboxed — the
live model is untouched.

## What was actually tested (and the honest data limits)

- **Data — solid.** Full international match history (martj42 dataset, 49,446
  matches 1872–2025). I compute **point-in-time Elo** by running a canonical
  World-Football-Elo engine forward over every match (K by competition + goal-
  difference multiplier + 100 home advantage) — so each match is scored with the
  rating each team *actually had beforehand*. No scraping, fully reproducible.
- **Target set:** the 14 requested tournaments — WC 2010/14/18/22, Euro
  2012/16/20/24, Copa 2011/15/16/19/21/24 = **610 finals matches**.
- **Split:** fit params on train (≤2019, 384 matches), evaluate on **held-out
  test (≥2021, 226 matches)**. Metrics: multiclass Brier, log-loss, 1X2 accuracy.
- **The market-value / talent layer could NOT be historically backtested.**
  True point-in-time Transfermarkt squad values for 2010-era tournaments are not
  reliably reconstructable from public sources, and the DT generator (FBref) is
  not in the repo. So the *market* contribution of the blend is **not validated
  here** — only the single-signal (Elo) model FORM is. See "What's still open."

## Results — held-out test (2021–2024, 226 matches), single-signal Elo

| Match model | Brier ↓ | Log-loss ↓ | 1X2 acc |
|---|---|---|---|
| Canonical Elo logistic (untuned baseline) | 0.5829 | 0.9891 | 56.2% |
| Tuned logistic (`scale 150, drawBase 0.27, slope 1e-4`) | 0.5759 | 0.9807 | 56.2% |
| **V3 bivariate-Poisson, Elo-driven (`mu 0.10, beta 0.0036`)** | **0.5754** | **0.9743** | 56.2% |

(Actual draw rate in the target matches: 26.1%.)

## Verdict

- **Yes — the model FORM improvements clear the bar.** Moving from the untuned
  canonical-Elo logistic to either (a) the **tuned logistic** or (b) the **V3
  bivariate-Poisson** model lowers **both** Brier and log-loss on held-out data
  with **no loss of 1X2 accuracy**. The V3 Poisson is best on log-loss
  (0.9891 → 0.9743, **−1.5%**) — meaningful calibration gain.
- **Both are directly portable to the live J5L W/D/L layer.** The live model's
  `p = 1/(1+e^(−gap/4.5))` + `draw = max(.05, .32 − .015·|gap|)` was never fitted;
  the tuned constants (or the V3 Poisson scoreline model) are evidence-based
  replacements.
- **The combine-models (Elo + market/talent) question is NOT yet answered** — the
  historical market-value data to test it doesn't exist in a reconstructable
  form. What IS proven is that the V3 *architecture* (Elo-led rating → Poisson)
  is sound and well-calibrated on real history.

## Recommendation (tied to your gate)

1. **Adopt now (validated):** retune the live J5L W/D/L logistic to the fitted
   constants, or swap in the V3 bivariate-Poisson `outcome_probs`. Pure win on
   calibration, zero accuracy cost. No new data required.
2. **To answer the blend question, pick one:**
   - *Forward path (fast):* wire **current** Transfermarkt squad values into the
     V3 rating (`w_elo 0.55 / w_market 0.30`) and run it on WC2026 — quantify how
     much market value moves the odds vs Elo-only (informative, not a backtest).
   - *Rigorous path:* source **point-in-time** squad market values (or bookmaker
     closing odds) for 2014/2018/2022, then run the exact same harness with
     `rating = w·elo_z + (1−w)·market_z`, sweeping `w`. The harness + the
     uploaded V3 `evaluation.py` are ready to ingest it.
3. **Un-dormant DT** by populating its talent layer from squad market value (the
   chosen proxy) — but only after step 2 shows the market signal earns its weight
   on held-out data. Don't bake in an untested signal.

## How to reproduce
```
node v3-model-changes/backtest/backtest.mjs           <results.csv>   # logistic
node v3-model-changes/backtest/v3-poisson-backtest.mjs <results.csv>  # V3 Poisson
```
`results.csv` = martj42 international results (https://github.com/martj42/international_results).
`elo-engine.mjs` computes point-in-time Elo from it.
