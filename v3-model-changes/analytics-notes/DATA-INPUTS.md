# V3 data inputs & refresh

V3 has **no cron and no runtime API**. It reads one hand-maintained file and is
run offline. This is the V3 analogue of the live app's DATA-PIPELINE.md — except
here *everything* is manual.

## `data/teams_2026.csv` — the single input (48 rows)

| Column | Type | Source | Notes |
|---|---|---|---|
| `team` | str | — | team name (the join key) |
| `group` | A–L | **official 2026 draw** | exactly 4 teams per group or the model raises |
| `elo` | float | **World Football Elo** (eloratings.net) | best single signal; weight 0.50 |
| `market_value` | float (€m) | **Transfermarkt** squad total | log-transformed; weight 0.30 — the edge over Elo-only |
| `gdp_per_capita` | float (USD) | World Bank | log-transformed; weight 0.07 (slow prior) |
| `population` | float | World Bank | log-transformed; weight 0.05 (talent pool) |
| `fifa_points` | float | FIFA ranking | weight 0.08 — intentionally demoted |
| `temperature` | float (°C) | climate avg | optional; weight 0.0 by default |
| `is_host` | 0/1 | — | 1 for USA, Mexico, Canada → +0.35 z-score |

The shipped CSV is **illustrative sample data + an illustrative draw** — replace
every value (and the `group` column) with real data before any real forecast.
Alternatively, bypass the CSV signals entirely and pass your own `ratings=` Series
(e.g. market-implied probabilities) straight to `Tournament(...)`.

## Refresh model

- **Mechanism:** manual. You edit `teams_2026.csv` (and optionally the fixed
  bracket), then run `python simulate.py`. Nothing updates it automatically.
- **Cadence:** whenever you choose to regenerate — e.g. after the official draw,
  before the tournament, and after major squad/injury news (re-pull Transfermarkt
  values + Elo).
- **Freshness tracking:** none built in. There is no `updated_at`; the CSV carries
  no timestamp. (If V3 is wired into the live app later, add one — mirror the live
  model's `meta.data_version`.)

## How the live app's data could feed V3

If/when V3 replaces the current model, the live pipeline already produces most
inputs (see the app's `analytics-notes/DATA-PIPELINE.md`):

| V3 column | Live app source (already on cron) |
|---|---|
| `elo` | `teams.json` (eloratings.net via `update_elo.py`) |
| `market_value` | `teams.json` `tmv_musd` (Transfermarkt via `update_tmv.py`) |
| `fifa_points` | `teams.json` `fifa_rank` (ESPN/FIFA) |
| `group` | `group_matchups.json` group assignments |
| `gdp_per_capita`, `population` | **not currently collected** — add a static lookup |
| `is_host` | static (USA/MEX/CAN) |

So adopting V3 mostly means writing a small adapter from `teams.json` →
`teams_2026.csv` columns, plus a one-time GDP/population lookup. The `market_value`
signal — V3's headline edge — is already refreshed by the live `update_tmv.py`
cron, so the talent layer would **not** be dormant the way DT's currently is.
