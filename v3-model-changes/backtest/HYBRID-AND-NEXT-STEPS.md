# The hybrid "~70%" — what it is, and what can raise it

## 1. What the ~70% actually measures

The app's `data/backtest.json` shows hybrid ≈ **72%** (46/64 WC2022, 37/51
Euro2024). Two caveats, both important:

- It is **`is_estimate: true` — seed data, not a measured backtest.** Treat it as
  a prior, not a result.
- ~72% is **decisive-match (winner-prediction) accuracy**, not strict 3-way.
  Measured on the same tournaments with point-in-time Elo:

| Definition | WC2022 | Euro2024 | All 610 finals |
|---|---|---|---|
| Strict 3-way (predict H/D/A) | 54.7% | 51.0% | 54.1% |
| **Decisive-match (winner correct \| non-draw)** | **71.4%** | **76.5%** | **73.2%** ← the "~70%" |
| Favourite no-loss (win or draw) | 78.1% | 84.3% | 80.2% |

So "hybrid ~70%" ≈ *how often the predicted winner is right when a match has a
winner*. Strict match prediction (incl. draws) is ~54% — the real ceiling.

## 2. Can combining DT + J5L + V3 raise it? — No (not by averaging them)

The 66-combination sweep ([COMBINE-REPORT.md](COMBINE-REPORT.md)) is conclusive:
because J5L, DT and V3 are all **Elo-driven** (the only signal reconstructable
historically), they rank the **same favourite** in every match. Averaging them
therefore leaves decisive accuracy and favourite-no-loss **unchanged**, and only
ties the best single model (V3) on calibration. **You cannot raise a winner-
prediction rate by averaging models that already agree on the winner.**

## 3. What DOES raise it — independent signals + a tuned weight

The lever is a signal that **re-orders the favourite correctly more often than
Elo** — i.e. one that is *independent* of Elo. The seed `backtest.json` ordering
encodes exactly this belief and is the right intuition:

```
model 65.6%  <  DT 67.2%  <  market 68.8%  <  hybrid 71.9%   (WC2022 seed)
```
The note in the file says it outright: *"Market edge largely from knockout upsets
the model under-weighted."* Markets price injuries, form, news and sharp money
that Elo can't see — so adding them flips some wrong favourites to right ones.

**The combinations that can raise the level (in priority order):**

1. **Model + Market (Kalshi), weight-tuned.** This is the hybrid — but today it's
   a *fixed* 50/50 blend **and Kalshi per-match odds ship EMPTY** (`scrape_kalshi.py`
   `fetch_match_outcomes()` is a stub), so the live hybrid silently falls back to
   tournament-winner odds. **Update #1:** fill match-level Kalshi odds, then tune
   the blend weight on held-out data instead of hard-coding 0.5.
2. **Un-dormant DT's talent layer.** DT is pure Elo today (all talent components
   = 0). Populate it from squad **market value** (Transfermarkt) — a signal partly
   independent of Elo. **Update #2.**
3. **Adopt V3's Poisson engine** for the match form (best-calibrated here) and feed
   it a rating that blends `w·z(elo) + (1−w)·z(market) + talent`. **Update #3.**

A model + market hybrid with a tuned weight is the single change most likely to
push decisive accuracy from ~73% toward the mid/high-70s.

## 4. Honest ceiling

Don't expect 90%. Bookmakers themselves hit ~75–78% on decisive matches and
~53–55% strict 3-way. The realistic prize from market+talent is **~+2–5pp on
decisive accuracy** (consistent with the seed's model→hybrid +6pp) and better
*calibration* — not a jump to 80%+ winner accuracy.

## 5. To prove it (the one missing input)

Everything above is testable the moment we have **point-in-time bookmaker closing
odds** (or implied probabilities) for the past tournaments. Then:
- Compute the de-vigged **bookmaker baseline** (V3 `evaluation.baseline_bookmaker`
  is already written).
- Backtest `w·model + (1−w)·market` over `w ∈ [0,1]`; pick the held-out optimum.
- Confirm it beats both pure-Elo and the bookmaker baseline on Brier/log-loss and
  decisive accuracy.

Until then, "combine the models" = combining correlated Elo views, which the data
shows adds nothing. The accuracy gain lives in the **market/talent signals**, not
in the averaging.
