# RJ30-C — Pipeline fixes: Weather (RJ30-4) + Results-derived Form (RJ30-8)

Senior product + QA plan for two zero-cost pipeline fixes. Both are **data-pipeline / Python-side** items that surface in the existing matchup-detail UI; neither introduces new UI surfaces, paid sources, or schema redesigns. Free source: **Open-Meteo** (`api.open-meteo.com`, no key, no auth) for weather; **existing `data/actual_results.json`** for form (pure code, no network).

Grounding (files read):
- `scripts/scrape_weather.py`, `data/weather.json`, `data/venues.json`, `data/schedule_full.json`, `app/components/weather.js`, `app/views/matchup-detail.js:208`
- `scripts/scrape_form.py` (dark), `scripts/compute_form.py` (`form_scaled`), `data/form.json` (empty), `data/actual_results.json`, `scripts/rebuild_composite.py:24-43`, `scripts/compute_xg.py` (`form_points`, lines 79-127), `app/components/form.js`, `app/data-loader.js:40`
- `scripts/_common.py` (`polite_get`: 5 s/host throttle, robots check, raises on ≥400), `data/meta.json` (`model_weights.form = 0.0037`), `.github/workflows/daily_update.yml`, `frequent_update.yml`, `live_update.yml`, `scripts/validate_data.py:685-687`

---

## Diagnosis (why each is broken today)

### RJ30-4 weather under-population — root cause is RUNTIME RESILIENCE + a TZ bug, NOT missing inputs
The inputs are complete: `data/venues.json` has **16 venues, all with `lat`/`lon`** (zero missing); `data/schedule_full.json` has **104 rows, all with `venue_id` + `kickoff_utc`**; **27 venue-day pairs** fall inside Open-Meteo's `[today, today+15]` window. Yet `data/weather.json` has **exactly 1 populated venue** (`azteca/2026-06-18`); every other venue key is `{}`.

The current scraper (`scripts/scrape_weather.py`) makes **one HTTP request per (venue, date)** with `start_date=date&end_date=date`. With `_common.polite_get` enforcing `MIN_INTERVAL = 5.0` s **per host** plus a per-host `robots.txt` fetch, 27 single-day calls take ≥135 s of forced sleeps, all to the **same host**. Any single non-200 (`ScrapeError`) is caught and `continue`s — but the broader symptom (one venue-day succeeded, then nothing) is consistent with the job hitting a **timeout / cancellation** partway, or Open-Meteo soft-rate-limiting the burst. Because the script only writes once at the very end (`save("weather.json", out)`), a mid-run kill loses everything except… nothing — so the single populated cell is from an earlier partial run that did finish.

Two concrete defects to fix:
1. **N calls instead of 1 per venue.** Open-Meteo accepts a **date range** (`start_date`…`end_date`) and returns a `daily` array for every day in between. We can fetch **all needed dates for a venue in ONE request** (16 requests total, not 27+), collapsing wall-clock and the rate-limit surface dramatically. Open-Meteo also supports **batched coordinates** (comma-joined `latitude`/`longitude`) returning an array of results — optional further collapse to ~1 request.
2. **Timezone bug.** The scraper dates each forecast by `kickoff_utc.split("T")[0]` and passes `&timezone=UTC`. For a 2026-07-02T00:00Z kickoff at a US venue, the **local match day is July 1**, but we'd fetch July 2's forecast. `schedule_full.json` already carries `kickoff_local_venue` (e.g. `2026-06-11T13:00:00-06:00`) and `venue_timezone`. The forecast key + the Open-Meteo `&timezone=` param should both use the **venue-local date**, so the UI shows the forecast for the actual match day. **The UI must read the same key** — see RJ30-4 task 4.

### RJ30-8 form is fully dark — retire the flaky scraper, derive from results
`data/form.json` contains **only `__meta__`** (0 teams). `scripts/scrape_form.py` depends on ESPN's `fifa.world/teams?search=` lookup + `/schedule` endpoints, documented in its own docstring as "4xxs at random… undocumented shape." It has produced nothing. Meanwhile `data/actual_results.json` is **rich**: `group_stage` = 72 scored, `round_of_32` = 13 scored, with full records `{score_a, score_b, kickoff_utc, status, winner?, shootout_a?, shootout_b?}` and statuses `STATUS_FULL_TIME`, `STATUS_FINAL_PEN`, `STATUS_SCHEDULED`.

Two **distinct** "form" concepts (do not conflate):
- **`compute_form.py` → `teams.json.sub_ratings.form_scaled`** — an Elo-residual z-scored signal fed into the composite. `rebuild_composite.py:27` already multiplies `weights.get("form",0) * form_scaled`, and `meta.json.model_weights.form = 0.0037` (≈0, optimizer-tunable). This already works off `actual_results.json` and is leak-safe. **We keep it.**
- **`form.json` → last-5 W/D/L arrays per team** — consumed by (a) `app/components/form.js` (the "Recent form (last 5)" pills in matchup detail) and (b) `scripts/compute_xg.py form_points()` (a per-90 xG bump, `FORM_NEUTRAL=7.5`, `FORM_COEF=0.04`). This is the **dark** file. The fix: a **new `scripts/compute_form_recent.py`** that rebuilds `form.json` from `actual_results.json` in the **exact shape `form.js` + `compute_xg.form_points` already expect** (`{TeamName: [{date, opponent, score_a, score_b, result}, …]}`), and **retire `scrape_form.py`** from the crons.

The "revive composite 'form' weight (~0 now)" sub-goal: `form: 0.0037` is the **optimizer's** current best estimate and is principled (leak-safe walk-forward CV in `optimize_weights.py`). We must **NOT hand-jam it to a bigger number** — that would overfit. Instead we (a) ensure `compute_form.py` runs and produces non-neutral `form_scaled` (it does, once group games exist — verified 85 FINAL games available), and (b) make the weight **floor** a small non-zero minimum so the term is never *exactly* inert, leaving the magnitude to the optimizer. This is an **OPEN QUESTION** (see below) — recommendation is a tiny floor, not a forced bump.

---

## RJ30-4 — Weather: populate forecast for ALL upcoming fixtures

### User stories
- **US-4.1** — As a fan opening a matchup within ~2 weeks of kickoff, I want to see the venue's forecast for the **match day**, so that I can gauge conditions (heat, rain, wind) that affect play.
- **US-4.2** — As the data pipeline, I want one batched Open-Meteo call per venue (not per date), so that the job finishes fast and stays under Open-Meteo's free fair-use without losing data to mid-run timeouts.
- **US-4.3** — As a user opening a matchup >15 days out, I want a clear "forecast not yet available" message rather than a broken/empty card (already handled by `weather.js`; must not regress).

### Acceptance criteria (Given/When/Then)
- **AC-4.1** — *Given* `venues.json` (16 venues w/ lat/lon) and `schedule_full.json`, *When* `scrape_weather.py` runs on a day with ≥1 fixture inside `[today, today+15]`, *Then* `weather.json` has a populated `{date: {...}}` block for **every** venue that hosts a fixture in that window (not just 1).
- **AC-4.2** — *Given* a venue hosting 3 fixtures on 3 different in-window dates, *When* the scraper runs, *Then* it makes **exactly one** Open-Meteo HTTP request for that venue (date-range), and `weather.json[venue]` has all 3 date keys.
- **AC-4.3** — *Given* a kickoff at `2026-07-02T00:00:00Z` whose `kickoff_local_venue` is `2026-07-01T…`, *When* the scraper keys the forecast, *Then* the key is the **venue-local** date `2026-07-01`, and `weather.js` reads the same venue-local date so the card renders.
- **AC-4.4** — *Given* a fixture >15 days out, *When* the scraper runs, *Then* no request is made for it and `weather.js` shows "Forecast not yet available".
- **AC-4.5** — *Given* Open-Meteo returns 429/5xx for one venue, *When* the scraper runs, *Then* that venue is skipped (logged) but **all other venues still populate** (no whole-run abort), and existing good cells are preserved.
- **AC-4.6** — *Given* the scraper produced data, *When* `validate_data.py` runs, *Then* `weather.json` passes `check_dict_or_empty` (shape preserved) and a **new coverage assertion** that ≥80% of in-window venue-days are populated (warn-only, non-blocking).

### Tasks (exact files/functions/data flow)
1. **`scripts/scrape_weather.py`** — rewrite the request loop:
   - Build `needed: dict[venue_id, set[date]]` from `schedule_full.json`, but date each fixture by **`kickoff_local_venue`** (`row["kickoff_local_venue"].split("T")[0]`) with fallback to `kickoff_utc` if the local field is absent. Keep the `[today, today+15]` filter (today = `datetime.now(timezone.utc).date()`; compare against the venue-local date string).
   - For each venue with ≥1 in-window needed date **not already cached**, issue **one** request with `start_date=min(dates)&end_date=max(dates)` and `&timezone={venue.timezone}` (venue-local days; falls back to `UTC` if missing). Endpoint unchanged: `https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&daily=temperature_2m_max,relative_humidity_2m_max,wind_speed_10m_max,weathercode&start_date=…&end_date=…&timezone=…`.
   - Open-Meteo returns parallel arrays `daily.time[]`, `daily.temperature_2m_max[]`, etc. **Index by `daily.time`** (map each returned `YYYY-MM-DD` → its row), then write only the **needed** dates into `out[venue][date]` with the existing cell shape `{temp_c, condition_code, humidity_pct, wind_kph}` (wind still `round(m/s * 3.6, 1)`).
   - Keep idempotency (`if date in block: continue` — but now check *after* fetching the range so we backfill any newly-needed date) and the `__meta__.updated_at` bump only when `refreshed > 0` (mirror `compute_form.py`'s no-op guard to not defeat the staleness watchdog).
   - Wrap the per-venue fetch in try/except `(ScrapeError, ValueError)` → `log()` + `continue` (AC-4.5).
2. **`scripts/scrape_weather.py`** — add `--selftest` (no network): given a fixture `daily` payload + a `needed` map, assert the date-range collapse and TZ-keying produce the expected `out` (mirrors the apifootball selftest convention).
3. **`scripts/validate_data.py`** — add a **warn-only** `check_weather_coverage()`: compute in-window venue-days from `schedule_full.json` + `venues.json`; if populated-fraction < 0.8, append to `self.warnings` (never `self.errors`). Call it alongside the existing `check_dict_or_empty("weather.json")` (line 687).
4. **`app/components/weather.js`** — change the date key from `row.kickoff_utc.slice(0,10)` to the **venue-local** date: `(row.kickoff_local_venue || row.kickoff_utc).slice(0,10)`. This keeps UI + scraper keyed identically (AC-4.3). No other UI change; the ">15 days" empty state stays.
5. **Workflows** — no new steps; `scrape_weather.py` already runs in `daily_update.yml:94` and `frequent_update.yml:101` under `continue-on-error: true`. (Frequent cron gives ~hourly refreshes inside the window.) Confirm both still call it.

### Data flow
`schedule_full.json` (venue_id + kickoff_local_venue) + `venues.json` (lat/lon/timezone) → `scrape_weather.py` → 1 Open-Meteo range call/venue → `data/weather.json` `{venue:{date:{…}}}` → committed by Action → `data-loader.js` (`weather.json`→`data.weather`) → `matchup-detail.js:208 weatherSection(match, scheduleFull, weather)` → `weather.js` pills.

### Edge cases
- **Venue missing lat/lon**: none today, but guard — `if v.get("lat") is None or v.get("lon") is None: continue` (logged). Don't crash.
- **Past dates**: `days_out < 0` → skip (already handled; keep with venue-local date).
- **16-day horizon**: `days_out > 15` → skip; UI shows "not yet available". (Open-Meteo `forecast` is ~16 days; do NOT switch endpoints.)
- **TZ at day boundary**: late UTC kickoffs (00:00–05:00Z) map to the *previous* local day — the whole point of task 1 & 4. A fixture's UTC date and local date can differ; the **key must be local**.
- **Single returned-array index mismatch**: if `daily.time` is missing/short, skip that venue (don't blind-index `[0]`).
- **iOS / graceful degradation**: empty `weather.json` ⇒ `weather.js` already renders "Forecast not yet available" — never throws. Keep that path green.

### QA test scripts (concrete)
- **`tests/feature/rj30-weather.test.mjs`** (node:test) — pipeline contract, no network:
  - `read('scripts/scrape_weather.py')` asserts: `/kickoff_local_venue/` (TZ fix); `/start_date=.*end_date=/s` AND that the URL is built **once per venue** (regex that `start_date`/`end_date` derive from `min`/`max` of a date set, e.g. `/min\(.*dates|sorted\(dates\)\[0\]/`); `/&timezone=/` uses a venue field not hard `UTC` only; `/--selftest|selftest/`; the per-venue fetch is wrapped so one failure `continue`s (`/except \(ScrapeError, ValueError\)/`).
  - Fixture-driven shape test: load `data/weather.json`, assert every value is a dict and every populated cell has numeric `temp_c, condition_code, humidity_pct, wind_kph` (`typeof === 'number'`).
  - `read('app/components/weather.js')` asserts `/kickoff_local_venue/` so UI + scraper agree on the key (guards AC-4.3 regression).
  - `read('scripts/validate_data.py')` asserts `/check_weather_coverage|weather.*coverage/` exists and that it pushes to `warnings` not `errors` (`/self\.warnings\.append/` near the weather block).
  - **Selftest invocation**: `child_process.execFileSync('python3', ['scripts/scrape_weather.py','--selftest'])` exits 0 (no network) — assert it doesn't throw.
- **`tests/ux/rj30-weather.spec.mjs`** (Playwright, 390×844 iPhone):
  - *Given* the app loaded with a fixture whose venue-day is populated in `weather.json`, *When* navigating to that matchup detail (`#/matchup/<id>`), *Then* the `.section` containing `h2:has-text("Weather")` shows a `.weather-block` with a Temperature `.kv` containing `°C` and `°F`. Selector: `page.locator('.section', { has: page.locator('h2', { hasText: 'Weather' }) })`; assert `.weather-block .kv` count ≥ 4 (Forecast/Temp/Humidity/Wind).
  - *Given* a fixture >15 days out, *Then* the Weather section shows text `Forecast not yet available`. (Use a fixtured matchup or stub.)
  - Assert no horizontal scroll / safe-area overflow at 390px (reuse existing viewport-overflow assertion pattern from `qa-pwa-ios.spec.mjs`).

### iOS / UX notes
- No new DOM; pills/`.kv` rows already styled and mobile-fit. Temperature shows both `°C / °F` (existing). No safe-area impact (section sits inside the scroll container). No new fonts/colors — existing design language preserved.

### Files touched / new files
- **Edit**: `scripts/scrape_weather.py`, `scripts/validate_data.py`, `app/components/weather.js`
- **New**: `tests/feature/rj30-weather.test.mjs`, `tests/ux/rj30-weather.spec.mjs`
- **No change** (verify only): `data/venues.json`, `data/schedule_full.json`, `app/data-loader.js`, `.github/workflows/{daily,frequent}_update.yml`

---

## RJ30-8 — Results-derived recent form (retire dark `form.json`)

### User stories
- **US-8.1** — As a fan on a matchup page, I want each team's **last-5 W/D/L** to reflect their **actual tournament results so far**, so that the "Recent form" pills are real instead of "No recent results on record."
- **US-8.2** — As the model, I want `compute_xg.form_points()` to receive real last-5 arrays, so that the recent-form xG bump is active during the tournament.
- **US-8.3** — As the maintainer, I want to stop depending on the flaky ESPN `scrape_form.py`, so that form data stops being dark.
- **US-8.4** — As the model owner, I want the composite **form term** to be non-inert (optimizer-tuned, with a small floor), so that in-tournament performance measurably nudges predictions without overfitting.

### Acceptance criteria (Given/When/Then)
- **AC-8.1** — *Given* `actual_results.json` with 72 group + 13 R32 scored games, *When* the new `scripts/compute_form_recent.py` runs, *Then* `data/form.json` contains `{TeamName: [{date, opponent, score_a, score_b, result}, …]}` for every team that has played ≥1 FINAL game, ordered **most-recent first**, capped at 5.
- **AC-8.2** — *Given* a team with <5 played games, *When* form is computed, *Then* its array has exactly that many entries (no padding), and `form.js` renders just those pills (no crash; existing length-based render).
- **AC-8.3** — *Given* a knockout game decided on penalties (`STATUS_FINAL_PEN`, `score_a==score_b`, `winner` set, `shootout_a/b` present), *When* deriving `result`, *Then* the winner gets **`W`** and loser **`L`** (NOT `D`) — using `rec.winner`, and the displayed `score_a/score_b` are the **regulation** scores (so the tooltip shows `1–1` with the result pill reflecting the shootout).
- **AC-8.4** — *Given* a `STATUS_SCHEDULED` or unscored record, *When* computing form, *Then* it is **excluded** (only FINAL/scored games count) — mirrors `compute_form.final_matches` FINAL gate.
- **AC-8.5** — *Given* `form.json` is now populated, *When* `compute_xg.py` runs, *Then* `form_points()` returns non-None for played teams and `used_form_a/b` flags flip to `true` for in-tournament fixtures.
- **AC-8.6** — *Given* the same `actual_results.json`, *When* both `compute_form.py` (→`form_scaled`) and `compute_form_recent.py` (→`form.json`) run, *Then* they **agree on which games are FINAL** (shared FINAL-status set) and neither writes the other's file.
- **AC-8.7** — *Given* the composite weight floor, *When* `rebuild_composite.py` runs, *Then* the effective `form` weight is `max(weights.get("form",0), FLOOR)` with `FLOOR` a small constant (see OPEN QUESTION), and predictions still pass the never-regress backtest guard in `optimize_weights.py`.

### Tasks (exact files/functions/data flow)
1. **New `scripts/compute_form_recent.py`** (pure code, no network):
   - Load `actual_results.json`. Iterate the **same tiers** `compute_form.py` uses (`group_stage` + `KO_TIERS`). For each record with `"__vs__"` key, `status in FINAL` (reuse the FINAL set incl. `STATUS_FINAL_AET`/`STATUS_FINAL_PEN` — import from a shared constant or replicate `compute_form.FINAL`), and numeric `score_a/score_b`:
     - `a, b = key.split("__vs__", 1)`. Build a per-team event from **both** sides.
     - **Result derivation** (handles pens): if `rec.get("winner")` is set, result is `W` for the winner / `L` for the loser (covers `STATUS_FINAL_PEN` and `STATUS_FINAL_AET` ties). Else compare regulation `score_a`/`score_b`: `>`→W, `<`→L, `==`→D.
     - Store `score_a`/`score_b` **oriented to the team** (team-as-A keeps `score_a,score_b`; team-as-B swaps), `opponent` = the other side, `date` = `kickoff_utc.split("T")[0]`.
   - Sort each team's events by `date` **descending**, slice `[:5]`, write `out[team] = rows`.
   - Idempotency + staleness guard: snapshot non-`__meta__` keys `before`; only bump `__meta__.updated_at` + rewrite when `after != before` (copy `compute_form.py`/`scrape_form.py` pattern). Atomic ASCII write (tmp+replace), matching repo on-disk convention.
   - `--selftest`: feed a synthetic `actual_results` with one pen game + one <5-game team; assert pen winner→`W`, orientation correct, cap at 5.
   - Exit 0 on any exception (`continue-on-error` friendly), leaving `form.json` untouched.
2. **Retire `scrape_form.py`** from crons: remove/disable the `Scrape recent form` step in `daily_update.yml:90-92` and replace with a `Compute recent form (results-derived)` step running `python scripts/compute_form_recent.py` **after** live-results scrape and **before** `compute_xg.py` (so xG sees fresh form). Add the same step to `frequent_update.yml` and `live_update.yml` (after results scrape, before `compute_xg`). Keep `scrape_form.py` in-tree but unwired (or delete — see OPEN QUESTION). Order matters: `scrape_live_results` → `compute_form_recent` → `compute_form` → `rebuild_composite` → `compute_xg`.
3. **`scripts/rebuild_composite.py`** — in `composite()`, change `weights.get("form", 0)` to `max(weights.get("form", 0), FORM_WEIGHT_FLOOR)` with a module constant (default per OPEN QUESTION, recommend `0.01`). Keep `form_scaled` neutral-midpoint for teams with no games (already handled by `compute_form.to_scaled`). Do **not** touch `optimize_weights.py`'s tuning.
4. **`app/components/form.js`** — **no change needed**; it already consumes `{result, date, opponent, score_a, score_b}` arrays. Verify the empty-state copy ("No recent results on record.") stays for unplayed teams.
5. **`scripts/validate_data.py`** — `form.json` already in the `check_dict_or_empty` list (line 685). Add a warn-only `check_form_coverage()`: if `actual_results` has ≥1 scored game but `form.json` has 0 team keys, push a warning (catches a silent regression to dark).

### Data flow
`actual_results.json` → `compute_form_recent.py` → `data/form.json` `{Team:[last5]}` → (a) `data-loader.js`→`data.form` → `matchup-detail.js:206 formSection(match, data.form)` → `form.js` pills; (b) `compute_xg.py form_points(form.get(team))` → xG bump. Separately `actual_results.json` → `compute_form.py` → `teams.json.sub_ratings.form_scaled` → `rebuild_composite.py composite()` (floored weight).

### Edge cases
- **<5 matches**: array shorter than 5; `form.js`'s `entries.slice(0,5)` + length check already handle it.
- **0 matches (team yet to play)**: team absent from `form.json` → `form.js` shows empty state; `compute_xg.form_points` returns `None` → no bump (correct).
- **Group vs knockout**: include **both** (matches `compute_form`'s tier list). A knockout result is still "recent form."
- **W/D/L incl. pens**: pen/AET ties resolve via `rec.winner` → W/L, never D. Regulation draw with no `winner` → D. **Test both.** (Verified records exist: `Germany__vs__Paraguay` 1–1 `STATUS_FINAL_PEN` winner `Paraguay`, shootout 3–4.)
- **vs `compute_form.form_scaled`**: different file, different purpose, shared FINAL gate. Neither writes the other's output. The plan must NOT collapse them into one (they have different consumers + scales).
- **Name canonicalization**: `actual_results` keys use canonical team names matching `teams.json` (verified: `Mexico`, `Cote d'Ivoire`, etc.). `form.js` looks up `form[match.team_a]` by the same canonical name — no mapping needed. Guard: if a results key team isn't in `teams.json`, still emit it (harmless; UI just won't query it).
- **STATUS_SCHEDULED**: excluded by FINAL gate.
- **iOS / degradation**: empty `form.json` ⇒ existing "No recent results" empty state. Never throws.

### QA test scripts (concrete)
- **`tests/feature/rj30-form.test.mjs`** (node:test):
  - **Selftest**: `execFileSync('python3', ['scripts/compute_form_recent.py','--selftest'])` exits 0.
  - **Pen-winner unit** via a tiny driver (or invoke selftest that prints JSON): *Given* a `STATUS_FINAL_PEN` record `A__vs__B` score 1–1 winner `B`, *Then* `form[A]` last entry `result==='L'`, `form[B]` `result==='W'`, both with `score_a/score_b` = regulation `1`/`1` oriented to the team.
  - **Shape on real data**: run the script against repo `data/actual_results.json` into a temp `form.json` (or read the committed one post-run), assert: every team value is an array len ≤ 5; every entry has `result ∈ {W,D,L}`, string `date`, string `opponent`, numeric `score_a/score_b`; arrays sorted date-desc.
  - **Orientation**: pick a known result (`Mexico__vs__South Africa` 2–0), assert `form['Mexico']` has an entry `{opponent:'South Africa', score_a:2, score_b:0, result:'W'}` and `form['South Africa']` mirror `{opponent:'Mexico', score_a:0, score_b:2, result:'L'}`.
  - **`compute_xg` integration**: `read('scripts/compute_xg.py')` already calls `form_points` — assert (static) it reads `form.json`; optionally run `compute_xg.py` after form and assert ≥1 `used_form_a===true` in `xg.json`.
  - **Cron wiring**: `read('.github/workflows/daily_update.yml')` asserts `/compute_form_recent\.py/` present and `scrape_form.py` **not** run (`assert.ok(!y.includes('scrape_form.py'))`); same for `frequent_update.yml`, `live_update.yml`.
  - **Weight floor**: `read('scripts/rebuild_composite.py')` asserts `/max\(weights\.get\("form", *0\), *FORM_WEIGHT_FLOOR\)/` and `/FORM_WEIGHT_FLOOR\s*=/`.
  - **Two-form separation**: assert `compute_form_recent.py` writes `form.json` and NOT `teams.json` (`assert.ok(!s.includes('teams.json"'))` / writes only `form.json`); assert `compute_form.py` still writes `teams.json` `form_scaled`.
- **`tests/ux/rj30-form.spec.mjs`** (Playwright, 390×844):
  - *Given* the app loaded and a played matchup (e.g. a R32 fixture), *When* on its detail page, *Then* the "Recent form (last 5)" `.section` shows `.form-grid` with two `.form-col`, each containing ≥1 `.pill` (`.pill-w`/`.pill-l`/`.pill-d`). Selector: `page.locator('.section', { has: page.locator('h2', { hasText: 'Recent form' }) }) .locator('.pill')` count ≥ 1.
  - *Given* a pen-decided fixture, *Then* the winner's column contains a `.pill-w` (assert at least one `.pill-w` exists for that team).
  - Assert pills fit at 390px (no overflow on `.pill-strip`).

### iOS / UX notes
- Zero new UI; `form.js` pills already mobile-styled (`.pill-w/.pill-l/.pill-d`, tooltips via `title`). Pen results now show a real `W`/`L` instead of an empty state — strictly an upgrade. No safe-area / layout change.

### Files touched / new files
- **Edit**: `scripts/rebuild_composite.py`, `scripts/validate_data.py`, `.github/workflows/daily_update.yml`, `.github/workflows/frequent_update.yml`, `.github/workflows/live_update.yml`
- **New**: `scripts/compute_form_recent.py`, `tests/feature/rj30-form.test.mjs`, `tests/ux/rj30-form.spec.mjs`
- **Retire** (unwire, keep or delete per OPEN QUESTION): `scripts/scrape_form.py`
- **No code change** (verify only): `app/components/form.js`, `app/data-loader.js`, `scripts/compute_form.py`, `scripts/compute_xg.py`, `data/form.json` (regenerated)

---

## Disjoint-ownership partitioning (for parallel build)
- **Weather partition** owns: `scripts/scrape_weather.py`, `app/components/weather.js`, `tests/feature/rj30-weather.test.mjs`, `tests/ux/rj30-weather.spec.mjs`.
- **Form partition** owns: `scripts/compute_form_recent.py`, `scripts/rebuild_composite.py`, `scripts/scrape_form.py` (retire), `app/components/form.js` (verify), `tests/feature/rj30-form.test.mjs`, `tests/ux/rj30-form.spec.mjs`.
- **Shared files (sequence, don't parallelize)**: `scripts/validate_data.py` (both add a coverage check) and the three workflow YAMLs (form unwires `scrape_form`, both confirm `scrape_weather`). Assign these to ONE integrator after both partitions land, or pre-split the validate_data edits into two non-overlapping functions added at the same call site.

## Full gate
`python scripts/validate_data.py` → `bash tests/smoke.sh` → `node --test tests/` → `npx playwright test`. New tests must be green; existing suite must not regress.
