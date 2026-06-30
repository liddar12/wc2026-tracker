# RJ30 — Design / Architecture / iOS-UX Integrity + Build Partition

Confirms the 12 items integrate into the settled architecture **without breaking it**, defines the
**disjoint-ownership build partition**, and records iOS-UX checks + deploy-time manual handoffs.

## Architecture integration (no breaks)
The architecture is unchanged — every item slots into an existing layer:

| New piece | Layer | Integration | Break risk |
|---|---|---|---|
| `scrape_polymarket_odds.py` → `data/polymarket_odds.json` | Pipeline → JSON | New scraper + cron step; loaded by SPA; **own source string** (no validate_data collision) | None |
| `derive_scorers.py` → `scorers.json` (same shape) | Pipeline → JSON | Replaces dark `scrape_scorers.py`; consumer wiring unchanged | None |
| `scrape_weather.py` fix, `compute_form_recent.py` | Pipeline → JSON | Batched Open-Meteo; results-derived form; revive composite `form` weight | Low (model term currently inert) |
| `refresh_players.py` | Pipeline → JSON | Active-squad refresh, **base ratings preserved** (awards z-score safe) | Low |
| Push: SW handlers, `app/push.js`, `settings-push-card`, `netlify/functions/push-notify.mjs`, Supabase `push_subscriptions` | SW + Netlify fn + Supabase | **No SW fetch handler** (no-offline contract intact); scheduled fn reads ESPN direct; migration **applied at deploy w/ OK** | Med — isolated to new files |
| Win-prob, standings, model-accuracy, status views/components | SPA | New routes + new modules; shared wiring done by the integrator only | Low |
| `build_pipeline_status.py` → `pipeline_status.json` + `/status` | Pipeline + SPA | Additive `validate_data.py --json-report` | None |

**Deploy is unchanged:** push to main → Netlify. Two additions at deploy: (1) Supabase migration apply (your OK), (2) Netlify env vars `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (manual handoff — generated free).

## Build partition (disjoint file ownership)

### Wave 1 — feature epics (parallel, TDD, NO git, NONE touch the shared wiring files)
- **A (odds+scorers):** `scrape_polymarket_odds.py`*, `derive_scorers.py`*, `app/markets.js`, `app/components/parlay.js`, `app/components/market-odds.js`, `app/components/model-market-divergence.js`; delete `scrape_scorers.py`.
- **B (push):** `supabase/migrations/…push_subscriptions.sql`* (NOT applied), `app/push.js`*, `app/lib/pwa-install.js`*, `app/views/settings-push-card.js`*, `netlify/functions/push-notify.mjs`* + `_lib/*`*, `sw.js`, `app/install-prompt.js`, `app/views/settings-view.js`, `app/lib/version-purge.js`, `scripts/write-runtime-config.mjs`.
- **C (weather+form):** `scripts/scrape_weather.py`, `app/components/weather.js`, `scripts/compute_form_recent.py`*, `scripts/rebuild_composite.py`, unwire `scripts/scrape_form.py`.
- **D (winprob+standings):** `app/lib/win-prob.js`*, `app/components/win-probability.js`*, `app/views/matchup-detail.js`, `app/lib/standings.js`*, `app/views/standings-view.js`*, `app/views/group-view.js`.
- **E (squads+bugs):** `scripts/refresh_players.py`*, `scripts/check_staleness.py`, `scripts/scrape_live_results.py`, `live-api/api/live.js` (comment), `app/views/schedule-view.js` (delete dead fns), `app/components/large-match-card.js` (eyebrow `(x–y)`).
- **F (refs+accuracy+obs):** `scripts/scrape_referees.py`, `app/components/referee.js`, `app/ref-bias.js`, `app/views/model-accuracy-view.js`*, `app/views/status-view.js`*, `scripts/build_pipeline_status.py`*.

(*= new file. Verified disjoint: no two Wave-1 epics share a file. `settings-view.js`→B only; `large-match-card.js`→E only; `matchup-detail.js`→D only.)

### Wave 2 — integrator (solo, after Wave 1): the shared wiring files
`app/main.js` (routes/titles/back-lists for standings, model-accuracy, status) · `app/data-loader.js` (load `polymarket_odds.json`/`pipeline_status.json` + no-cache list) · `scripts/validate_data.py` (polymarket coverage, weather/form freshness, `--json-report`, refs directory) · `.github/workflows/{frequent,live,pre_kickoff,daily}_update.yml` (wire the 5 new scripts + push-notify schedule) · `app/views/settings-view.js` status link. Then regenerate data + run the gate.

## iOS-UX integrity (390px, installed PWA)
- **Standings** (8 cols): `tabular-nums`, compact headers, `scrollWidth ≤ 390` assertion; condense GF/GA only if overflow.
- **Win-prob**: clamped (0,1) so the sparkline never flatlines; respects reduced-motion; live-refresh re-render must not scroll-jump (existing `pendingLiveRefresh`).
- **Push card**: install-gated — non-standalone iOS shows an "Add to Home Screen" hint, never a dead button; `requestPermission` only on tap (gesture); payloads <4KB; every push shows a notification.
- **Accuracy / status grids**: `scrollWidth ≤ 390` asserted; reuse `.home-card`/`sev-*` chips; stack on narrow.
- **All**: no new design tokens; reuse existing components; safe-area container preserved; **no regression to existing views** (full Playwright suite re-run).

## Deploy-time manual handoffs (I'll give copy-paste steps)
1. Apply the `push_subscriptions` Supabase migration (you confirm the SQL).
2. Set Netlify env `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (generated free) + `SUPABASE_SERVICE_ROLE` for the sender.
