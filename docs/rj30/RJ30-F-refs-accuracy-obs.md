# RJ30-F — Referees / Model-Accuracy / Pipeline-Observability (P2)

Plan author: senior product + QA. Stack is **settled** (vanilla-JS PWA, no build step, hash router,
Python → static `data/*.json` via GitHub Actions, Netlify deploy, Supabase prod `vodjwymxquuertmhtvuw`).
Every item below is **zero additional cost** (free sources / existing data / pure code), iOS-first,
mobile-first (390px), respects safe-areas, and must not regress existing UX.

Grounding — what the code actually does today (verified by reading):

- **`data/referees.json`** = `{ "__meta__": { "updated_at": ... } }` only — **directory is empty**.
  **`data/match_referees.json`** = `{}` — **no assignments**.
- **`scripts/scrape_referees.py`** probes ONE source — `WIKI_PAGE =
  https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_officials` — with a brittle 3-`<td>` regex
  (`try_wikipedia`). It never writes assignments (`mrefs` is loaded, snapshotted, but
  `try_wikipedia` only mutates `refs`). It is wired in `daily_update.yml` under
  `continue-on-error: true`, and only bumps `__meta__.updated_at` when data actually changed.
- **`app/components/referee.js`** → `refereeSection(match, data)`: keys assignment off
  `matchId = \`${team_a}__vs__${team_b}\`` (and the reverse) in `data.matchReferees`, looks the
  ref up in `data.referees[rid]`, renders name/nationality/confederation + bias cards. Already
  graceful: no ref → "Not yet announced — typically confirmed 24–48 h before kickoff."
- **`app/ref-bias.js`**: `teamHistory(ref.history, team)` and `confederationLean(...)` read a
  `ref.history` array of rows shaped `{team_a, team_b, yellows_a, reds_a, penalties_a, yellows_b,
  reds_b, penalties_b}`. Confidence tiers: history n≥5 high / 2–4 medium / ≤1 low.
- **`app/data-loader.js`**: `referees.json → data.referees`, `match_referees.json →
  data.matchReferees`, both OPTIONAL with `{}` fallback. Consumed only by
  `app/views/matchup-detail.js:204` (`refereeSection`).
- **`app/views/backtest-view.js`** (`renderBacktestView`) already renders a measured `live2026`
  panel (J5L/DT/Market/Polymarket/Hybrid with accuracy + Brier + log-loss) from
  `data/backtest.json → live2026`, plus a placeholder before any match resolves.
- **`scripts/snapshot_backtest.py`** captures pre-kickoff W/D/L from all 5 forecasters into
  `data/live-backtest.json` (`matches` map + `summary`) and merges a summary into
  `data/backtest.json → live2026`. Per-match detail (`preds`, `score`, `actual`, `brier`,
  `logloss`) lives in `data/live-backtest.json` but **is NOT currently surfaced per-match in any
  view** — only the aggregate `summary` is.
- **`app/views/accuracy-scoreboard-view.js`** (`renderAccuracyScoreboardView`) is the **player
  leaderboard** (Everyone-pool RPC) — NOT model accuracy. Do not conflate.
- **`scripts/validate_data.py`**: `Validator` accumulates `self.errors` / `self.warnings`; `run()`
  prints `[warn]` lines to stderr and a final `validate_data.py: OK (N file(s), M warning(s))` or
  `FAILED`. `--strict` escalates tournament gates to errors. Exit 0/1.
- **`scripts/check_staleness.py`**: GitHub-commit-age + emptiness watchdog; tournament-gated
  (`2026-06-11..2026-07-20`); opens ONE deduped `stale-data` labeled issue; never fails the job.
- **`.github/workflows/daily_update.yml`**: runs scrapers (continue-on-error) → `validate_data.py
  --strict` → `check_staleness.py` → commit/push; `permissions: issues: write`.
- **`app/main.js`**: views register in a `switch (view)` + `TITLES` map + `tabMap`. New routes are
  one `case` + one `TITLES` entry (no router framework).
- node:test feature tests read script/JSON text and assert contracts (`tests/feature/*.mjs`);
  Playwright UX tests run at 390×844 (`tests/ux/*.spec.mjs`).

---

## RJ30-10 — Referees / ref-bias: populate the directory + (scoped) assignments

### Problem
The referee panel never shows a referee: `referees.json` and `match_referees.json` are empty
because (a) the Wikipedia table regex in `try_wikipedia` is too brittle to match the live page
markup (Wikipedia wikitables carry `class`/`scope`/`rowspan`/`<span>`/flag-icon nodes the regex
doesn't allow), and (b) **the script never writes assignments at all**. We need to populate the
referee directory and, where a free source exists, match assignments — without paid APIs.

### Free-source decision (grounded, costed)
- **Directory (referee panel)** — *reliably free*. Wikipedia
  `2026_FIFA_World_Cup_officials` lists the appointed referee panel (name, confederation,
  nationality). This is the durable, low-churn data. Robust parse via the **MediaWiki REST API**
  (`https://en.wikipedia.org/w/api.php?action=parse&page=2026_FIFA_World_Cup_officials&prop=wikitext&format=json`)
  → parse the `{| ... |}` wikitable rows (`|`-delimited cells, strip `[[...]]` links and `{{flag}}`
  templates) instead of brittle HTML regex. Zero cost, no key, robots-clean (api.php is allowed).
- **Per-match assignments** — *no fully-reliable free, structured, machine-readable source*.
  FIFA's per-match official appointments are published 24–48 h pre-kickoff on FIFA.com match-center
  pages (robots-blocked per the PROJECT note that `scrape_schedule.py` is robots-blocked) and on
  each match's Wikipedia page (unstructured, late). **Recommendation:** ship **directory-only** as
  the guaranteed deliverable; add an *opportunistic* assignments parser that reads the per-round
  "Referees" / match-officials tables on the main
  `2026_FIFA_World_Cup_knockout_stage` / group-stage Wikipedia pages when present, keyed to
  `schedule_full.json` match_ids — but gate the build's "done" on directory-only so empty
  assignments stay graceful (existing "Not yet announced" copy already handles this). See
  **OPEN QUESTION Q1**.

### User stories
- **US-10.1 (directory):** *As a fan opening a matchup, I want to see the assigned referee's name,
  nationality and confederation when known, so that I can judge officiating context.*
- **US-10.2 (bias):** *As an analytically-minded fan, I want referee card/penalty tendencies vs a
  team and vs confederations, so that I understand potential officiating lean.*
- **US-10.3 (graceful):** *As a fan before assignments are announced, I want a clear "not yet
  announced" note instead of a blank or broken section.*

### Acceptance criteria (Given/When/Then)
- **AC-10.1** Given the Wikipedia officials page is reachable, When `scrape_referees.py` runs, Then
  `data/referees.json` contains ≥ 1 entry keyed by `ref_id` with `{ref_id, name, nationality,
  confederation, stats:{}, history:[]}` and ASCII-encoded (`ensure_ascii=True`), and
  `__meta__.updated_at` is set only if the directory changed.
- **AC-10.2** Given diacritic names (e.g. "Szymon Marciniak", "Sławomir"), When parsed, Then the
  display `name` preserves Unicode in the in-memory object but is serialized ASCII-escaped (repo
  convention) and `slugify(name)` is stable/diacritic-folded so the same ref maps to one `ref_id`
  across runs.
- **AC-10.3** Given the officials page 4xx/timeout, When the scraper runs, Then it leaves both files
  untouched, logs, and exits 0 (never deletes an existing entry) — matches the current safety
  contract.
- **AC-10.4 (assignments, if scoped in)** Given a free source lists "Team A vs Team B → referee
  Name", When parsed, Then `match_referees.json["TeamA__vs__TeamB"] = ref_id` using the
  `schedule_full.json` match_id orientation, with team names normalized through the project RENAMES
  map; unmatched/unannounced fixtures are simply absent (no null entries).
- **AC-10.5** Given a populated directory + an assignment, When the matchup view renders, Then
  `refereeSection` shows the ref header + bias cards; given no assignment, Then it shows the "Not
  yet announced" note (no regression).
- **AC-10.6** `validate_data.py` stays green: `referees.json`/`match_referees.json` are
  dict-or-empty (existing `check_dict_or_empty` covers them) and must remain valid dicts.

### Tasks (exact files / functions / data flow)
1. **`scripts/scrape_referees.py`** — rewrite source layer:
   - Replace `try_wikipedia`'s HTML regex with `fetch_officials_wikitext()` using
     `polite_get(API_URL)` where `API_URL` is the MediaWiki `action=parse&prop=wikitext` endpoint;
     parse `res.json()["parse"]["wikitext"]["*"]`.
   - `parse_panel_table(wikitext) -> list[dict]`: split on table rows (`\n|-`), for each row split
     cells on `\n|` / `||`, strip wiki markup (`_strip_wiki(cell)` removing `[[a|b]]→b`, `{{flag|X}}→X`,
     `<ref>...</ref>`, HTML tags), map columns → name/confederation/nationality by header detection.
   - Add `_fold_diacritics(name)` (use `unicodedata.normalize('NFKD', ...)` + drop combining marks)
     **only inside `slugify`** so `ref_id` is stable; keep the displayed `name` un-folded.
   - Keep the existing merge/no-op-bump/atomic-save/`SystemExit(0)`-on-fatal scaffolding intact.
   - (If Q1 = assignments) add `try_assignments(schedule, existing_mrefs) -> int` that reads the
     group/knockout Wikipedia pages' officials tables, maps `(team_a, team_b)` → match_id via
     `schedule_full.json`, normalizes names through a local `RENAMES` mirror, and writes
     `match_referees.json`. Call it in `main()` and include `mrefs` in the change-detection diff
     (already snapshotted as `before_mrefs`).
2. **`data/referees.json`** — will be (re)populated by the scraper output; keep the `__meta__`
   wrapper. No app code change needed (loader + view already wired).
3. **No change** to `app/components/referee.js` / `app/ref-bias.js` — they already consume the
   target shape. (If a bug surfaces in rendering real data, fix in-scope only.)

### Edge cases
- **Diacritics** → fold in `slugify` only; serialize ASCII (AC-10.2).
- **Knockout assignments unpublished** → absent keys; view shows "Not yet announced" (AC-10.5).
- **Empty/partial panel** (page restructured) → parser returns `[]`; no-op bump leaves files
  untouched (AC-10.3); `data.referees` stays `{}`; view stays graceful.
- **iOS**: section is plain DOM appended in `matchup-detail`; no new iOS concern. Long ref names
  must not overflow 390px — bias card already uses `<strong>`/muted spans; verify wrapping.
- **Name collisions** (two refs same slug) → last-wins is acceptable for a ~30-ref panel; log a
  warning if a slug maps to two different display names in one run.
- **History always `[]`** for WC2026 panel (no historical card data is free/structured) → bias
  cards show "No prior matches with this ref." (already handled). Document that bias is
  **directory-present but history-empty** until a free history source exists (OPEN QUESTION Q2).

### QA test scripts
- **`tests/feature/refs-directory.test.mjs`** (node:test). Spec:
  - `test('scrape_referees uses the MediaWiki parse API, not brittle HTML regex')`: read
    `scripts/scrape_referees.py`; `assert.match(s, /action=parse/)` and
    `assert.match(s, /prop=wikitext/)`; assert the old 3-`<td>` regex is gone (`assert.doesNotMatch(s, /<tr>\\s*<td/)`).
  - `test('slugify folds diacritics for a stable ref_id')`: spawn `python3 -c` importing the module
    and assert `slugify('Szymon Marciniak') === slugify('Szymon Marçiniak')` (or run a tiny inline
    Python that imports `scrape_referees` and prints both slugs; assert equal). Fixture: pure
    function, no network.
  - `test('scraper writes ASCII + preserves the safety contract')`: assert
    `ensure_ascii=True`, `raise SystemExit(0)` on fatal, and "never delete an existing entry" comment
    intact.
- **`tests/feature/refs-render.test.mjs`** (node:test, DOM-free, import the module under a jsdom-free
  shim is overkill — instead assert the data contract): build a fixture `referees` map + a
  `matchReferees` map keyed `Argentina__vs__Brazil`, import `teamHistory`/`confederationLean` from
  `app/ref-bias.js`, and assert: a ref with a 6-row history yields `confidence==='high'`; an
  empty-history ref yields `{n:0}` and the bias card path "No prior matches" branch. (Pure logic,
  matches existing `ref-bias` exports.)
- **`tests/ux/refs-section.spec.mjs`** (Playwright, 390×844). Spec:
  - Seed `window.localStorage`/intercept `referees.json`+`match_referees.json` via
    `page.route('**/referees.json', ...)` returning a 1-ref fixture + an assignment for the first
    matchup; navigate to that matchup hash; **Then** `await expect(page.locator('.ref-header
    strong')).toHaveText(/.+/)` and the section is within the 390px viewport (no horizontal
    scroll: assert `document.documentElement.scrollWidth <= 390`).
  - Second test: route both files to `{}`; **Then** the section shows the "Not yet announced" copy
    (`expect(page.getByText(/Not yet announced/))`).

### iOS / UX notes
Pure data fix — no new chrome. Verify ref header + bias cards wrap at 390px and respect existing
`.section` spacing/safe-area (matchup-detail already lives inside the safe-area layout). No new
fonts/colors.

### Files touched / new files
- **Touched:** `scripts/scrape_referees.py`, `data/referees.json` (regenerated),
  `data/match_referees.json` (regenerated, if Q1=assignments).
- **New:** `tests/feature/refs-directory.test.mjs`, `tests/feature/refs-render.test.mjs`,
  `tests/ux/refs-section.spec.mjs`.
- **No app/ source changes** (loader + view already wired) unless real data exposes a render bug.

---

## RJ30-11 — Model-accuracy dashboard: per-match Brier / log-loss vs market

### Problem
`snapshot_backtest.py` already captures and scores per-match predictions (`data/live-backtest.json
→ matches[mid].{preds,score,actual,actual_score}` with `correct`/`brier`/`logloss` per model), but
the app only renders the **aggregate** `live2026` summary in `backtest-view.js`. There is no
**per-match** model-accuracy scoreboard letting a user see, match by match, which model called it
and how sharp each was vs the market. The task name references
`accuracy-scoreboard-view.js`, but that file is the **player leaderboard** — do NOT repurpose it.
Add a dedicated **model-accuracy** view fed by the existing `data/live-backtest.json`.

### Free source / data flow
- **Existing data only.** No new fetch. The view reads `data/live-backtest.json` (already shipped,
  already in the repo, 100 KB). Captured pre-kickoff by `snapshot_backtest.py` from public
  Gamma/Kalshi/model JSON; scored from `data/actual_results.json` (ESPN-fed). Zero new cost.

### User stories
- **US-11.1:** *As an analytics fan, I want a per-match scoreboard showing each model's pick and
  whether it was right, so that I can see which model is sharpest as the tournament unfolds.*
- **US-11.2:** *As a skeptic, I want per-match Brier + log-loss vs the market baseline, so that I
  can judge calibration, not just hit-rate.*
- **US-11.3:** *As an early-tournament visitor, I want a clear "not enough matches yet" state, so
  that an empty board doesn't look broken.*

### Acceptance criteria (Given/When/Then)
- **AC-11.1** Given `data/live-backtest.json` has ≥ 1 scored match, When the model-accuracy view
  loads, Then it lists each scored match (team_a vs team_b, actual score) with, per model
  (J5L/DT/Market/Polymarket/Hybrid), a ✓/✗ for the called outcome and the per-match Brier.
- **AC-11.2** Given the summary exists, When the view loads, Then a header card shows the aggregate
  accuracy + mean Brier + mean log-loss per model (reuse the same numbers as the Backtest view's
  `live2026` so the two never disagree).
- **AC-11.3** Given a model is "vs market", When rendered, Then each model row visually anchors to
  the Market baseline (e.g. Brier delta vs Market shown, or Market column highlighted) so the
  comparison is explicit.
- **AC-11.4** Given 0 scored matches, When the view loads, Then it shows a "Live model accuracy
  starts once matches resolve" empty state (reuse `app/lib/empty-state.js` if its API fits).
- **AC-11.5** Given the fetch fails, When the view loads, Then it degrades to the empty/offline card
  (no console-fatal, no blank screen).
- **AC-11.6** Outcome labels must use the project's status gating: only matches with a FINAL result
  appear (the capture script already gates on `FINAL_STATUS`; the view simply renders what's
  scored).

### Tasks (exact files / functions / data flow)
1. **New `app/views/model-accuracy-view.js`** → `renderModelAccuracyView(root, data, params)`:
   - `fetch('data/live-backtest.json', { cache: 'no-store' })` (mirror `backtest-view.js`'s fetch
     pattern), parse `{ matches, summary }`.
   - Header card: render the per-model aggregate from `summary` (accuracy `correct/total`, `brier`,
     `logloss`) — same label map as `backtest-view.js` `LIVE_LABELS`.
   - Per-match list: iterate `Object.values(matches).filter(m => m.scored)`, sort by
     `match_number`. For each, a row with the fixture, `actual_score`, and a compact per-model
     ✓/✗ + Brier grid. Escape all strings via `app/lib/escape.js`.
   - Market-anchored delta: for each model show `Brier − Market.Brier` (negative = sharper than
     market) per match.
   - Empty/error states per AC-11.4/11.5.
2. **`app/main.js`** — register the route:
   - `import { renderModelAccuracyView } from './views/model-accuracy-view.js';`
   - add `case 'model-accuracy': renderModelAccuracyView(root, state.data, params); break;`
   - add `'model-accuracy': 'Model Accuracy'` to `TITLES`.
   - Entry point: add a link/button from the existing **Backtest** view header
     (`backtest-view.js`) — "See per-match accuracy →" anchor to `#/model-accuracy` — so it's
     discoverable without a new nav tab (keeps the tab bar unchanged; respects "don't regress nav").
3. **No Python change** — `snapshot_backtest.py` already writes everything needed. (Optional: if
   `actual_score` is absent on older snapshots, the view tolerates it.)

### Edge cases
- **Few completed matches** → header still renders aggregates; list may be short; empty state at 0.
- **Market baseline missing for a match** (Kalshi didn't price it; capture fell back to
  strength-derived) → still present in `preds.market`; if a model leg is absent for a match
  (`score[k]` missing), render "—" for that cell (don't crash). `polymarket` is often absent
  pre-coverage → tolerate missing key.
- **Large match list** (up to 104 matches) → plain list, no virtualization needed; keep DOM light
  (one row per match). iOS scroll is fine.
- **`no-store` fetch + stale-while-revalidate** `_headers` → mirror the Backtest view; data is
  static so this is consistent.
- **Numbers parity** — compute aggregates from `summary` (already rounded by Python), NOT
  re-derived in JS, so the two views can't drift (matches the `live-backtest.test.mjs` contract).

### QA test scripts
- **`tests/feature/model-accuracy-view.test.mjs`** (node:test). Spec:
  - Read `app/views/model-accuracy-view.js`; assert it `fetch`es `data/live-backtest.json`,
    imports `escapeHtml`, filters on `scored`, and renders per-match `brier`. `assert.match` on each.
  - `test('view renders nothing fatal on empty matches')`: import the module's pure helper (extract
    a `buildRows(live)` pure function returning row descriptors) and assert `buildRows({matches:{},
    summary:{matches_scored:0}})` returns `[]` and a flag to show the empty state.
  - `test('aggregate uses summary, not re-derived')`: assert the source references
    `live.summary[model].brier` and does **not** recompute a mean over `matches` (guards drift) —
    `assert.match(s, /summary\\[/)`.
- **`tests/feature/model-accuracy-data.test.mjs`** (node:test): load `data/live-backtest.json`;
  for every `m` with `m.scored===true`, assert `m.score` has at least `model` with
  `correct ∈ {0,1}` and numeric `brier`, and `m.actual ∈ {team_a_wins,draw,team_b_wins}` — locks
  the data contract the view depends on.
- **`tests/ux/model-accuracy.spec.mjs`** (Playwright, 390×844). Spec:
  - `page.route('**/live-backtest.json', ...)` returning a 2-scored-match fixture; goto
    `#/model-accuracy`; **Then** `expect(page.locator('.model-acc-row')).toHaveCount(2)`, the
    header shows a per-model accuracy %, and `document.documentElement.scrollWidth <= 390`
    (no horizontal overflow).
  - Second test: route to `{matches:{},summary:{matches_scored:0}}`; **Then** the empty-state copy
    is visible (`getByText(/starts once matches resolve/i)`).
  - Third test: from Backtest view, click the "per-match accuracy" link and assert the hash becomes
    `#/model-accuracy`.

### iOS / UX notes
Reuse the existing `.home-card` / `.backtest-grid` design language and the `backtest-badge measured`
chip so the new view looks native to the Backtest section. Per-match grid must fit 390px — use a
compact column layout (fixture row on top, model ✓/✗ chips wrapping below) rather than a wide table.
Respect safe-area via the existing `#view` container. No new colors/fonts; reuse `--measured`/muted
tokens already in CSS for the backtest view.

### Files touched / new files
- **New:** `app/views/model-accuracy-view.js`, `tests/feature/model-accuracy-view.test.mjs`,
  `tests/feature/model-accuracy-data.test.mjs`, `tests/ux/model-accuracy.spec.mjs`.
- **Touched:** `app/main.js` (one import + one `case` + one `TITLES` entry),
  `app/views/backtest-view.js` (add the discoverability link), `app/styles*` (if a few CSS rules
  are needed — reuse backtest classes first; add minimal `.model-acc-*` rules only if required).
- **No Python / data writes.**

---

## RJ30-12 — Pipeline observability: surface validate warnings + staleness

### Problem
`validate_data.py` emits `[warn]` lines and `check_staleness.py` emits emptiness/age alerts, but
the only durable surface is **stderr in CI logs** + the one deduped `stale-data` issue. There is no
at-a-glance pipeline health surface for the owner, and validate's *warnings* (non-strict) are
invisible after the run scrolls off. We want a small, actionable, **non-spammy** observability
surface. Two candidate mechanisms — see OPEN QUESTION Q3 for the recommendation.

### Decision (grounded, costed)
- **Recommended: a committed `data/pipeline_status.json` + a tiny in-app `/status` view.** Zero
  cost (static JSON committed by the existing daily cron; rendered client-side). It reuses the
  existing data-pipeline + Netlify deploy with **no new infra, no issue spam**, and is always
  current. A daily GitHub-issue summary risks spam/dedupe churn (the repo already has `stale-data`
  + per-workflow failure issues); we keep issues for *failures only*, and use the committed JSON +
  view for *steady-state visibility*.
- The existing `swarm_status_updater.py` is the **pattern** (read signals → render a status
  artifact) but it targets local Cursor transcripts and is not pipeline-aware — we do **not** reuse
  its transcript logic; we mirror its "generate a status artifact each run" shape with
  pipeline-native inputs.

### User stories
- **US-12.1:** *As the owner, I want a single status surface showing each data feed's freshness +
  any validate warnings, so that I can spot a silently-failing scraper without reading CI logs.*
- **US-12.2:** *As the owner, I don't want to be paged for steady-state — only actionable problems
  should ever open an issue, deduped.*
- **US-12.3:** *As a curious user, I want a lightweight "data health" page that shows the pipeline
  is alive (last update per feed), so that I trust the numbers.*

### Acceptance criteria (Given/When/Then)
- **AC-12.1** Given the daily cron runs, When validation + staleness complete, Then the cron writes
  `data/pipeline_status.json` containing: `generated_at`, per-feed `{name, updated_at, age_hours,
  rows, status: ok|stale|empty|missing}`, the count + list of `validate` warnings, and an overall
  `health: ok|degraded`.
- **AC-12.2** Given `data/pipeline_status.json` exists, When the user opens `#/status`, Then the
  view renders an overall health pill + a per-feed table (name, age, rows, status chip) + a
  collapsed "warnings" list; degraded feeds are visually flagged.
- **AC-12.3** Given the JSON is missing/old, When `#/status` loads, Then it degrades gracefully
  ("status not yet generated") with no console-fatal.
- **AC-12.4** Given no actionable problem, When the cron runs, Then **no** GitHub issue is opened
  (issues remain reserved for staleness/failure, already deduped) — no new issue channel.
- **AC-12.5** Given `validate_data.py` runs, Then it can optionally emit a machine-readable warnings
  list (a `--json-report PATH` flag) so the status builder consumes structured output instead of
  scraping stderr — keeps it robust and testable. Default behavior (exit codes, stderr) is
  **unchanged** (no regression to the cron gate).
- **AC-12.6** The status builder is **non-blocking** (`continue-on-error: true` / always exit 0) so
  observability can never fail the data refresh.

### Tasks (exact files / functions / data flow)
1. **`scripts/validate_data.py`** — add an *optional* `--json-report PATH` arg in `main()`; when
   set, after `run()`, dump `{generated_at, errors, warnings, files_checked}` to PATH. Do **not**
   change exit codes or stderr output (the regression gate + `pipeline-integrity.test.mjs` rely on
   them). This is purely additive.
2. **New `scripts/build_pipeline_status.py`** → builds `data/pipeline_status.json`:
   - Reuse `check_staleness.py`'s `_payload_count` / `EMPTY_WATCH` logic (import or mirror the
     small helper) to compute per-feed `rows` + `status`.
   - Read each watched feed's `__meta__.updated_at`; compute `age_hours`.
   - Read the validate JSON report (from task 1) for the `warnings` list.
   - Compute `health = 'degraded' if any empty/missing/stale feed or any warning else 'ok'`.
   - Write ASCII, atomic (`tmp + replace`), `ensure_ascii=True` per repo convention; only bump if
     changed (mirror `scrape_referees.py`'s no-op-bump pattern so it doesn't churn deploys).
3. **`.github/workflows/daily_update.yml`** — wire two additive steps (both
   `continue-on-error: true`), AFTER `validate_data.py --strict`:
   - change the validate step (or add a second non-strict pass) to also write
     `--json-report data/.validate_report.json` (or a throwaway path under `/tmp`; if committed,
     add to the status build only — prefer `/tmp` to avoid committing a transient report).
   - add `python3 scripts/build_pipeline_status.py` before the commit step (so
     `data/pipeline_status.json` is staged with the rest of `data/`).
4. **New `app/views/status-view.js`** → `renderStatusView(root)`:
   - `fetch('data/pipeline_status.json', { cache: 'no-store' })`; render overall health pill +
     per-feed rows + collapsible warnings. Escape via `app/lib/escape.js`; use
     `app/lib/empty-state.js` for the missing-JSON case if its API fits.
5. **`app/main.js`** — register `#/status` (one import + one `case` + one `TITLES` entry). Keep it
   **off the primary tab bar** (a utility route, linked from Settings — `app/views/settings-view.js`
   — "Pipeline status" row) so it doesn't add nav chrome. (Confirm placement — see Q3.)
6. **`app/data-loader.js`** — `pipeline_status.json` is fetched directly by the status view (like
   `backtest.json`/`live-backtest.json`), so it does **not** need to be added to the loader's
   OPTIONAL_FILES (those are eagerly loaded on boot; status is lazy). Keep it out of the boot path.

### Edge cases
- **Don't spam issues** → status JSON + view is the steady-state surface; issues stay failure-only
  and deduped (AC-12.4). Explicitly do **not** add an issue-creation path here.
- **Dedupe / churn** → no-op-bump on `pipeline_status.json` so unchanged status doesn't trigger a
  Netlify redeploy (mirror `scrape_referees.py`).
- **Actionable only** → `health: degraded` surfaces only real problems (empty/missing/stale/warn);
  steady-state shows `ok` quietly.
- **Outside tournament window** → status still builds (freshness is useful year-round); the
  `degraded` threshold for "stale" should reuse `check_staleness`'s 36 h but only mark stale during
  the tournament window for volatile feeds (mirror its gating) to avoid off-season false positives.
- **Missing `__meta__.updated_at`** → `age_hours: null`, `status` derived from rows only.
- **iOS**: `/status` is a simple table-ish card list; must fit 390px (stack columns), respect
  safe-area, no horizontal scroll.

### QA test scripts
- **`tests/feature/pipeline-status-build.test.mjs`** (node:test): run
  `python3 scripts/build_pipeline_status.py` against a **crafted temp data dir** (mirror the
  `pipeline-integrity.test.mjs` `mkdtempSync` + `spawnSync` pattern) seeded with one empty feed +
  one fresh feed; assert the output JSON has `health==='degraded'`, the empty feed's
  `status==='empty'`, the fresh feed's `status==='ok'`, and a `warnings` array. Also assert it
  exits 0 even on a malformed feed (non-blocking).
- **`tests/feature/validate-json-report.test.mjs`** (node:test): run
  `python3 scripts/validate_data.py --json-report <tmp> --data-dir <fixture>`; assert the report
  file is written with `{generated_at, warnings, errors, files_checked}` **and** that adding
  `--json-report` does **not** change the exit code vs the same run without it (locks AC-12.5
  no-regression). Reuse a crafted temp dir so it's state-independent.
- **`tests/feature/status-wiring.test.mjs`** (node:test): read
  `.github/workflows/daily_update.yml`; assert `build_pipeline_status.py` runs AFTER
  `validate_data.py` and BEFORE the commit step, and is `continue-on-error: true`. Assert
  `app/main.js` registers the `status` route + TITLE. (Mirrors the cron-ordering assertions in
  `live-backtest.test.mjs`.)
- **`tests/ux/status-view.spec.mjs`** (Playwright, 390×844):
  - `page.route('**/pipeline_status.json', ...)` returning a fixture with one `degraded` feed; goto
    `#/status`; **Then** the health pill reads "degraded", the bad feed's chip is visible, and
    `document.documentElement.scrollWidth <= 390`.
  - Route to a 404 / `{}`; **Then** the "status not yet generated" graceful state shows (no
    console error — assert via `page.on('pageerror')` no fatal).

### iOS / UX notes
Reuse `.home-card` + chip styles. Health pill = a small colored chip (green ok / amber degraded) —
reuse existing severity chip classes (`sev-low/medium/high`) seen in `referee.js` so no new color
tokens. Feed rows stack vertically at 390px (name + age + status chip per row). Warnings collapsed
behind a `<details>` so the page stays terse. Off the tab bar; reached from Settings.

### Files touched / new files
- **Touched:** `scripts/validate_data.py` (additive `--json-report`),
  `.github/workflows/daily_update.yml` (2 additive non-blocking steps), `app/main.js` (route +
  TITLE), `app/views/settings-view.js` (one "Pipeline status" link row).
- **New:** `scripts/build_pipeline_status.py`, `data/pipeline_status.json` (generated; seed an
  initial valid file so the view + smoke test have something to load),
  `app/views/status-view.js`, `tests/feature/pipeline-status-build.test.mjs`,
  `tests/feature/validate-json-report.test.mjs`, `tests/feature/status-wiring.test.mjs`,
  `tests/ux/status-view.spec.mjs`.

---

## Disjoint-ownership partitioning (for the build swarm)

- **RJ30-10** owns: `scripts/scrape_referees.py`, `data/referees.json`, `data/match_referees.json`,
  `tests/feature/refs-*.mjs`, `tests/ux/refs-section.spec.mjs`. (No app/source overlap.)
- **RJ30-11** owns: `app/views/model-accuracy-view.js`, `app/views/backtest-view.js` (link only),
  `tests/feature/model-accuracy-*.mjs`, `tests/ux/model-accuracy.spec.mjs`. **Shares `app/main.js`.**
- **RJ30-12** owns: `scripts/build_pipeline_status.py`, `scripts/validate_data.py` (additive),
  `data/pipeline_status.json`, `app/views/status-view.js`, `app/views/settings-view.js`,
  `.github/workflows/daily_update.yml`, `tests/feature/pipeline-status-*.mjs`,
  `tests/feature/validate-json-report.test.mjs`, `tests/feature/status-wiring.test.mjs`,
  `tests/ux/status-view.spec.mjs`. **Shares `app/main.js`.**
- **Collision point:** `app/main.js` is touched by 11 + 12 (each adds one import + one `case` + one
  `TITLES` entry). Sequence those two edits, or assign `app/main.js` edits to a single integrator at
  merge to avoid a conflict. Everything else is disjoint.

## Regression gate (must be 100% green before deploy)
`python3 scripts/validate_data.py` → `bash tests/smoke.sh` →
`node --test tests/feature/*.mjs tests/competition.test.mjs` →
`npx playwright test --config tests/playwright.config.mjs tests/ux tests/integrated`.
