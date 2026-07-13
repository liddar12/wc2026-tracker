# Luck Analysis — WC2026 remaining teams (2026-07-13)

**Question.** For the remaining teams (France, Spain, England, Argentina), is
there a measurable "luck" component — penalties awarded in scoring range,
corner volume, favorable calls, fewer penalties/cards against — and does
weighting it improve projected outcomes from the Round of 32 without adding
noise?

**Answer.** Yes, there is a real, measurable luck asymmetry — and **no, it must
not be weighted into the model**. Backtested on all 28 played knockout matches,
a luck weight adds nothing beyond the stack model (permutation p ≈ 0.28), and
once team strength is partialled out, residual luck makes predictions strictly
*worse* at every weight. The luck index therefore ships as a **display-only**
"Luck check" card on the Projected tab (`app/lib/luck-index.js`), and never
feeds `bracket-autofill`/`model-pick`.

Reproduce: `python3 scripts/proto/luck_backtest.py` (reads `data/*.json`).

## Metrics

Group-stage per-match rates, z-scored across all 48 teams (+ = lucky):

| Component | Source | Meaning |
|---|---|---|
| `pens_for` / `pens_against` | `match_events.json` `pen-goal` | scored penalty kicks awarded for / against |
| `corners_for` / `corners_against` | `match_stats.json` `wonCorners` | corner kicks won / conceded |
| `foul_diff` | `match_stats.json` `foulsCommitted` | fouls drawn − committed (favorable-whistle proxy) |
| `card_diff` | `match_events.json` | opponent cards − own cards (yellow = 1, red = 2) |
| `own_goal_gifts` | `match_events.json` `own-goal` | opponent own-goals received |
| `finish_luck` | `xg.json` + results | goals scored − pre-match model xG |
| `concede_luck` | `xg.json` + results | opponent pre-match xG − goals conceded |
| shootout wins | `actual_results.json` `method:"pens"` | coin-flip component (reported, not indexed) |

Also checked: `match_referees.json` exists but is empty — no referee-level
"favorable calls" signal is scrapeable today; `foul_diff`/`card_diff` are the
proxies. Missed (unscored) penalties are not in the event feed; `pen-goal`
covers scored ones only.

## Findings — the remaining four (luck index, rank of 48)

| Team | Index | Rank | Signature |
|---|---|---|---|
| England | **+0.65σ** | 5/48 | pen awarded (+2.0z), most corners in the field (8.0/gm, +1.7z), friendliest whistle (drew 5 more fouls/gm than committed, +1.6z) |
| Argentina | **+0.54σ** | 8/48 | pen awarded (+2.0z), card edge (+0.9z), conceded 0.5 goals/gm under xG (+1.2z) |
| Spain | **+0.23σ** | 11/48 | corner dominance both ways (+1.5z/−1.7z) but possession-driven; whistle *against* them (−1.8z); finished −0.4 goals/gm under xG |
| France | **+0.13σ** | 16/48 | nothing beyond ±0.5z — the least luck-assisted run of the four |

None of the four has a penalty-shootout win. Field extremes: luckiest
Switzerland (+1.2), Canada (+1.1); unluckiest Curaçao (−1.0), Bosnia and
Herzegovina (−0.94).

## Backtest — does a luck weight help from the R32?

Design: luck computed from **group-stage data only**, then used to predict the
28 played knockout results (R32 16, R16 8, QF 4) as
`gap = (s_a + λ·σ_s·luck_a) − (s_b + λ·σ_s·luck_b)` through the pipeline's
bivariate-Poisson two-way probability (MU = 0.30, BETA = 0.70), `s` = stack
strengths. Lower log-loss is better.

| λ | log-loss (full index) | log-loss (calls-only) | accuracy |
|---|---|---|---|
| 0.00 | 0.4508 | 0.4508 | 89.3% |
| 0.10 | 0.4489 | 0.4480 | 89.3% |
| 0.20 | 0.4479 | 0.4466 | 89.3% |
| 0.50 | 0.4497 | 0.4499 | 82.1% |

Three reasons the apparent ~0.6% gain is noise, not signal:

1. **Permutation test**: shuffling which team owns which luck value, 28% of
   random assignments match or beat the real index at λ = 0.15 (142/500).
2. **Confounding**: luck correlates **+0.56** with stack strength — dominant
   teams win more corners and draw more fouls. The "luck" gain is mostly
   strength counted twice.
3. **Residualized luck** (strength partialled out) is strictly worse at every
   λ (0.4508 → 0.4525 → 0.4590 → 0.4760 for λ = 0.05/0.15/0.30) — once the
   double-counted strength is removed, what remains only hurts.

Per-stage deltas also flip sign at the QF (R32 −0.003, R16 −0.003, QF +0.001):
no stable structure.

## Decision

- **Model: unchanged.** Any λ > 0 is unjustifiable noise per the above.
- **Product: descriptive "Luck check" card** on the Projected tab
  (`renderLuckCard` in `app/components/projected-bracket-tree.js`), shown while
  ≥ 2 named teams have an unplayed knockout match, with per-team index + top
  component chips and an explicit "never adjusts projections" disclaimer.
- **Guardrail test**: `tests/feature/luck-index.test.mjs` locks metric signs,
  the remaining-teams gate, and that no projection module imports the index.
  `tests/ux/projected-bracket.spec.mjs` covers the card end-to-end.

Residual-luck z for the remaining four (true luck, strength removed): France
−0.90, Spain −0.79, England +0.30, Argentina +0.26 — i.e. relative to how
strong they are, France and Spain have if anything been *under*-lucky.
