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

## Guardrails

- Display + prediction only: never writes actualResults, never advances a
  bracket, never awards points (STATUS-GATING untouched).
- Sampler stops at FINAL, on page teardown, or after 4h.
- Events-feed convention (verified): `team` on own-goals is already the
  benefiting side — reconstruction matches 94/94 FT regulation scores exactly;
  AET/PEN matches are regulation draws.
