# R18 — Match Momentum + validated in-play win probability

Owner idea: "measure momentum shifts and possession value as it relates to match
outcome based on shots, shots on goal, and goals scored" — and use it to update
the live who-wins prediction.

## What the 2026 data said (tests run before building)

- **Momentum-as-prediction fails.** Across 192 consecutive-goal pairs, the team
  that just scored got the next goal **50.5%** of the time — a coin flip, below
  the ~55-60% team-strength baseline. 2-goal leads were surrendered 2/45 times.
  Game state (score + time) is what predicts; streaks don't.
- **Signal hierarchy (96 matches, decisive only):** SoT majority won **86%**
  (partly tautological — goals are SoT), possession majority **72%**, total
  shots ~56% (all-match). Shots-on-target is the run-of-play signal worth using;
  possession the least.
- Full-tournament boxscores were recovered via `scrape_match_stats.py --backfill`
  (ESPN keeps serving past summaries): 3 → **96 matches** in match_stats.json.
  The hourly cron's 30h window maintains coverage from here.

## What shipped

1. **Validated in-play win-probability core** (`app/lib/win-prob.js`, R18 core):
   the RJ30-5 heuristic blend was replaced by a remaining-time bivariate-Poisson
   race. The pre-match prior is numerically inverted to per-90' scoring rates
   (`lambdasFromPrior`), so kickoff reproduces the prior exactly; score, clock,
   and red cards (0.65×/1.25×) generate every update. Knockout level-branch
   resolves by a strength logistic (ET/pens). Walk-forward validation on all 96
   played matches' real goal/red timelines (`scripts/proto/validate_inplay.py`):

   | minute | live Brier | static Brier | improvement |
   |---|---|---|---|
   | 45 | 0.444 | 0.486 | 8.6% |
   | 60 | 0.431 | 0.486 | 11.2% |
   | 75 | 0.377 | 0.486 | 22.4% |
   | 85 | **0.249** | 0.486 | **48.7%** |

   The old constants were hand-tuned and never validated; all 23 locked
   property tests (`rj30-winprob.test.mjs`) pass unchanged on the new core.

2. **Bounded shot-pressure tilt**: live SoT dominance vs the rates' expectation
   nudges the in-play rates by at most ±25% (saturating ~6 SoT) — it can shift
   a prediction, never flip a clear favorite by itself. Red cards + SoT reach
   the widget via a window stash written by the sampler (3-min freshness).

3. **Live "Match Momentum" panel** (`app/live-momentum.js` + `app/lib/momentum.js`):
   for live matches the matchup page samples ESPN's boxscore every **10s**
   (deduped — ESPN refreshes slower) and aggregates per minute by the
   **maximum-magnitude** pressure sample — the owner's extremes spec: a burst
   isn't washed out by the quiet seconds around it. Pressure = weighted deltas
   (SoT 0.55, shots 0.30, possession swing 0.15), clamped to [-1,1]. Non-live
   fixtures keep the cron-fed RJ30.2 strip unchanged.

## R19 — self-learning loops (added same day)

All picks now sit on cron-driven learning loops, each never-regress:

| Loop | Cadence | What it learns |
|---|---|---|
| `build_stacker.py` | hourly + live | The J5L/DT blend weight (pregame picks) |
| `optimize_weights.py` | daily (**by design** — hourly would churn commits/probabilities; model-optimizer.test.mjs locks this) | Composite weights + Poisson calibration + hybrid blend |
| `tune_inplay.py` (new) | hourly + live | The in-play red-card multipliers, re-fit from played goal/red timelines → `data/inplay_params.json` → `configureInplay()` on the client. First fit already adopted: (0.65, 1.25) → **(0.85, 1.00)**, red-checkpoint Brier 0.055 → 0.042 — this tournament's red cards swing matches less than the literature default assumed. Writes only on real change (anti-churn). SoT tilt cap stays static until the live sampler accrues shot timelines. |

### Noise-reduction study (data/proto/noise_reduction_report.json)

- **Draw-as-win framing (owner ask):** scoring a pick as correct on win-or-draw
  puts the default model at **94.9%** on played matches (strict 3-way: 70.1%).
  Fitting "unbeaten" directly beats deriving it from the 3-way (Brier 0.0966 vs
  0.1006) — a small real gain for double-chance display. A draw-propensity
  feature did NOT help the 3-way model (0.768→0.771).
- **Late-stage weighting (owner ask):** group-performance carry into knockout
  predictions made things WORSE (0.742→0.832 logloss) — current strength already
  contains it. Up-weighting in-tournament Elo ×3 moved logloss by only −0.07%
  (noise). Not adopted.
- **ML sweep (LOO, n=96):** every generic family (SVC 0.829, logistic 0.888,
  RF 0.902, MLP 0.911, XGBoost 0.926, GBM 0.951, KNN 1.061, NB 2.177) LOSES to
  the calibrated stack baseline (0.799). The parametric engine + self-tuned
  weights remain the right architecture at ~100 matches.

## Guardrails

- Display + prediction only: never writes actualResults, never advances a
  bracket, never awards points (STATUS-GATING untouched).
- Sampler stops at FINAL, on page teardown, or after 4h.
- Events-feed convention (verified): `team` on own-goals is already the
  benefiting side — reconstruction matches 94/94 FT regulation scores exactly;
  AET/PEN matches are regulation draws.
