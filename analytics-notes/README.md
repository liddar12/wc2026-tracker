# Analytics Notes — WC2026 Tracker

Everything behind the numbers: what data each model/analytic uses, the exact
equations and weights, where the data comes from, how often it refreshes, and
**what you must update by hand**. Written so you can see how to improve the data
and stand up real backtesting.

> **One big idea first:** the app is a **static PWA**. *No model math runs in the
> browser* and *no third-party data API is called at runtime.* Every model is
> precomputed into `data/*.json` by Python/Node scripts in **GitHub Actions
> cron**, committed to git, and the browser just fetches the JSON and version-gates
> on `data/meta.json`'s `data_version`. The only runtime network calls are
> Supabase RPCs for the optional pools/bracket-share feature (user data, not a
> data feed). Exception: one analytic computes in the browser — referee bias
> (`app/ref-bias.js`).

## Documents

| File | What's in it |
|---|---|
| [PREDICTION-MODELS.md](PREDICTION-MODELS.md) | J5L composite, DT model, Kalshi market, Winner/champion odds — inputs, equations, weights, refresh |
| [MATCH-ANALYTICS-PANELS.md](MATCH-ANALYTICS-PANELS.md) | The 12 match-detail panels (xG, form, h2h, scorers, referee, weather, fatigue, injuries, upsets, divergence) |
| [GOLDEN-BOOT.md](GOLDEN-BOOT.md) | Golden Boot top-scorer model — factors, weights, Monte-Carlo, backtest scaffold |
| [DATA-PIPELINE.md](DATA-PIPELINE.md) | Per-file source/refresh matrix, cron schedules, freshness tracking |
| [IMPROVEMENTS-AND-BACKTESTING.md](IMPROVEMENTS-AND-BACKTESTING.md) | Prioritized list to improve accuracy + how to build a real backtest |

## ⚠️ MUST UPDATE MANUALLY (no scraper, no cron)

These files have **no script and no cron** writing them — you edit/commit them by
hand. Nothing warns you when they go stale (they carry no own timestamp, and the
home "Data updated" stamp moves hourly regardless — see DATA-PIPELINE.md):

1. **`data/schedule_source.json`** — canonical FIFA-derived fixtures (104 matches).
   The *primary input* `scrape_schedule.py` translates into `schedule.json` /
   `schedule_full.json`. Edit when FIFA changes fixtures/venues/kickoff times.
   (Scraper requires exactly 104 matches or it falls back to an open GitHub feed.)
2. **`data/dt_model.json`** — DT-model ratings + title odds + player talent. Its
   generator (`build_dt_model.py`) is **not in the repo**; per `docs/HOW-TO-PROCEED.md`
   you run it offline and commit the JSON. **Today the talent layer is all zeros —
   the DT model is pure Elo** until you scrape the FBref features and regenerate.
3. **`data/backtest.json`** — the accuracy figures shown in Settings/Backtest.
   `golden-boot-backtest.mjs` only prints; `scripts/build_backtest.py` (referenced
   in the UI) **does not exist**. The numbers are seed estimates (`is_estimate:true`),
   not fitted. Commit real results by hand once you build the harness.
4. **`data/venues.json`** — stadium directory (id, coords, name). Read-only input to
   weather/fatigue/schedule. Edit by hand if venue data changes.
5. **`data/team_colors_overrides.json`** — curated kit-color corrections; merged on
   top of the Wikipedia scrape (curated wins). Hand-edited.

## Cron jobs (GitHub Actions — automated)

| Workflow | Schedule | Updates |
|---|---|---|
| `daily_update.yml` | `0 6 * * *` (06:00 UTC) | team colors, Elo, ESPN rank, TMV (Mon), squads, schedule, refs, h2h, form, weather; rebuild composite/fatigue/xG; Kalshi |
| `frequent_update.yml` | `17 * * * *` (hourly) | Elo, ESPN, squads, injuries, schedule, Kalshi, weather, lineups; rebuild composite; **bumps `meta.data_version`** |
| `pre_kickoff_update.yml` | `*/10 * * * *` (gated: kickoff ≤90 min) | lineups + referees |
| `live_update.yml` | `*/15 * * * *` (gated: 2026‑06‑11 … 07‑20) | live results, scorers, refs; rebuild composite + xG; Kalshi |
| `deploy.yml` | push/PR only (not scheduled) | CI: `validate_data.py` + tests |

## Highest-leverage findings (see IMPROVEMENTS doc)

1. **DT model is dormant Elo** — all talent/coaching components are `0`; rating is
   just scaled Elo. Wiring the FBref talent layer is the biggest single win, and
   `dt_model.json` is the only model not on a cron.
2. **Kalshi per-match odds ship empty** — the scraper's `match_outcomes` mapper is
   a stub, so model-vs-market divergence + the hybrid pick silently fall back to
   *tournament-winner* odds for individual matches.
3. **No real backtest exists** — `build_backtest.py` is referenced but missing;
   the accuracy claims (J5L top-8 75%, etc.) are unverified seed numbers.
4. **Golden Boot heuristics are untuned** — the +0.12 penalty-taker bonus is a
   guess; knockout opponents, minutes/injuries, and a market anchor are unused.
5. **A weighting discrepancy:** the composite uses additive `boosts.*`, ignoring
   `meta.json`'s `cont_mult`/`host_mult` — reconcile before trusting backtests.

*Generated from a code-level audit of the repo. File:line references throughout.*
