# RJ30.1 — D: AI Match Previews/Recaps + Referee-Bias Expansion

Plan owner: product + QA. Scope: two scoped enhancements on a mature repo
(vanilla-JS PWA, no build step, Python pipeline → `data/*.json` committed by
GitHub Actions, Netlify deploy). Per `CLAUDE.md` SCOPING this is the
"scoped change on an existing codebase" path: **skip discovery/design/backlog,
go straight to the regression gate + Gate 4 deploy.** Both items reuse existing
components, tokens, the `data-loader.js` optional-feed contract, and the
empty-state contract. iOS-first (390×844). No UX regressions.

Regression gate (run in order; gate on EXIT CODES):
```
python3 scripts/validate_data.py
bash tests/smoke.sh
node --test tests/feature/*.mjs tests/competition.test.mjs
npx playwright test --config tests/playwright.config.mjs tests/ux tests/integrated
```

Verified facts from reading the code (citations):
- Matchup detail renders sections in a fixed order in
  `app/views/matchup-detail.js` (`renderMatchupDetail`, lines 208–219). Each
  Phase-2 section is appended via a `*Section(match, data.*)` helper that
  returns a DOM node and "renders gracefully when its data is missing."
- `app/data-loader.js` partitions feeds into `REQUIRED_FILES` (throw on miss)
  and `OPTIONAL_FILES` (graceful `{}`/`[]` fallback). New optional feeds are
  added to `OPTIONAL_FILES` + `fileToKey()` (lines 28–66, 168–198). `loadData()`
  result is passed to the view as `state.data` (`app/main.js` line 204).
- `scripts/_common.py` provides `save_json(name, data)` (atomic tmp+replace,
  `ensure_ascii=True`, key-order preserving), `load_json`, `polite_get`,
  `update_meta`, `log`, `ScrapeError`, `DATA_DIR`. The 5s/host rate-limit + UA
  apply to `polite_get` only (Anthropic SDK is a separate HTTP path).
- `scripts/validate_data.py` only validates files it explicitly references; a
  new `data/previews.json` is **not** enumerated/rejected, so it won't break the
  default gate or `--strict` (validation is opt-in per file). We still ship the
  empty stub so the loader's fetch is a 200, not a 404.
- Referee data: `scripts/scrape_referees.py` writes `data/referees.json` keyed
  by `ref_id` slug with `{ref_id, name, confederation, nationality, stats:{},
  history:[]}` and `data/match_referees.json` `{match_id: ref_id}`. The renderer
  is `app/components/referee.js` → pure logic in `app/ref-bias.js`. Both
  currently seeded but empty (`referees.json` has only `__meta__`,
  `match_referees.json` is `{}`).
- Existing ref tests to extend (don't duplicate): `tests/feature/refs-render.test.mjs`,
  `tests/feature/refs-directory.test.mjs`, `tests/ux/refs-section.spec.mjs`.

Available match data the preview/recap prompt can use (all already loaded into
`state.data`, keyed by `Team A__vs__Team B`):
- model probs: group rows carry `probabilities{team_a_wins,draw,team_b_wins}`,
  `predicted_winner`, `win_confidence_pct`, `composite_a/_b`, `upset_risk`;
  knockout rows carry `advance_pct_a/_b` (`data/group_matchups.json`,
  `data/knockout_matchups.json`).
- `data/forecast.json` (hybrid champion/round-reach), `data/xg.json`
  (`{team_a_xg, team_b_xg}` per pair), `data/h2h.json`, `data/form.json`
  (per-team last-N `[{date,opponent,score_a,score_b,result}]`),
  `data/scorers.json` (per-team `[{name,club,goals}]`), `data/weather.json`
  (per-venue-slug), `data/actual_results.json` (tiered, with
  `{score_a,score_b,status,...}`).

---

## ITEM 1 — AI Match Previews/Recaps (ships DORMANT)

Server-side, in a GitHub Actions cron step, Claude Haiku generates a 1–2 sentence
**preview** for upcoming-soon matches and a 1–2 sentence **recap** for
recently-final matches, from EXISTING data only. Output → `data/previews.json`.
Rendered on matchup-detail as a new section. **Must ship dormant**: with no
`ANTHROPIC_API_KEY` repo secret, the generator writes/keeps an empty
`previews.json`, the cron step is `continue-on-error`, and the UI shows nothing
(no empty-state clutter on a feature that isn't live) — so it never blocks deploy.

### Data contract — `data/previews.json`

Keyed by canonical `match_id` (`Team A__vs__Team B`, same orientation as
`group_matchups`/`xg`/`h2h`). Each entry:
```json
{
  "__meta__": { "updated_at": "2026-06-30T16:33:05+00:00", "model": "claude-haiku-4-5", "generator_version": "v1" },
  "Mexico__vs__Korea Republic": {
    "kind": "preview",            // "preview" | "recap"
    "text": "Mexico edge a coin-flip opener…",
    "content_hash": "ab12…",      // sha256 of the prompt inputs; skip-if-unchanged
    "generated_at": "2026-06-30T16:33:05+00:00",
    "model": "claude-haiku-4-5"
  }
}
```
Empty stub (ships in repo, dormant state):
```json
{ "__meta__": { "updated_at": null, "model": null, "generator_version": "v1" } }
```

### User stories + ACs

**US-1.1 — As a fan, on an upcoming match I see a short AI preview** summarizing
the model lean, form, h2h and xG so I get a human-readable take.
- **Given** `previews.json` has a `preview` entry for the open matchup
  **When** I open `#/matchup/team_a/X/team_b/Y`
  **Then** an "AI preview" section renders the `text`, escaped, with an
  "AI-generated · model · {relative time}" caption.
- **Given** the entry's `kind` is `preview` and the match is **not** final
  **When** the section renders **Then** the heading reads "Preview" (not "Recap").

**US-1.2 — As a fan, on a finished match I see a short AI recap** of the result.
- **Given** `previews.json` has a `recap` entry AND `actual_results` shows the
  match final **When** I open the matchup **Then** the heading reads "Recap" and
  the recap text renders below the existing "Final result" block ordering-wise
  is acceptable as long as it's a distinct section.

**US-1.3 — As the owner, the feature is invisible until I enable it** (dormant).
- **Given** no `ANTHROPIC_API_KEY` secret / empty `previews.json`
  **When** any matchup renders **Then** **no** preview/recap section appears
  (returns an empty `DocumentFragment`), the page is byte-for-byte the
  pre-feature layout, and the deploy gate is green.
- **Given** the cron runs with no key **When** `generate_previews.py` executes
  **Then** it logs "ANTHROPIC_API_KEY unset — skipping", exits 0, and leaves the
  prior `previews.json` untouched.

**US-1.4 — As the owner, cost is bounded** so enabling it is cheap.
- **Given** the generator runs **When** it selects matches **Then** it only
  generates for matches kicking off within a look-ahead window (default 72h) OR
  finished within a look-back window (default 48h), capped at `MAX_PREVIEWS`
  (default 30) per run.
- **Given** a match's prompt inputs are unchanged since last run (same
  `content_hash`) **When** the generator runs **Then** it reuses the cached
  entry and makes **no** API call.

**US-1.5 — As the owner, an API failure never corrupts data or fails the build.**
- **Given** the Anthropic API errors / times out for a match **When** the
  generator processes it **Then** it logs the error, keeps that match's prior
  entry (or skips it), and continues; a total API outage leaves `previews.json`
  byte-identical and the step (which is `continue-on-error`) exits 0.

**US-1.6 — Injection-safe.** Prompt is built from typed numeric/enum data only
(team names from the canonical `teams.json` keyset, scores, probs). **No
free-text user input** ever reaches the prompt; rendered output is escaped via
`escapeHtml`. (Given the only string inputs are canonical team names already in
our data, there's no user-controlled injection surface.)

### Tasks (exact files/functions)

**New: `scripts/generate_previews.py`**
- `sys.path.insert` + `from _common import save_json, load_json, log, DATA_DIR`
  (mirror `scrape_referees.py` header).
- `main() -> int`:
  1. Read `ANTHROPIC_API_KEY` from env. If unset/empty: `log("ANTHROPIC_API_KEY
     unset — previews dormant; leaving previews.json unchanged"); return 0`.
  2. `import anthropic` inside a `try/except ImportError` — if the SDK isn't
     installed, log + `return 0` (keeps the build green if `requirements.txt`
     wasn't updated yet). SDK added to `scripts/requirements.txt`.
  3. Load inputs: `group_matchups.json`, `knockout_matchups.json`,
     `schedule_full.json` (kickoff_utc), `actual_results.json`, `h2h.json`,
     `form.json`, `xg.json`, `scorers.json`, `weather.json`, `forecast.json`,
     existing `previews.json`.
  4. `select_matches(now)`: build the candidate set = upcoming within
     `LOOKAHEAD_H` (default 72) from `schedule_full.kickoff_utc` that are NOT
     final, plus final-within `LOOKBACK_H` (default 48). Sort by kickoff
     proximity; truncate to `MAX_PREVIEWS` (default 30). All bounds via env
     (`PREVIEW_LOOKAHEAD_H`, `PREVIEW_LOOKBACK_H`, `PREVIEW_MAX`).
  5. For each candidate: `kind = "recap" if final else "preview"`;
     `inputs = collect_inputs(match_id, kind, …)` (a flat dict of the numeric
     fields above for that pair); `h = content_hash(kind, inputs)`
     (`hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()`).
  6. **Skip-if-unchanged**: if `prior[match_id].content_hash == h` and
     `prior[match_id].kind == kind`, reuse the prior entry (no API call).
  7. Otherwise `text = call_haiku(client, build_prompt(kind, inputs))` inside a
     per-match `try/except` (`anthropic.APIError`, `Exception`) → on error
     `log(...)`, keep prior entry if any, continue. `text` clamped to ≤ ~240
     chars + stripped.
  8. Write merged dict via `save_json("previews.json", out)` only if it changed
     vs the loaded copy (so a no-op run doesn't churn the diff / bump nothing);
     set `__meta__.updated_at`, `.model`. Prune entries for matches no longer in
     the candidate set + older than lookback (bound file growth) — optional,
     keep simple: keep all entries but only the most recent ~150.
- Helpers: `build_prompt(kind, inputs)` — a fixed system+user template:
  - System: "You are a concise football analyst. Write a single 1–2 sentence
    {preview|recap} (≤45 words). Data only. No betting advice. No markdown."
  - User: a compact `key: value` block of the typed fields (teams, group/stage,
    model win/draw/win %, predicted winner + confidence, xG a/b, last-3 form
    strings, h2h summary, top scorer per side, weather temp/precip for previews;
    final score + method for recaps). No instructions sourced from data.
  - Model: `claude-haiku-4-5` (latest Haiku; cheapest). `max_tokens=120`,
    `temperature=0.4`.
  - **Prompt caching** (per `claude-api` skill default): mark the static system
    block with `cache_control: {"type":"ephemeral"}` so the shared system prompt
    is cached across the ~30 calls in a run (cuts input cost).

**New: `data/previews.json`** — the empty stub above (committed so the loader
gets a 200).

**Edit: `scripts/requirements.txt`** — add `anthropic` (pinned, e.g.
`anthropic>=0.40`). Only this cron step imports it; all imports are
`try/except`-guarded so the rest of the pipeline is unaffected.

**Edit: `app/data-loader.js`**
- Add to `OPTIONAL_FILES`: `{ file: 'previews.json', fallback: {} }` (after
  `pipeline_status.json`, with a comment: dormant until ANTHROPIC_API_KEY set).
- Add to `fileToKey()`: `case 'previews.json': return 'previews';`.
- (Not force-fetched — previews change at most a few times/day with data.)

**New: `app/components/match-preview.js`** — `export function previewSection(
match, data)`:
- Derive `matchId` like `referee.js` (try both orientations).
- `const previews = data.previews || {}; const p = previews[matchId] ||
  previews[reverseId];`
- If `!p || !p.text` → `return document.createDocumentFragment()` (dormant: no
  section at all, per US-1.3). **Do NOT** use `emptyState()` here — an empty
  state would advertise an unshipped feature; the section simply doesn't exist.
- Else build a `<div class="section ai-preview-section" data-testid="ai-preview"
  data-kind="${p.kind}">` with `<h2>` = `p.kind === 'recap' ? 'Recap' :
  'Preview'`, a `<p>` with `escapeHtml(p.text)`, and a muted caption
  `AI-generated · ${escapeHtml(p.model||'Claude Haiku')} · ${relative time}`
  using `formatLastUpdated` from `data-loader.js` (already exported).
- All copy via `escapeHtml`; no `innerHTML` with untyped data.

**Edit: `app/views/matchup-detail.js`**
- `import { previewSection } from '../components/match-preview.js';`
- Insert one line. Placement: a **preview** belongs high (near the model grid),
  a **recap** belongs near the result. Simplest single insertion that satisfies
  both: append `previewSection(match, data)` once, immediately after the
  model+market grid block / `liveWinProbability` (≈ line 199) and before
  "Your pick". The section self-labels Preview vs Recap from `p.kind`, so one
  call covers both — no second insertion needed. (Rationale: keeps the diff to
  one import + one append; ordering is acceptable per US-1.2.)

**Edit: `app/styles.css`** — minimal `.ai-preview-section p { … }` reusing
existing `--text`/`--muted` tokens + the `.section` spacing already in use; a
small "AI" pill style reusing `.upset-badge`/caption patterns. No new tokens.

**Edit: `.github/workflows/daily_update.yml`** AND
`.github/workflows/frequent_update.yml`
- Add a step **after** the model rebuilds (composite/hybrid/xg/knockout) and
  **before** validate, so the prompt sees fresh probs:
```yaml
- name: Generate AI match previews/recaps (dormant without key)
  run: python scripts/generate_previews.py
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  continue-on-error: true
```
- Recommend it in **daily** only first (1×/day bounds cost hardest) and
  **optionally** frequent (hourly) — see OPEN QUESTIONS. The
  skip-if-unchanged hash means hourly adds little incremental cost once daily
  has primed the cache, but the safe default is **daily-only**.
- `previews.json` is already covered by the existing `git add data/` commit
  steps in both workflows — no commit-step change needed. It is NOT one of the
  deterministic regenerators in the rebase-conflict reconcile block; on the rare
  conflict it simply takes the freshly-pulled sibling copy, which is fine
  (previews are advisory, not scored).

### Edge cases
- **No key / SDK missing** → dormant, exit 0, file unchanged (US-1.3/1.5).
- **Match flips upcoming→final between runs** → `content_hash` includes `kind`,
  so the entry regenerates as a recap (the hash changes).
- **Unmodeled fixture** (schedule-only row, no probs) → still previewable from
  form/h2h/xG/weather; prompt omits absent fields. If literally no inputs,
  skip the match (no degenerate prompt).
- **Knockout pre-resolution** (placeholder teams like "1A") → excluded because
  `select_matches` keys off real `match_id`s present in
  group/knockout_matchups, never placeholders.
- **Diacritics / non-ASCII team names** → prompt is UTF-8; `save_json`'s
  `ensure_ascii=True` stores `\uXXXX`, matching every other data file (no diff
  churn). Render path uses `escapeHtml` on already-decoded JS strings.
- **Stale recap after a correction** → hash includes the final score/status, so
  a results correction regenerates the recap.
- **API returns markdown/over-long text** → strip markdown, clamp length
  server-side before write.
- **partial-day rate spike** → `MAX_PREVIEWS` cap + 5s isn't needed (Anthropic,
  not a scraped host), but a small `time.sleep(0.2)` between calls is courteous.

### QA test scripts

**`tests/feature/rj30_1-previews-render.test.mjs`** (node:test, DOM-free + jsdom
where needed — mirror `refs-render.test.mjs` which is pure-logic). Import
`previewSection` from `app/components/match-preview.js`. Use a minimal DOM shim
(the existing UX specs cover real-DOM; feature tests here assert the contract).
Prefer a pure helper if we factor one out; otherwise assert via a lightweight
`linkedom`/`jsdom`-free check of the returned node type:
- `test('no preview entry → empty fragment (dormant)')`: `data.previews = {}`
  → `previewSection(match, data)` returns a node with `childNodes.length === 0`
  / `nodeType === 11` (DocumentFragment). Assert no `[data-testid=ai-preview]`.
- `test('preview entry → Preview heading + escaped text')`: entry
  `{kind:'preview', text:'<b>x</b> Mexico edge it', model:'claude-haiku-4-5',
  generated_at:'…'}` → node contains `data-testid="ai-preview"`,
  `data-kind="preview"`, `<h2>` text `Preview`, and the `<b>` is escaped
  (assert the rendered HTML contains `&lt;b&gt;`, not a real element).
- `test('recap entry → Recap heading')`: `{kind:'recap', …}` → `<h2>` = `Recap`,
  `data-kind="recap"`.
- `test('reverse-orientation match_id resolves')`: entry keyed
  `B__vs__A`, match `{team_a:A, team_b:B}` → renders.

**`tests/feature/rj30_1-generate-previews.test.mjs`** (node:test): assert the
**data contract + skip-logic** without the SDK. Shell out to a tiny pure-Python
import is awkward from node; instead lock the JS-visible contract:
- Validate `data/previews.json` parses, has `__meta__`, and (in the dormant
  shipped state) has no match entries / `__meta__.updated_at === null`.
- Assert `data-loader.js` exposes `previews` via `fileToKey` (import the module,
  call `fileToKey('previews.json')` if exported, else assert the OPTIONAL_FILES
  list includes it by reading the file text and regex-matching — mirror the
  pattern in existing loader tests like `rj30-*` feed tests).

**`tests/feature/rj30_1-generate-previews-py.test.mjs`** (node:test, drives
Python via `child_process.execFileSync('python3', ['scripts/generate_previews.py'])`
with `env: { ...process.env, ANTHROPIC_API_KEY: '' }` — mirror how other
feature tests invoke scripts if any do; otherwise keep this as the dormant
proof):
- `test('runs dormant with no key → exit 0, previews.json unchanged')`:
  snapshot `data/previews.json` mtime+bytes, run the script with empty key,
  assert exit 0 and bytes unchanged.
- (Optional, gated) a `--selftest` flag in the script that exercises
  `select_matches` + `content_hash` deterministically with a fixed `now` and a
  fake responder, asserting: only in-window matches selected, cap respected,
  unchanged-hash short-circuits the (stubbed) API call. This keeps the
  cost/selection logic regression-tested with **no** network.

**`tests/ux/rj30_1-previews.spec.mjs`** (Playwright, 390×844 — mirror
`refs-section.spec.mjs`'s `routeJson` interceptor):
- `test('preview section renders + fits 390px')`: route `previews.json` to a
  fixture with a `preview` entry for `Mexico__vs__South Africa`; goto
  `/#/matchup/team_a/Mexico/team_b/South%20Africa`; assert
  `page.locator('[data-testid=ai-preview]')` visible, `<h2>` text `Preview`,
  text visible; assert `document.documentElement.scrollWidth <= 390`.
- `test('recap entry shows Recap heading')`: fixture `{kind:'recap'}` →
  `[data-testid=ai-preview][data-kind=recap]` visible, heading `Recap`.
- `test('empty previews.json → no AI section (dormant)')`: route
  `previews.json` to `{}`; assert `page.locator('[data-testid=ai-preview]')`
  has count 0 and the rest of the matchup page still renders (referee/h2h
  present) — proves graceful dormancy with no regression.

### iOS / UX notes
- New section uses the existing `.section` block (same vertical rhythm, safe-area
  insets inherited). Single short paragraph → no horizontal overflow at 390px;
  the spec asserts `scrollWidth <= 390`.
- Caption uses muted token + small font like the other "source/updated" captions
  (`scorers`, `availability` notes) — consistent, not novel.
- Dormant = literally no DOM node, so dynamic-type/VoiceOver users get zero
  noise from an unshipped feature (better than an empty-state announcement).
- When live, the `<p>` is plain text → readable by VoiceOver in one pass; the
  "AI-generated" caption sets honest provenance.

### Files touched / new (Item 1)
- New: `scripts/generate_previews.py`, `data/previews.json`,
  `app/components/match-preview.js`,
  `tests/feature/rj30_1-previews-render.test.mjs`,
  `tests/feature/rj30_1-generate-previews.test.mjs`,
  `tests/feature/rj30_1-generate-previews-py.test.mjs`,
  `tests/ux/rj30_1-previews.spec.mjs`.
- Edit: `scripts/requirements.txt`, `app/data-loader.js`,
  `app/views/matchup-detail.js`, `app/styles.css`,
  `.github/workflows/daily_update.yml`, `.github/workflows/frequent_update.yml`.

---

## ITEM 2 — Referee-Bias Expansion (richer ref panel)

`data/referees.json` is now seeded (directory of officials; assignments arrive
24–48h before kickoff). Expand `app/components/referee.js` to surface a richer,
graceful panel using the data the directory + `ref-bias.js` already provide,
**without changing the data contract** (the scraper, `ref-bias.js` z-score
logic, and the `data-loader` wiring all stay as-is). This is a presentation
enhancement only.

What "richer" means here (all from existing fields; no new pipeline):
1. **Directory line always shown** when a ref is assigned: name, nationality
   (with flag if cheaply derivable), confederation, `stats.matches_officiated`
   when present (already partially done — make it robust to missing `stats`).
2. **Per-team bias cards** with clearer copy: show `n` (sample size), the
   confidence tier, and the cards/penalties z-score sentence in plain language
   ("gives ~X% more cards than average" derived from the existing `mean_cards`
   vs `LEAGUE_CARDS_MEAN`, not raw σ jargon) — but **keep** the σ line for power
   users. Reuse `formatStd`.
3. **Confederation lean** sentence (already present) — harden the empty/`null`
   branch and the confidence→severity mapping.
4. **Empty-history graceful**: when a ref is assigned but has `history: []`
   (the common pre-tournament state), show the directory line + a single muted
   "No prior-match history yet — bias indicators appear once history is
   populated." instead of two bare "No prior matches" cards. (Today two empty
   cards render; collapse to one honest note.)
5. **Unassigned**: keep the existing "Not yet announced — typically confirmed
   24–48 h before kickoff." (already correct; lock it with a test).

### User stories + ACs

**US-2.1 — As a fan, when a ref is assigned I see who they are.**
- **Given** `match_referees.json` maps the fixture to a `ref_id` present in
  `referees.json` **When** I open the matchup **Then** the Referee section shows
  the ref name (escaped), nationality, confederation, and matches-officiated
  when present.
- **Given** `ref.stats` is absent/`{}` **When** the header renders **Then** no
  "matches officiated" fragment appears and nothing throws.

**US-2.2 — As a fan, I see per-team bias indicators with honest confidence.**
- **Given** the ref has ≥1 prior match vs a team **When** the bias card renders
  **Then** it shows `n`, the confidence tier (high≥5 / medium 2–4 / low ≤1), and
  the cards + penalties σ line.
- **Given** the ref has `0` prior matches vs **both** teams (`history` empty or
  no overlap) **When** the section renders **Then** a single muted "No
  prior-match history yet…" note appears (not two empty cards), and the
  directory header still shows.

**US-2.3 — As a fan, I see a confederation lean when it's computable.**
- **Given** the ref's history touches both own-confed and other-confed teams
  **When** the lean renders **Then** the "tends to give X% more/fewer cards to
  {confed} teams" sentence shows with a confidence badge.
- **Given** the history is one-sided (only own OR only other) **When** computed
  **Then** `confederationLean` returns `null` and **no** lean block renders (no
  crash, no "NaN%").

**US-2.4 — Diacritics render correctly.** Ref/team names with non-ASCII
(`Türkiye`, `Côte d'Ivoire`, `Szymon Marciniak`) display the correct glyphs and
are HTML-escaped.

**US-2.5 — Knockout assignments unpublished → graceful.** A resolved knockout
fixture with no entry in `match_referees.json` shows "Not yet announced".

### Tasks (exact files/functions)

**Edit: `app/components/referee.js`** (only file with logic changes)
- Harden the header: guard `ref.stats?.matches_officiated` (already optional-
  chained — keep), and tolerate `ref.confederation === ''`.
- Replace the bias loop: compute `hA = teamHistory(ref.history, match.team_a)`
  and `hB = teamHistory(ref.history, match.team_b)` once. If **both** `hA.n===0`
  and `hB.n===0`, render the single muted "No prior-match history yet…" note
  instead of two empty `biasCard`s. Otherwise render the per-team cards as today
  (each `biasCard` still handles its own `n===0` branch for the mixed case where
  one team has history and the other doesn't).
- In `biasCard`, add a plain-language line **above** the σ rows: derive an
  approximate "% vs average" from `h.mean_cards`/`LEAGUE_CARDS_MEAN` — but those
  constants live in `ref-bias.js` and aren't exported. **Minimal-change
  option (recommended):** export the means from `ref-bias.js`
  (`export const LEAGUE_CARDS_MEAN = 2.9;` etc.) and import them, OR have
  `teamHistory` also return `cards_delta_pct`/`pens_delta_pct` (preferred: keeps
  the constant private and gives the renderer a ready number). Add to the
  `teamHistory` return: `cards_delta_pct = n ? (mean_cards-LEAGUE_CARDS_MEAN)/
  LEAGUE_CARDS_MEAN*100 : null` (and pens analogously). This is an **additive**
  field — existing consumers/tests unaffected.
- Keep `renderDeltaSentence`, `formatStd`, the confidence→severity map.
- `app/ref-bias.js`: add the two `*_delta_pct` fields to `teamHistory`'s return
  (additive only). No change to `confederationLean`/`cardsAgainstTeam`/
  `penaltiesAgainstTeam`/`buildTeamConfedLookup`.

**Edit: `app/styles.css`** — only if the new "no history yet" note or the
plain-language line needs spacing; reuse `.muted`, `.ref-bias-card`,
`.bias-row`. Likely a 1–3 line addition, no new tokens.

(No scraper, no `data-loader`, no workflow changes — the data already flows.)

### Edge cases
- **Empty history** (assigned ref, `history:[]`) → single muted note (US-2.2),
  not two empty cards. Locked by a test.
- **One team has history, the other doesn't** → mixed: a real card for one,
  the per-card "No prior matches with this ref." for the other (existing
  branch). The "both empty" collapse must NOT trigger here.
- **Diacritics** → `escapeHtml` on display; slug-keyed lookup is ASCII-folded in
  the scraper so it still resolves (`Côte d'Ivoire` → folded slug). Renderer
  shows the original Unicode `name`.
- **Knockout assignment unpublished** → no `match_referees` entry → "Not yet
  announced" (US-2.5).
- **`confederationLean` NaN guard** → division-by-zero already guarded
  (`otherAvgCards > 0 ? … : null`); one-sided history → `null`. Lock with a test
  (already exists in `refs-render.test.mjs` — extend, don't duplicate).
- **Unknown confederation for a team** → `buildTeamConfedLookup` returns `null`,
  that team is excluded from the lean tally (existing behavior).
- **`stats` missing / `matches_officiated` 0** → header omits the fragment.

### QA test scripts

**Extend `tests/feature/refs-render.test.mjs`** (node:test, pure logic — already
imports `teamHistory`, `confederationLean`, `buildTeamConfedLookup`):
- `test('teamHistory returns additive cards_delta_pct/pens_delta_pct')`: a
  6-row history with above-average cards → `h.cards_delta_pct` is a positive
  number; empty history → `cards_delta_pct === null` (locks the additive field).
- `test('both-empty detection: hA.n===0 && hB.n===0')`: `teamHistory([], A)` and
  `teamHistory([], B)` both `n===0` — the exact condition the renderer collapses
  on. (Keeps the logic contract even though the DOM branch is asserted in UX.)
- Keep the existing high/medium/low + one-sided-`null` tests.

**Extend `tests/feature/refs-directory.test.mjs`** (node:test — validates the
`referees.json` shape/contract): add assertions that a directory entry tolerates
missing `stats`/empty `history` (the seeded state) without the consumer needing
those keys — i.e. assert the loader fallback `{}` and the `__meta__`-only file
are valid inputs the renderer accepts. (Read the existing file first; mirror its
style — don't duplicate its directory-shape checks.)

**Extend `tests/ux/refs-section.spec.mjs`** (Playwright, 390×844 — already has
the assigned-ref + empty-directory cases):
- `test('assigned ref with empty history → single "no history yet" note')`:
  route `referees.json` to a fixture with the ref present but `history:[]`,
  `match_referees.json` mapping the fixture → assert exactly **one**
  `.ref-bias-empty`/muted note (new `data-testid="ref-history-empty"`), NOT two
  empty `.ref-bias-card`s, AND the `.ref-header strong` name is visible.
- `test('assigned ref with real history → bias cards + lean render')`: fixture
  with `history` rows touching ≥2 confederations and ≥2 matches vs `Mexico` →
  assert `.ref-bias-card` count == 2, a confidence badge visible, and the
  confederation-lean sentence text matches `/tends to give/i`; assert
  `scrollWidth <= 390`.
- `test('diacritics ref name renders')`: ref name `Côte d'Ivoire`-style /
  `Mağ…` → assert the exact Unicode string visible (not mojibake / not
  `&#…;` literal).
- Keep the existing assigned + "Not yet announced" cases.

Add `data-testid="ref-history-empty"` to the new collapsed note in
`referee.js` so the spec has a stable selector (mirrors the repo's
`data-testid` convention used across `final-result`, `advance-headline`,
`match-availability`, `ai-preview`).

### iOS / UX notes
- All additions live inside the existing `.section` / `.ref-bias-card` grid
  (`.ref-biases` is `display:flex/grid` in `styles.css` line 1021) — they wrap
  at 390px; the spec asserts no horizontal scroll.
- Collapsing two empty cards into one note **reduces** vertical clutter on the
  most common pre-tournament state (net UX win, not a regression).
- σ jargon kept but demoted under a plain-language line → readable for casual
  fans, still precise for power users. Honest provenance: "from ref history,
  n=…".
- Confidence badge reuses `.upset-badge sev-*` tokens already on the page — no
  new color.

### Files touched / new (Item 2)
- Edit: `app/components/referee.js`, `app/ref-bias.js` (additive return fields),
  `app/styles.css` (minor).
- Edit (extend, don't add): `tests/feature/refs-render.test.mjs`,
  `tests/feature/refs-directory.test.mjs`, `tests/ux/refs-section.spec.mjs`.

---

## OPEN QUESTIONS (choice + recommendation)

**Q1 — AI preview token-cost estimate + key handoff (Item 1).**
Sizing: ~104 total matches across the tournament, but the generator only ever
touches matches in a 72h-ahead / 48h-back window → typically **5–15 matches per
run**, capped at 30. Per call: system prompt ~250 tokens (cached after the first
call in a run), per-match user data ~200–350 input tokens, output ≤120 tokens.
Claude Haiku pricing ≈ $0.80/M input, $4/M output (order-of-magnitude).
- One run, 15 matches: input ≈ 15×500 = 7.5K tok (less with system caching),
  output ≈ 15×100 = 1.5K tok → **≈ $0.012 (about 1¢) per run.**
- **Daily-only** for the whole 39-day tournament ≈ 39 runs × ~1¢ ≈ **$0.40
  total**, and far less in practice because skip-if-unchanged short-circuits
  most matches.
- **Hourly (frequent_update)** would call ~24×/day, but the content-hash means
  only matches whose probs/score changed regenerate → realistically a few extra
  cents/day. Upper bound (worst case, every hour every in-window match
  regenerates, 15 matches): 24×1¢ ≈ $0.24/day ≈ **$9 total** — still trivial.
- **Recommendation:** wire the step into **daily_update.yml only** to start
  (hard cost ceiling ~$0.40 for the event), and ALSO add it to
  `frequent_update.yml` but **gated dormant** (no key) so flipping to hourly
  later is just a secret toggle — no code change. Net: ship the step in both
  workflows, recommend the owner leave it daily-effective by simply not relying
  on the hourly cadence; the hash makes hourly safe if desired.
- **Key handoff (manual step for the owner):**
  1. Go to GitHub → repo **liddar12/wc2026-tracker** → Settings → Secrets and
     variables → Actions → **New repository secret**.
  2. Name: `ANTHROPIC_API_KEY` — Value: your Anthropic API key (`sk-ant-…`).
  3. Save. Next daily cron (06:00 UTC) populates `data/previews.json`; verify in
     the commit diff or on a matchup page.
  - Confirmation block to paste back:
    - Secret added: yes / no
    - First preview seen on a matchup page: yes / no
    - Anything unexpected: ______
- **No client-side key, ever** — generation is server-side in the cron; the PWA
  only fetches the static `previews.json`. (Confirmed: the only client config is
  `app/preview-config.js`, which is the Supabase anon key — unrelated.)

**Q2 — Haiku model pin.** Recommend `claude-haiku-4-5` (latest, cheapest capable
Haiku as of the 2026 cutoff) pinned in `generate_previews.py` + surfaced in
`__meta__.model`. Alternative: a dated snapshot for full reproducibility.
**Recommendation: pin the alias, store the resolved model id in `__meta__` and
each entry** so we can audit which model wrote each line.

**Q3 — Preview vs recap section placement.** (a) Single insertion after the
model grid, self-labeling Preview/Recap (1-line diff). (b) Two insertions —
preview high, recap next to "Final result". **Recommendation: (a)** — minimal
diff, ordering is acceptable, and most users scroll the whole detail page.

**Q4 — Ref plain-language % source.** (a) Export `LEAGUE_*` means from
`ref-bias.js`. (b) Return additive `*_delta_pct` from `teamHistory`.
**Recommendation: (b)** — keeps the priors private and is purely additive, so no
existing test/consumer changes.

**Q5 — Frequency of the previews step.** daily-only vs daily+hourly. Covered in
Q1. **Recommendation: ship in both workflows, dormant, effective-daily.**

## iOS RISKS (both items)
- **Horizontal overflow at 390px** — long AI sentences or long ref/team names
  could push width. Mitigation: single short paragraph (server clamps ≤45 words
  / ≤240 chars), `word-break`/normal wrapping in `.section`; every UX spec
  asserts `document.documentElement.scrollWidth <= 390`.
- **VoiceOver noise from a dormant feature** — avoided by returning an empty
  `DocumentFragment` (no `role="status"` node) when there's no preview, so
  nothing is announced until the feature is live.
- **No new tokens/components** → no theme/dark-mode regression risk; both items
  reuse `.section`, `.muted`, `.upset-badge`, `--text`/`--muted`.
- **Safe-area / dynamic type** — inherited from `.section`; no fixed heights
  added.
- **Service worker / freshness** — `sw.js` is a pure cache-purger and `_headers`
  governs freshness; `previews.json` is a normal `data/*.json` fetched
  `no-cache` by `data-loader.js`, so no caching gotcha.
