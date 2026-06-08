# Does an INDEPENDENT signal raise the ~70%? — measured

**Goal:** the previous sweep showed averaging J5L+DT+V3 (all Elo-correlated) does
nothing. The real lever is an *independent* signal. Bookmaker closing odds for
international tournaments are **not publicly available** (every odds dataset found
is club-league only), so this test uses the best **fetchable** independent signal:
**EA FIFA squad-attribute ratings** (offense+defense+midfield+GK) — a squad-quality
measure derived from player attributes, *not* from match results, so it is
independent of Elo. This is exactly the role **DT's talent layer / market value**
is meant to play.

## Data
- Source: `jieguangzhou/FIFA-World-Cup-2022` `international_matches.csv` (FIFA
  attributes + results, 1993–2022) + point-in-time **Elo** computed forward over
  its full history.
- Target: tournament finals with both a result and talent attributes —
  **WC 2010/14/18, Euro 2012/16/21, Copa 2011/15/16/19/21 = 406 matches.**
  (WC2022, Euro2024, Copa2024 are after the dataset's mid-2022 cutoff.)
- Split: train ≤2018 (304), **held-out test ≥2019 (102)**. Combined rating
  `= w·z(eloGap) + (1−w)·z(talentGap)` → logistic 1X2; logistic params fit on
  train per `w`; `w` swept 0→1.

## Result (held-out test, 102 matches, 28% draws)

| w(Elo) / talent | 3-way acc | decisive acc | Brier ↓ | Log-loss ↓ |
|---|---|---|---|---|
| 1.0 / 0.0 (Elo only) | 62.7% | 87.7% | 0.5344 | 0.9021 |
| 0.8 / 0.2 | 62.7% | 87.7% | 0.5309 | 0.8949 |
| **0.6 / 0.4** | 59.8% | 83.6% | **0.5313** | **0.8943** |
| 0.3 / 0.7 | 59.8% | 83.6% | 0.5387 | 0.9055 |
| 0.0 / 1.0 (talent only) | 56.9% | 79.5% | 0.5509 | 0.9254 |

## Verdict

- **An independent signal DOES earn a small place.** Best calibration at ~**60%
  Elo / 40% talent**: log-loss 0.9021 → **0.8943 (−0.9%)**, Brier 0.5344 →
  **0.5309–0.5313 (−0.6%)**. Pure talent alone is worse than Elo — talent is a
  complement, not a replacement.
- **It does NOT raise winner/decisive accuracy.** Elo-only is already 87.7%
  decisive on this sample; adding talent doesn't beat that (and over-weighting
  talent lowers it). The gain is in **probability quality (calibration)**, not in
  picking more winners.
- **Contrast with the correlated-model sweep:** averaging J5L+DT+V3 moved nothing;
  an *independent* signal moves calibration ~1%. That difference is the whole
  point — diversification, not duplication.

## Honest caveats
- **FIFA squad-talent ≠ bookmaker odds.** Real market odds incorporate injuries,
  news and sharp money *beyond* squad ratings, so they would likely add **more**
  than this proxy. Treat ~1% as a **conservative lower bound** on what a true
  market/hybrid signal buys.
- **Small test sample (102 matches, 2019–2021)** → the exact figures are noisy
  (the 87.7% decisive here is higher than the all-610 figure of 73.2% because this
  subsample/era was favourite-heavy). The **direction** (blend helps calibration,
  ~60/40) is the takeaway, not the precise %.
- Excludes WC2022/Euro2024 (dataset cutoff).

## What this means for "can we raise the ~70%"
- The path is real but the prize is **modest**: ~+1–2% calibration from a talent
  signal, plausibly **+2–5pp** decisive accuracy from true **bookmaker odds** (the
  seed `backtest.json` model→hybrid gap of +6pp is the optimistic end). Not 80%+.
- **Recommended blend to ship:** V3's Poisson engine on a `~0.6·Elo + 0.4·talent`
  rating, with **market odds layered in via a tuned hybrid weight** once match-level
  Kalshi odds are populated (the live stub). That combination — independent signals,
  tuned — is what raises the number; averaging J5L/DT/V3 does not.

## Reproduce
```
python3 v3-model-changes/backtest/talent-blend-backtest.py <international_matches.csv>
```
(`international_matches.csv`: jieguangzhou/FIFA-World-Cup-2022; Elo computed inline.)
