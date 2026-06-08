# Improving the data + building real backtesting

Prioritized from the code audit. Each item names the file(s) to touch.

## A. Make the models honest (do these first)

1. **Build a real backtest harness** — *the prerequisite for trusting anything.*
   - `data/backtest.json` is seed data (`__meta__.is_estimate: true`); the
     `scripts/build_backtest.py` the UI references **does not exist**.
   - For match models: assemble historical pre-match inputs (composite components,
     Elo, market odds) + actual results for WC2022, Euro2024 (and more), run the
     same equations, and score: accuracy, Brier, log-loss, calibration.
   - For Golden Boot: `scripts/golden-boot-backtest.mjs` already has the metric
     engine + data contract (`historical/<tournament>/{inputs,actuals}.json`).
     Just source the 7 tournaments (WC14/18/22, Euro16/20/24, Copa21/24) and drop
     them in. Then tune `GB_CONFIG` against the results instead of guessing.

2. **Reconcile the composite weighting discrepancy** — `rebuild_composite.py` adds
   per-team `boosts.continental/host` directly and **ignores** `meta.json`'s
   `cont_mult 1.5` / `host_mult 0.5`. Pick one source of truth before backtesting,
   or the backtest tunes a formula the app doesn't run.

3. **Wake up the DT model** — every `components.{attack,midfield,defense,gk,coach,
   talent_z}` is `0`, so DT rating is just scaled Elo (`alpha_elo 0.55` blends Elo
   with a zero talent layer). Scrape FBref features, regenerate `dt_model.json`
   (its `build_dt_model.py` generator is offline/not committed), commit. **This is
   the single highest-leverage change** — and the only model not on a cron.

## B. Fill the empty/stub feeds

4. **Kalshi per-match odds** — `scrape_kalshi.py`'s `fetch_match_outcomes()` is a
   stub, so `markets.json.match_outcomes` ships empty and the model-vs-market
   divergence + hybrid pick silently fall back to *tournament-winner* odds for
   individual matches. Map the per-match Kalshi contracts to fill it.

5. **Fix the hybrid scale mismatch** — bracket autofill computes
   `0.5·composite + 0.5·kalshi_prob_pct`, adding a 0–100 *strength* score to a
   0–100 *probability* (`bracket-autofill.js`). Normalize both to the same scale
   (e.g. convert composite→win prob first) so the blend is meaningful.

6. **Generate `upset_risk.indicators`** — these badges are **hand-seeded** into
   `group_matchups.json`; no script writes them (`rebuild_composite.py` only keeps
   `favored/underdog/gap`). Add a rule-based generator (close gap, poor favorite
   form, h2h history, fatigue) so upsets update automatically.

## C. Golden Boot accuracy (after the backtest exists)

7. Real **penalty/set-piece taker** data to replace the `+0.12` "highest-scoring
   attacker" heuristic.
8. **Knockout opponent projection** — `oppDefFactor` only averages the 3 group
   opponents; boot winners reach the SF/Final. Add probability-weighted
   knockout-path opponent defenses.
9. **Wire minutes/availability** — `injuries.json` + `lineups.json` are loaded but
   unused; a rotated/injured starter is projected at full strength.
10. **Knockout-stage xG** — `xg.json` is group-only (73 matchups); deep-run
    projected matches fall back to `leagueXg 2.6`.

## D. Data-freshness hygiene

11. Give the 5 **manual files** an own `updated_at` and surface it, so a stale
    `schedule_source`/`dt_model`/`backtest`/`venues`/`team_colors_overrides`
    doesn't hide behind the hourly `data_version` bump.
12. Add a CI check that fails if `dt_model.json`/`backtest.json` are older than N
    days during the tournament, so dormant manual data is caught.

## What's already solid
- The static-JSON + cron architecture is clean and cheap (no runtime API cost, no
  keys in the client). Live scores propagate cron(15m) → poller(30s) → re-render.
- The J5L composite + logistic W/D/L is a reasonable, transparent baseline; once
  backtested it's a defensible model.
- Graceful empty-states everywhere (form/h2h/scorers/weather/refs/injuries) so the
  pre-tournament app degrades cleanly.
