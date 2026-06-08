# Data pipeline & refresh

How every data file is sourced and kept fresh. The browser app is fully static:
`app/data-loader.js` only does `fetch('data/<file>')` against committed JSON and
version-gates on `meta.json.data_version`. All scrapers run server-side in GitHub
Actions and commit JSON back to `data/`. The only runtime external calls are
Supabase RPCs for the optional pools feature (user data, not a data feed).

## File matrix

| File | Source / API | Update mechanism | Freshness field |
|---|---|---|---|
| `meta.json` | model config + version stamp | **cron** — bumped hourly (`frequent_update`) | `data_version` (drives whole UI) |
| `teams.json` | eloratings.net, espn.com/fifarank, Transfermarkt (Mon) + `rebuild_composite.py` | **cron** — daily + hourly | via `data_version` |
| `players.json` | ESPN squad tracker (`update_squads.py`) | **cron** — daily + hourly | via `data_version` |
| `group_matchups.json` | computed by `rebuild_composite.py` | **cron** — daily/hourly/live | via `data_version` |
| `markets.json` | **Kalshi** API (`scrape_kalshi.py`) | **cron** — daily/hourly/live; re-fetched every client load | `updated_at` |
| `xg.json` | computed `compute_xg.py` (teams/matchups/form) | **cron** — daily + live | via `data_version` |
| `fatigue.json` | computed `compute_fatigue.py` (schedule+venues) | **cron** — daily | via `data_version` |
| `form.json` | ESPN site API (`scrape_form.py`) | **cron** — daily | `__meta__.updated_at` |
| `h2h.json` | football-data.org API (`scrape_h2h.py`) | **cron** — daily | `__meta__.updated_at` |
| `scorers.json` | ESPN team stats (`scrape_scorers.py`) | **cron** — live only (tournament) | stub `{}` until live |
| `referees.json` | Wikipedia officials (`scrape_referees.py`) | **cron** — daily + live + pre-kickoff | `__meta__.updated_at` |
| `match_referees.json` | Wikipedia/probes | **cron** — daily + live + pre-kickoff | stub `{}` until announced |
| `weather.json` | **Open-Meteo** API (`scrape_weather.py`, no key) | **cron** — daily + hourly | per-venue object |
| `injuries.json` | ESPN injury story (`scrape_injuries.py`) | **cron** — hourly | `__meta__.updated_at` |
| `lineups.json` | ESPN roster API (`scrape_lineups.py`) | **cron** — hourly + pre-kickoff (90-min gate) | stub `{}` until lineups drop |
| `schedule.json` / `schedule_full.json` | derived from `schedule_source.json` (fallback: mjwebmaster GitHub feed) | **cron** — daily + hourly | via `data_version` |
| `actual_results.json` | ESPN scoreboard (`scrape_live_results.py`) | **cron** — live only (every 15 min) | `last_updated` |
| `team_colors.json` | Wikipedia infoboxes + overrides (`scrape_team_colors_wiki.py`) | **cron** — daily | regenerated each run |
| **`schedule_source.json`** | canonical FIFA-PDF-derived | **MANUAL** — no scraper writes it | none |
| **`team_colors_overrides.json`** | curated by hand | **MANUAL** — merged into team_colors | none |
| **`venues.json`** | static stadium list | **MANUAL** — read-only input | none |
| **`dt_model.json`** | DT talent + title odds | **MANUAL** — generator not in repo; commit by hand | none |
| **`backtest.json`** | model backtest results | **MANUAL** — no writer; commit by hand | none |

## Cron schedules (`.github/workflows/`)
- **`daily_update.yml`** — `0 6 * * *` (06:00 UTC). Full refresh: colors, Elo,
  ESPN, TMV (Mon), squads, schedule, refs, h2h, form, weather; rebuild
  composite/fatigue/xG; Kalshi.
- **`frequent_update.yml`** — `17 * * * *` (hourly). Elo, ESPN, squads, injuries,
  schedule, Kalshi, weather, lineups; rebuild composite; **bumps `data_version`**.
- **`pre_kickoff_update.yml`** — `*/10 * * * *`, gated to kickoff ≤ 90 min.
  Lineups + referees.
- **`live_update.yml`** — `*/15 * * * *`, gated to **2026‑06‑11 … 2026‑07‑20**.
  Live results, scorers, refs; rebuild composite + xG; Kalshi.
- **`deploy.yml`** — push/PR only (CI gate: `validate_data.py` + tests). Site is on
  **Netlify** auto-CD (its header comment about GitHub Pages is stale).

## MUST UPDATE MANUALLY (no scraper, no cron)
- **`schedule_source.json`** — the canonical 104-match fixtures the schedule
  scraper translates. Edit when FIFA changes fixtures/venues/times. (Must stay
  exactly 104 matches or it falls back to the open feed.)
- **`dt_model.json`** — DT ratings/title-odds/talent. Generator `build_dt_model.py`
  not committed; run offline + commit. (Talent layer is all-zero today → pure Elo.)
- **`backtest.json`** — accuracy figures in Settings/Backtest. No writer exists
  (`build_backtest.py` referenced but missing). Currently seed estimates.
- **`venues.json`** — stadium directory (id, coords, name). Feeds weather/fatigue/
  schedule.
- **`team_colors_overrides.json`** — curated kit-color fixes, merged on top of the
  Wikipedia scrape.

## Freshness caveat
`frequent_update.yml` bumps `meta.data_version` **hourly**, so the home "Data
updated Xm ago" stamp (max of `data_version`, `markets.updated_at`,
`actual_results.last_updated`) moves every hour **even if a file's real content is
stale**. The 5 manual files carry **no own timestamp**, so the visible stamp is
*not* a reliable indicator that they were refreshed.
