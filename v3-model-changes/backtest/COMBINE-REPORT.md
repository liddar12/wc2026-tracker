# Combining J5L + DT + V3 — backtest of all weight combinations

**Ask:** combine the three models, backtest variations, find which clear **80%**.

**Method:** each model is a P(H/D/A) function of the **point-in-time Elo gap**
(computed from 49k international matches) — the one signal reconstructable 15y
back. Forms: **J5L** = tuned logistic, **DT** = canonical Elo expectancy (DT is
pure Elo today), **V3** = bivariate-Poisson. An ensemble is a weighted average of
the three probability vectors. Base params fitted on **train ≤2019** (384
matches); every combination evaluated on **held-out test ≥2021** (226 matches).
All 66 weight combinations on the `{J5L,DT,V3}` simplex (step 0.1) were swept.
Full table: [`combine-results.csv`](combine-results.csv).

## ⚠️ Read this first — what "80%" can and can't mean

**No combination — and no bookmaker — reaches 80% on raw match (1X2) accuracy.**
International results are ~50% luck; ~26% of matches are draws; bookmaker closing
odds score ~53–55%. **Every one of the 66 combinations lands at 56.2% 1X2
accuracy** — flat, because historically the three models share the Elo signal, so
they pick the same favourite. 80% *match-outcome* accuracy is not attainable by
anyone.

Where **80%+ is real and meaningful**: a **confidence-filtered** metric —
*when the model is ≥t confident in a favourite, how often does that favourite
avoid defeat (win or draw)* — and **calibration** (Brier/log-loss).

## Result 1 — combining does NOT beat the best single model

The three single models and the best ensembles (held-out test):

| Combo (J5L/DT/V3) | 1X2 acc | Brier ↓ | Log-loss ↓ | decisive acc |
|---|---|---|---|---|
| 1.0 / 0 / 0  (J5L only) | 56.2% | 0.5759 | 0.9807 | 77.4% |
| 0 / 1.0 / 0  (DT only) | 56.2% | 0.5773 | 0.9790 | 77.4% |
| **0 / 0 / 1.0  (V3 only)** | **56.2%** | **0.5752** | **0.9745** | 77.4% |
| 0 / 0.1 / 0.9 | 56.2% | 0.5752 | 0.9746 | 77.4% |
| 0.1 / 0 / 0.9 | 56.2% | 0.5750 | 0.9746 | 77.4% |
| 0.1 / 0.1 / 0.8 | 56.2% | 0.5751 | 0.9748 | 77.4% |

**Finding:** calibration is maximised by **V3-heavy** blends (V3 weight ≥0.7);
**pure V3 is the single best** (log-loss 0.9745). Mixing in J5L/DT changes
log-loss only in the 4th decimal and never beats V3 alone. This is expected — an
ensemble can't out-predict its best member when the members are **correlated**,
and here all three are driven by the same reconstructable signal (Elo). Raw 1X2
accuracy is identical (56.2%) for all 66 combos.

## Result 2 — combinations that clear 80% (confidence-filtered)

"Favourite avoids defeat" rate, by how confident the model is, with coverage (%
of matches that qualify):

| Confidence threshold | combos ≥80% | avg coverage |
|---|---|---|
| favourite prob ≥ 0.60 | **66 / 66** | 34% of matches |
| favourite prob ≥ 0.65 | **66 / 66** | 20% of matches |
| favourite prob ≥ 0.70 | 64 / 66 | 11% of matches |

Best example (pure **V3**): **88.0%** of favourites avoid defeat over the **22%**
most-confident matches (≥0.65); 90.5% over the 33% of matches at ≥0.60. So on the
slice where the model is confident, every sensible combination is well above 80% —
and V3-heavy blends top it.

## Bottom line

1. **Combining J5L + DT + V3 does not improve accuracy over V3 alone** — on
   historical data they share the Elo signal, so the ensemble is flat (1X2 56.2%)
   and only ties V3 on calibration. *Use V3 (bivariate-Poisson) as the engine; the
   ensemble buys nothing here.*
2. **No combination reaches 80% on 1X2 accuracy** (none can). **All clear 80%** on
   the confidence-filtered favourite metric — ~88% on the ~20% most-confident games.
3. **The real upside of combining models is diversification of *independent*
   signals (Elo vs market value vs talent), and that still can't be tested
   historically** — point-in-time market/talent values for 2010–2022 don't exist
   in reconstructable form. Until that data is sourced, "combine the models" mostly
   means "combine three correlated Elo views," which the numbers show adds nothing.

## Recommendation
- Adopt **V3 (Poisson)** as the match engine now — best calibrated, no accuracy cost.
- To make combining actually pay off, the blend must mix **independent** signals:
  source point-in-time **market value** (and/or bookmaker odds) for past
  tournaments, then re-run this harness with `rating = w·z(elo) + (1−w)·z(market)`.
  That is the experiment that can move accuracy — not averaging correlated models.

## Reproduce
```
node v3-model-changes/backtest/combine-backtest.mjs <results.csv> combine-results.csv
```
