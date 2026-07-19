# Quasi-home / "crowd support" analysis — WC2026 (2026-07-19)

**Question.** The remaining/finalist teams play in the US; a South-American side
(Argentina) draws a partisan, quasi-home crowd there — the "Messi effect." Does
the self-learning J5L/stack model account for it, and does a crowd/home-advantage
term earn a place in the knockout projection?

**Answer.** The model does **not** model crowd support (verified: no crowd /
attendance / partisan / home-advantage / neutral-site feature exists in the
composite, DT, or stack pipeline — the only `host` boost applies solely to the
2026 co-hosts USA/Mexico/Canada, and the self-learning `form`/`stack` terms
learn from results, not crowds). Backtested on the 28 played knockout matches, a
crowd term does **not** clear the significance bar (permutation p = 0.33), so
per the analysis contract **no model change was made**. Unlike the luck term,
though, this is a statistical-power "no," not a "the effect isn't real" — see
below.

Reproduce: `python3 scripts/proto/crowd_backtest.py` (reads `data/*.json` +
`venues.json` coordinates).

## The crowd proxy (real geography, two principled encodings)

`teams.json` carries no confederation or home geography, so a static reference
map supplies each team's home-country centroid + confederation; venue
coordinates come from `data/venues.json` (linked per match via `venue_id`).

| proxy | definition | assumptions |
|---|---|---|
| `proximity` | `exp(−distance / 3000 km)` from team home to the match venue | closer home → more travelling fans + less jet lag. Pure geography. |
| `diaspora` | host CONCACAF (USA/MEX/CAN)=2, other CONCACAF + CONMEBOL=1, UEFA/CAF/AFC/OFC=0 | Americas teams draw quasi-home crowds in North-American venues (the Messi effect). |
| `combined` | `z(proximity) + z(diaspora)` | both. |

The term enters the model exactly as the luck term did, for comparability:
`gap = (stack_a + λ·σ_s·z_crowd_a) − (stack_b + λ·σ_s·z_crowd_b)`.

## Backtest — 28 played knockouts, 2-way log-loss (base = 0.4499)

| λ | proximity | diaspora | combined |
|---|---|---|---|
| 0.00 | 0.4499 · 82.1% | 0.4499 · 82.1% | 0.4499 · 82.1% |
| 0.05 | 0.4482 · 85.7% | 0.4479 · 85.7% | 0.4468 · 85.7% |
| 0.10 | 0.4472 · 85.7% | 0.4467 · 85.7% | 0.4464 · 82.1% |
| 0.15 | 0.4469 · 85.7% | 0.4464 · 82.1% | 0.4489 · 82.1% |
| 0.20 | 0.4473 | 0.4470 | 0.4543 |
| 0.30 | 0.4502 | 0.4508 | 0.4739 |

Best case shaves ~0.003 log-loss (one extra correct match of 28) at low λ, then
degrades — same magnitude as the luck term.

### Three checks

1. **Permutation test (combined, λ=0.15): p = 0.33.** 165 of 500 random
   crowd-to-team assignments match or beat the real term. Indistinguishable
   from noise — the disqualifier.
2. **Confounding — the key contrast with luck:** crowd correlates only
   **−0.04** with stack strength (proximity −0.008, diaspora −0.068), versus
   **+0.56** for luck. So this term is a genuinely independent axis, *not* a
   restatement of team strength. It simply can't prove its worth on 28 games.
3. **Effect size vs power.** Home advantage is one of the most robustly
   replicated effects in football (~0.3–0.5 goals for real hosts). A ~0.3-goal
   quasi-home nudge is below what 28 noisy knockout games can resolve. This is
   *absence of evidence from low power*, not evidence of absence — the opposite
   of luck, where the null was the expected truth.

## What the term says about the final

Spain vs Argentina @ MetLife (East Rutherford, NJ) — a neutral venue for both:

| team | conf | home→venue | proximity z | diaspora z | combined z |
|---|---|---|---|---|---|
| Argentina | CONMEBOL | 8,872 km | −0.49 | +0.90 | **+0.41** |
| Spain | UEFA | 5,787 km | +0.06 | −0.58 | **−0.53** |

Base stack: **Spain 58%** to advance. With the crowd term at a plausible λ:
0.10 → Spain 56% (Argentina +2), 0.15 → 55% (+3), 0.20 → 54% (+4). Directionally
what the hypothesis predicts (Argentina quasi-home), but it does **not** flip the
pick — Spain stays a modest favorite.

## Decision

- **Model: unchanged.** The backtest can't justify a fitted weight; fitting one
  on 28 games would be fitting noise onto the highest-stakes match.
- Because the effect is *real in the literature but unresolvable in-sample*, the
  honest options (for the owner to choose) are: (1) a display-only "home crowd"
  context note on the final's matchup page — surfacing the quasi-home edge
  without touching the projection; (2) a literature-anchored *fixed* prior (not
  fit from our 28 games), clearly flagged as an assumption; (3) leave as-is and
  revisit with more neutral-site data. This document records the analysis; any
  UI/model change is a separate, opted-in step.
