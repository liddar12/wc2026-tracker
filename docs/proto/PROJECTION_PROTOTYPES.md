# Projection prototypes — talent/coach backfill, extended composite, GBM, ML stacker

**Status:** prototype (branch only, nothing wired into production). All code under
`scripts/proto/`, all outputs under `data/proto/`. Run order:

```bash
python3 scripts/proto/backfill_talent_coach.py     # -> data/proto/talent_coach.json
python3 scripts/proto/stack_models.py              # -> data/proto/stacker_report.json
python3 scripts/proto/run_prototypes.py            # -> data/proto/prototype_report.json  (A + B)
python3 scripts/proto/ranking_eval.py              # -> data/proto/ranking_report.json
```

Everything is evaluated **leak-safe** on the 2026 matches actually played
(as of the QFs: 72 group + 24 knockout = 96 FINAL matches, status-gated). Elo and
form are replayed **as-of each kickoff**; composite/stacker weights are fit only
on training folds (`TimeSeriesSplit(5)` OOF or LOO). No fit-then-report-the-same-games.

---

## TL;DR

| Question | Answer |
|---|---|
| Backfill the dormant player-talent + coaching data? | **Done** — but it was already on disk (`players.json`, `position_ratings`, `coach.experience`). The prototype derives a best-XI **talent** signal + a **coach pedigree** signal and scales them into new sub-ratings. |
| (A) Add talent+coach to the J5L composite? | **No measurable gain.** Talent correlates 0.81 with TMV (already the dominant input); the optimizer hands the new features ~0.04 weight and log-loss does not improve. |
| (B) GBM match model instead of the Poisson composite? | **Worse** at this sample size (n=96): OOF acc 0.54 vs 0.73 for the composite. Trees overfit; the calibrated bivariate-Poisson wins. |
| Combine DT + J5L (+market) with ML? | **Logistic stacker helps modestly** — group log-loss 0.844 → **0.821** (~3%). GBM stacker overfits (1.03). No accuracy gain. |
| Projected-winners ranking near 90%? | **Already there for the elite tier** — the Hybrid champion-odds top-8 = the actual QF-8 exactly (**precision@8 = 1.00**). |
| Knockout per-match accuracy near 90%? | Currently **~79% (19/24)**. At n=24 the gap to 90% is within noise; no variant reliably beats it. |

**Headline:** the existing statistical stack is already well-tuned. Classic ML and
the talent/coach backfill do **not** beat it on 2026 data, mostly because (a) the
in-tournament sample is tiny and (b) the new features are redundant with TMV/Elo.
The one genuine, shippable ML win is a **logistic stacker** for the model blend.

---

## Backfill (deep dive): what was actually missing

The "dormant player-talent + coaching layer" is **not** missing raw data:

- `players.json` — ~500 players, all 48 teams, with `overall`/position/pace/
  defense/offense/scoring.
- `teams.json` — every team already carries `position_ratings` (gk/def/mid/fwd)
  and a `coach` block (`name`, `nationality`, `experience` 50–99).

What was missing is that **none of it is wired into any model.** FBref (the
source the DT README waits on) is robots-blocked here (HTTP 403); Transfermarkt
and Wikipedia are reachable (200). So `backfill_talent_coach.py`:

1. Derives a **best-XI talent** score per team from `players.json` (top GK / 4 DEF
   / 3 MID / 3 FWD spine + star power + depth), 0–100.
2. Builds a **coach pedigree** score from `coach.experience`, with an optional
   `--enrich-wiki` pass that blends in a Wikipedia honors/tenure signal (60/40,
   offline-safe fallback).
3. Scales both onto the `elo_scale` sub-rating range so they are drop-in
   composite inputs.

Sanity: talent top-5 = France, Spain, England, Germany, Portugal.
`corr(talent, TMV)=0.81`, `corr(talent, Elo)=0.81`, `corr(coach, Elo)=0.59`.
The 0.81 talent↔TMV correlation is exactly why (A) below doesn't add signal.

---

## (A) Extended composite — `run_prototypes.py`

Out-of-fold, `TimeSeriesSplit(5)`, 80 evaluated matches (incl. 24 KO):

| Variant | ALL acc | ALL logloss | KO acc | KO logloss |
|---|---|---|---|---|
| J5L (current prod weights) | 0.725 | 0.775 | 0.792 | 0.718 |
| A · 5-feat re-tuned | **0.738** | 0.776 | 0.792 | **0.699** |
| A · 7-feat (+talent+coach) | 0.738 | 0.778 | 0.792 | 0.709 |
| B · GBM | 0.538 | 0.936 | 0.667 | 0.819 |

Tuned 7-feat weights: `tmv 0.43, elo 0.25, qual 0.16, mine 0.05, coach 0.05,
talent 0.04, form 0.03`. The new features are effectively inert. **Re-tuning the
existing 5 weights** gives the only small win (KO log-loss 0.718 → 0.699).

## (B) GBM match model

`HistGradientBoostingClassifier` on the a−b feature diffs. Consistently worse than
the composite+Poisson (above). 96 matches × 8 features is far too little for a tree
ensemble to beat a well-calibrated parametric model. Not recommended at this scale.

## Stacker (DT + J5L + market with ML) — `stack_models.py`

LOO on the 72 locked pre-kickoff prediction vectors:

| Blend | acc | brier | logloss |
|---|---|---|---|
| **stacker · logistic** | 0.653 | 0.498 | **0.821** |
| solo market | **0.667** | **0.490** | 0.833 |
| current hybrid weights | 0.639 | 0.491 | 0.844 |
| equal-thirds | 0.639 | 0.492 | 0.845 |
| stacker · GBM | 0.611 | 0.583 | 1.032 |

The learned logistic blend is the best-calibrated option and beats the production
hybrid by ~3% log-loss — a real but modest win. GBM overfits.

## Ranking / projected winners — `ranking_eval.py`

Model strength ordering vs actual rounds-survived (48 teams):

| Model | Spearman | precision@8 | precision@16 |
|---|---|---|---|
| J5L composite | 0.712 | 0.625 | 0.688 |
| DT rating | 0.673 | 0.500 | 0.625 |
| **Hybrid champion-odds** | 0.629 | **1.000** | 0.688 |
| J5L +talent+coach | 0.711 | 0.625 | 0.688 |

Hybrid's top-8 champion odds (France, Spain, England, Argentina, Norway, Morocco,
Belgium, Switzerland) **is** the actual QF-8. The projected-winner ranking already
meets the 90% aspiration for the elite tier; talent+coach do not move it.

---

## Recommendation

1. **Ship the logistic stacker** as an optional blend source (the only measured
   win). Keep it behind the existing model-picker; it does not disturb the other
   models.
2. **Do not** wire talent+coach into the composite — redundant with TMV; keep the
   backfill as a data asset / matchup-detail enrichment instead.
3. **Do not** replace the Poisson composite with a GBM at this sample size.
4. Adopt the **5-weight re-tune** only through the existing never-regress optimizer
   (`optimize_weights.py`), not by hand.

Whether to escalate to an LLM layer or an LLM+ML combo (per the original ask) is a
judgment call — the ML alone moved the needle only marginally. See the PR thread.
