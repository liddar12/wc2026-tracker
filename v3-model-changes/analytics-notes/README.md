# Analytics Notes — V3 model (`wc2026`)

Same treatment as the live app's `analytics-notes/`, but for the **V3 forecaster**
staged in `../model/worldcup2026/`: what data each layer uses, the exact
equations and weights, what you must supply by hand, and how to tune/validate it.

> **Big idea:** V3 is a **self-contained offline Python model**, not a live
> service. There is **no cron and no runtime API** — every input is supplied by
> hand in one CSV (`data/teams_2026.csv`), and you run `simulate.py` to produce
> odds. It improves on Klement by **leading with Elo + squad market value**
> (demoting FIFA ranking) and **scoring itself with Brier/log-loss** instead of
> "did I pick the champion."

## The four layers

| Module | Job | Doc |
|---|---|---|
| `ratings.py` | Blend Elo + market value + GDP + population + FIFA + host into one z-scored strength per team | [MODEL-MODULES.md](MODEL-MODULES.md#1-ratingspy) |
| `match_model.py` | Two strengths → expected goals → **bivariate-Poisson** scoreline / 1X2 probs | [MODEL-MODULES.md](MODEL-MODULES.md#2-match_modelpy) |
| `tournament.py` | Monte-Carlo the real **48-team / 12-group** bracket, vectorised over all sims | [MODEL-MODULES.md](MODEL-MODULES.md#3-tournamentpy) |
| `evaluation.py` | Score the match model with **Brier / log-loss** vs a de-vigged bookmaker baseline | [MODEL-MODULES.md](MODEL-MODULES.md#4-evaluationpy) |

- [DATA-INPUTS.md](DATA-INPUTS.md) — the `teams_2026.csv` contract: every column, its source, units, and the fact that **all of it is manual**.
- [TUNING-AND-VALIDATION.md](TUNING-AND-VALIDATION.md) — how to fit the weights/`beta`/`mu`, and the backtest already run (`../backtest/REPORT.md`).

## ⚠️ MUST SUPPLY BY HAND (everything — no automation)

Unlike the live app (cron-fed), V3 reads exactly one file you maintain:

- **`data/teams_2026.csv`** — 48 rows. You set, per team: `elo`, `market_value`,
  `gdp_per_capita`, `population`, `fifa_points`, `temperature` (optional),
  `is_host`, and the **`group`** draw (A–L, 4 each). The shipped values are
  **illustrative sample data** and must be replaced before any real forecast.
- **Knockout bracket** — default `bracket="reseed"` seeds qualifiers by strength;
  the *exact* official R32 slotting needs `bracket="fixed"` + a slot map.

## Default model parameters (defined in code)

| Param | Default | Meaning |
|---|---|---|
| `RatingConfig.w_elo` | 0.50 | weight on z(Elo) — best single signal |
| `RatingConfig.w_market` | 0.30 | weight on z(log market value) — current quality |
| `RatingConfig.w_gdp` | 0.07 | weight on z(log GDP/capita) |
| `RatingConfig.w_population` | 0.05 | weight on z(log population) |
| `RatingConfig.w_fifa` | 0.08 | weight on z(FIFA points) — demoted |
| `RatingConfig.host_bonus` | 0.35 | z-score bump for USA/MEX/CAN |
| `RatingConfig.w_temperature` | 0.0 | off by default |
| `MatchConfig.mu` | 0.30 | log baseline goals (`exp(0.30)≈1.35`/team) |
| `MatchConfig.beta` | 0.70 | rating-gap → goal-supremacy scaling |
| `MatchConfig.lambda3` | 0.12 | bivariate-Poisson shared component (correlation) |
| `MatchConfig.pen_beta` | 0.35 | shootout edge per rating unit (knockouts) |
| `MatchConfig.max_goals` | 12 | grid truncation for analytic probs |
| `TournamentConfig.n_sims` | 20000 | Monte-Carlo runs |
| `TournamentConfig.seed` | 42 | RNG seed (reproducible) |

## Key findings (full numbers in `../backtest/REPORT.md`)

- The **V3 bivariate-Poisson match model is better calibrated than the live J5L
  logistic** on 610 real finals (2010–2024, held-out 2021–2024): log-loss
  0.989 → **0.974**, Brier slightly better, **1X2 accuracy unchanged (56.2%)**.
- The **Elo + market-value blend** (the model's headline edge over Elo-only) is
  **not yet historically validated** — point-in-time squad values for past
  tournaments aren't reconstructable. Tune/validate it once that data exists
  (see TUNING-AND-VALIDATION.md).
- Architecture is sound and fast (30k sims ≈ 1.4 s); layers are swappable.

## Tests

A unit suite lives in `../model/worldcup2026/tests/` (run
`python -m unittest discover -s tests` or `python -m pytest tests/`): ratings
(z-scoring, weights, host bonus, signal-drop), match model (prob sum, monotonicity,
symmetry, shootout), tournament (format, qualifier count, seeding split,
determinism), evaluation (Brier/log-loss/de-vig closed-form checks).
