# World Cup 2026 Forecasting Model (`wc2026`)

A Python model for forecasting the 2026 FIFA World Cup, built to improve on
Joachim Klement's well-known "economist's formula." It keeps what works about
his approach — a strength rating plus a full Monte Carlo of the bracket — and
fixes the weak parts: it leads with Elo and squad market value instead of FIFA
ranking, and it scores itself with proper metrics instead of "did I pick the
champion."

## What it does

Four layers, each in its own module so you can swap any one out:

| Module | Job |
|---|---|
| `wc2026/ratings.py` | Blend Elo + market value + GDP + population + host bonus into one strength score per team. |
| `wc2026/match_model.py` | Turn two strengths into expected goals, then a **bivariate Poisson** scoreline (mild correlation, realistic draws). |
| `wc2026/tournament.py` | Monte Carlo the real **48-team / 12-group** format: groups → best-thirds → R32 → R16 → QF → SF → Final. Vectorised over all sims. |
| `wc2026/evaluation.py` | Score the match model with **Brier / log-loss**, with a de-vigged bookmaker baseline to beat. |

## Quick start

```bash
pip install -r requirements.txt
python simulate.py                       # 20k sims, prints top 15 title odds
python simulate.py --sims 50000 --top 24 --out results.csv
python tests/test_smoke.py               # sanity checks
```

Example output (30k sims, illustrative sample data):

```
         team  rating  P(R32)  P(R16)  P(QF)  P(SF)  P(Final)  P(Champion)
       France    2.10    99.9    88.9   69.3   48.5      31.4         19.4
    Argentina    2.00    99.9    88.2   69.0   49.3      31.5         17.9
      England    1.82    99.9    87.2   72.0   51.4      28.7         15.2
        Spain    1.87    99.9    87.0   69.0   47.3      25.7         14.3
       Brazil    1.60    99.7    85.1   67.6   31.9      17.3          8.6
  ...
```

30k simulations run in ~1.4 seconds.

## Using it as a library

```python
from wc2026 import Tournament, TournamentConfig, RatingConfig, MatchConfig, load_teams

teams = load_teams("data/teams_2026.csv")
t = Tournament(
    teams,
    rating_config=RatingConfig(w_elo=0.55, w_market=0.30, w_fifa=0.05),
    match_config=MatchConfig(mu=0.30, beta=0.75),
)
result = t.run(TournamentConfig(n_sims=50000, seed=7))
print(result.table().head(20))
```

## Plugging in real data

Everything is data-driven. The sample `data/teams_2026.csv` ships with
**illustrative numbers and an illustrative group draw** — replace them:

1. **Ratings** — update `elo`, `market_value`, `gdp_per_capita`, `population`,
   `fifa_points`, `is_host`. Elo: World Football Elo (eloratings.net). Market
   value: Transfermarkt squad totals. Or skip the CSV signals entirely and pass
   your own `ratings=` Series (e.g., market-implied probabilities) to
   `Tournament(...)`.
2. **Group draw** — set the `group` column (A–L, 4 teams each) to the official
   2026 draw.
3. **Knockout bracket** — default `bracket="reseed"` seeds the 32 qualifiers
   1..32 by strength into a balanced bracket. This makes champion odds
   meaningful but is *not* the exact official R32 slotting (which depends on
   which third-placed teams qualify). To reproduce the official path for a
   specific team, extend `Tournament._seed_into_bracket` with the published
   slot map.

## Tuning and validation (don't skip this)

Klement reports only the champion; you should report calibrated probabilities.

1. Collect recent international results (group + knockout) for 2014/2018/2022.
2. For each match, get `model.outcome_probs(home_id, away_id)`.
3. Score with `evaluation.multiclass_brier` / `multiclass_log_loss`.
4. Compare against `evaluation.baseline_bookmaker(odds)` and a pure-Elo variant.
5. Grid-search `beta`, `mu`, and the rating weights to minimise log-loss.

If you can't beat the bookmaker baseline, the extra variables aren't earning
their place — that's the honest test Klement's "3-in-a-row" headline hides.

## Model parameters worth knowing

- `MatchConfig.mu` — log baseline goals per team (`exp(0.30) ≈ 1.35`).
- `MatchConfig.beta` — how strongly a rating edge becomes goal supremacy.
- `MatchConfig.lambda3` — bivariate-Poisson shared component (score correlation).
- `RatingConfig.w_*` — signal weights (applied to standardised inputs).
- `RatingConfig.host_bonus` — z-score bump for USA / Mexico / Canada.

## Layout

```
worldcup2026/
├── simulate.py            # CLI
├── requirements.txt
├── README.md
├── data/
│   └── teams_2026.csv     # illustrative — replace with real data + draw
├── wc2026/
│   ├── __init__.py
│   ├── ratings.py
│   ├── match_model.py
│   ├── tournament.py
│   └── evaluation.py
└── tests/
    └── test_smoke.py
```

## Lineage / credit

The systemic variables (GDP per capita, population, host advantage) and the
"~50% of any match is luck" framing come from Joachim Klement's World Cup notes
and the academic tournament-forecasting literature (Groll et al.; bivariate
Poisson + Monte Carlo). This implementation demotes FIFA ranking in favour of
Elo and market value and adds explicit evaluation.

*Sample data is for testing the pipeline only and should not be used for real
forecasts or betting.*
