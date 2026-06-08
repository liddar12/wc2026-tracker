# Does a "luck factor" (KenPom-style) improve calibration? — measured: NO

**Question:** add a luck factor (à la KenPom) and/or de-luck the rating, and see
whether it improves calibration going forward. Also mine
`jieguangzhou/FIFA-World-Cup-2022` for calibration ideas.

## Setup
Point-in-time Elo over 49k international matches; 610 WC/Euro/Copa finals
(2010–2024), held-out test ≥2021 (226). `luck` per team = trailing
`Σ(actual − Elo-expected points)` over the last 10 internationals (KenPom's
construct). Three models, each fit on train, scored on the held-out test.
Reproduce: `node v3-model-changes/backtest/luck-backtest.mjs <results.csv>`.

## Result (held-out test)
| Model | Brier ↓ | Log-loss ↓ | 1X2 acc | Decisive |
|---|---|---|---|---|
| Elo baseline | 0.5752 | 0.9796 | 55.3% | 76.2% |
| De-luck (no goal-margin Elo) | 0.5762 | 0.9805 | 56.6% | 78.0% |
| Elo + luck feature (best γ=−2) | 0.5752 | 0.9788 | 55.3% | 76.2% |

## Verdict — luck is descriptive, not predictive
- **The luck term earns ~nothing.** Its optimal weight is small and **negative**
  (γ=−2 Elo per luck-point → recently over-performing teams regress slightly), and
  the held-out log-loss improvement is **~0.08%** — inside the noise. luckDiff has
  mean ≈0, sd ≈5 over a 10-game window, i.e. it regresses to zero. This is exactly
  KenPom's own finding: **luck explains the past, it does not predict the future.**
- **De-lucking via a no-margin Elo is a wash** (−0.001 Brier / −0.0009 log-loss vs
  baseline; +1.3pp accuracy). The goal-margin signal is mildly useful, not harmful.
- **So: do NOT bake luck into the rating** — it would add noise. Use it only as a
  *descriptive* transparency metric (flag teams due to regress), if at all.

## What DOES help calibration (for contrast)
- **Independent signals, not luck.** Elo + squad market value/talent improved
  log-loss ~1% (`TALENT-BLEND-RESULT.md`); the V3 bivariate-Poisson form beat the
  logistic (`REPORT.md`). The lesson: *independent signal helps; noise/momentum does
  not.* That's why the shipped hybrid blends J5L + DT(market value) + Kalshi.
- The genuine "luck-adjustment" with real value is **rating on xG instead of goals**
  (strips finishing variance) — but it needs a historical xG source we don't have;
  the live app's `xg.json` enables it going forward, not for this backtest.

## jieguangzhou/FIFA-World-Cup-2022 — anything to borrow?
- Method: a **binary AutoML classifier** (FLAML) on FIFA-attribute features
  (offense/defense/midfield/GK + ranks) → home-win vs away-win, with a crude
  **"call it a draw if top prob < 0.60"** rule, then a 1000-run Monte-Carlo.
- **Not better calibrated** — the draw-as-residual hack is uncalibrated (it *validates*
  our principled Poisson draw model). No probability calibration (Platt/isotonic).
- **Only useful asset: the FIFA-attribute talent features** — an independent signal,
  already tested here (~1% calibration gain) and conceptually shipped via DT's
  market-value talent layer.

## Recommendation
1. **Don't add luck to the rating** (no calibration benefit; adds noise).
2. Optional: a *descriptive* "Luck" chip (`actual − xG-expected points`) for
   transparency only — flags regression candidates, does not change predictions.
3. The real calibration levers remain: **independent signals** (market/talent, now
   shipped) and **xG-based rating** when an xG history is available.
