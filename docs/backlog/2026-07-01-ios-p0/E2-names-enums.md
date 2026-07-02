# E2-names-enums — Team names never clip + raw enums never leak (A2 + A3)

**Epic id:** `E2-names-enums` · **Release:** 2026-07-01 iOS P0 (Track A, one batched release)
**Goal:** No proper noun is ever ellipsized mid-word (`ENGLA…`, `DR CO…`), and no snake_case enum (`round_of_32`) or `STATUS_*` token ever renders as UI text. Presentation-only + one additive shared helper each — **zero data/feature removal** (hard owner constraint).
**Spec refs:** §3 A2, §3 A3, §8 (Dynamic Type / VoiceOver "wrap, don't clip"), Appendix A → Home P0 (truncated hero names), venue-detail P0 (raw `round_of_32` pills).

**Files this epic touches (all verified to exist):**
- `app/lib/team-names.js` — extend with FIFA-code map + `fifaCode()` (no map exists today; `team-flag.js` only has ISO-2 for emoji)
- `app/lib/stage-labels.js` — **NEW** shared stage-humanize helper
- `app/components/large-match-card.js` (name render :110–120, local `prettyStage` :251)
- `app/views/venue-detail.js` (raw leak at :82)
- `app/views/home-view.js` (local `prettyStage` :567)
- `app/views/matchup-detail.js` (local `prettyStageName` :408)
- `app/calendar-export.js` (local `prettyStage` :62)
- `app/bracket-resolver.js` (`STAGE_LABELS` :15 — becomes re-export of the shared helper's map)
- `app/views/play-view.js` (`pw-bracket-name` :613/:618)
- `app/components/projected-bracket-tree.js` (T3: bracket slot renderers emitting `.eb-team-name` switch to `fifaCode(name) || shortTeamName(name)`) — **E6-wheel adds the layout toggle and exports OVERRIDES from this file — E2 T3 lands before E6 T1.2/T3.1 (canonical order E2 → E6)**
- `app/styles.css` (`.lcard-team-name` :2493, `.eb-team-name` :1749, `.hmr-teams` :1806, `.winner-team` :1289)
- `app/lib/i18n.js` (+ `app/lib/strings.es.js`) — wire existing unused `stage.*` keys (i18n.js:91–96, strings.es.js:73–78)
- Tests: `tests/feature/r13-team-names.test.mjs` (extend), `tests/feature/e2-stage-labels.test.mjs` (new), `tests/ux/e2-names-enums.spec.mjs` (new)

**Shared files (other epics likely touch — coordinate via PM):** `app/styles.css` (every visual epic), `app/components/large-match-card.js` (E1 T1.3 + A4/A5/A9 follow-on epics), `app/views/home-view.js` (E1 T2.2, E4 T4.x, A7 empty states), `app/views/matchup-detail.js` (E3 whole epic, E1 T2.4, A4/A5), `app/components/projected-bracket-tree.js` (**E6-wheel adds the layout toggle and exports OVERRIDES from this file — E2 T3 lands before E6 T1.2/T3.1, canonical order E2 → E6**), `app/lib/team-names.js` (E4 adds `slotLabel`, E6 read-only consumer), `app/lib/i18n.js` + `app/lib/strings.es.js` (any epic adding copy).

**Cross-epic shared-file map (canonical, identical in all six epic files — the PM builds the collision schedule from this):**
- `app/views/matchup-detail.js` — touched by E3 (whole epic), E2 T5, E1 T2.4 · land order: **E3 → E2 T5 → E1 T2.4**
- `app/views/home-view.js` — touched by E4 T4.1/T4.2, E2 T3/T5, E1 T2.2 · land order: **E4 T4.x → E2 T3/T5 → E1 T2.2** (E4's Today-section structure change lands before E1's type ramp; E2's hmr-row wrap change rebases on E4's Today-section restructure)
- `app/components/large-match-card.js` — touched by E1 T1.3 ('TODAY'→'Today' + pill CSS), E2 T2/T5 (team-cell rewrite) · land order: **E1 T1.3 → E2 T2/T5** (E2's team-cell rewrite rebases on E1's landed 'Today' string so E1's source-string test stays green)
- `app/components/projected-bracket-tree.js` — touched by E2 T3 (slot-name rendering → `fifaCode(name) || shortTeamName(name)`), E6 (layout toggle in `paint()`/`renderStageNav` + exporting/moving module-level `OVERRIDES`, projected-bracket-tree.js:32) · land order: **E2 T3 → E6 T1.2/T3.1** (canonical order E2 → E6; rebase E6 on E2's landed text change)
- `app/lib/team-names.js` — additive exports only: **E2 T1 (`fifaCode`) → E4 (`slotLabel`)**; E6 is a read-only consumer and never edits this file

**Build gotchas that bind every task:** `renderView()` rebuilds `root.innerHTML` — all Playwright assertions must run after navigation settles and re-assert after one hash re-navigation. Playwright `webServer` stays ThreadingHTTPServer (`tests/playwright.config.mjs:36`) — do not touch. Status-gating untouched: this epic never reads/writes result logic, only labels.

---

## Story S1 — As a fan, I can always read who is playing, even on the smallest card at the largest text size

### Task T1 · FIFA 3-letter code helper (additive, shared)
**Description:** No FIFA-code map exists in the repo (checked `app/`, `data/teams.json` — teams keyed by name, no `code` field). Add to `app/lib/team-names.js` (keeps the existing R13 short-name module as the single team-display module): a `FIFA_CODES` map covering **all 48 teams in `data/teams.json`** with official FIFA trigrams (ENG, COD, USA, KSA, CIV, RSA, KOR, …) plus display/ESPN variants already handled elsewhere (`Türkiye`/`Turkiye`, `United States`, `IR Iran`, `Korea Republic`/`South Korea`, `Cote d'Ivoire` both spellings — mirror the variant keys in `team-flag.js:5–81` and `ENGLISH_NAMES`). Export `fifaCode(name)` → 3-letter uppercase string, or `''` for unknown/unresolved inputs (`'W79'`, `'2A'`, `'Winner 79'`, `''`, `null`) so callers keep their existing placeholder text. DISPLAY ONLY — never a data key (same rule as `ENGLISH_NAMES`, team-names.js:45).
**Files:** `app/lib/team-names.js`, `tests/feature/r13-team-names.test.mjs`.
**Acceptance criteria:**
- [ ] `fifaCode('England') === 'ENG'`, `fifaCode('DR Congo') === 'COD'` (exact spec tokens, §3 A2)
- [ ] Every one of the 48 keys of `data/teams.json` resolves to a unique `/^[A-Z]{3}$/` code
- [ ] ESPN/display variants resolve to the same code as their canonical name (`Turkiye`→TUR, `United States`→USA, `South Korea`→KOR, both `Côte d'Ivoire` spellings→CIV)
- [ ] Unresolved-slot inputs (`'W79'`, `'2A'`, `''`, `null`, `undefined`) return `''` — never a fake trigram
- [ ] No existing export changes signature (`shortTeamName`, `tinyTeamName`, `englishName` untouched — no regression)
**Edge cases:** unresolved knockout slots (W79/W80, "3rd Group C"); RENAMES-map spellings (CLAUDE.md team-name normalization rule); names with diacritics/apostrophes; null match objects.
**QA script (automated):** extend `tests/feature/r13-team-names.test.mjs` — new `E2:` test block: load `data/teams.json`, iterate all 48 names asserting `/^[A-Z]{3}$/` + uniqueness (Set size 48); exact-value asserts for ENG/COD/USA/TUR/KOR/CIV incl. variants; `''` for the unresolved-slot list; assert the three legacy exports still behave (re-run one R13 assertion each). Covers 5/5 criteria — 100% automated.
**Estimate:** S. **Dependencies:** none.

### Task T2 · Hero/large match card: flag + code anchor, names wrap — never mid-word ellipsis
**Description:** The Home hero result card renders `shortTeamName()` into `.lcard-team-name` (`large-match-card.js:114/118`) which is `white-space:nowrap; text-overflow:ellipsis` (`styles.css:2493–2503`) → the audited `ENGLA…`/`DR CO…` P0. Change the card's team cell to the spec anchor: emoji flag + `fifaCode(name)` as the always-fits primary line, full team name (`englishName`, NOT shortened) as a secondary line that **wraps** (`overflow-wrap:break-word`, max 2 lines via `-webkit-line-clamp:2` with `display:-webkit-box` — no `text-overflow:ellipsis` on a single nowrap line). When `fifaCode()` returns `''` (unresolved slot), render the existing placeholder text unchanged. Keep the winner ✓ suffix (`styles.css:2540–2550`) attached to the code line so the non-color winner cue survives (WCAG 1.4.1 — do not regress `winner-highlight.test.mjs` / `rj30-winner-highlight.spec.mjs`). Keep `title` attr with the full name.
**Files:** `app/components/large-match-card.js`, `app/styles.css`.
**Acceptance criteria:**
- [ ] At 390×844, England vs DR Congo hero card shows flag + `ENG` / `COD`; full names visible, wrapped, no `…`
- [ ] No `.lcard-team-name` (or successor class) computes `text-overflow: ellipsis` + `white-space: nowrap` together
- [ ] Winner card keeps accent color + ✓ ::after cue (existing tests stay green)
- [ ] Unresolved slots (W79 etc.) render exactly as today — no blank cell, no fake code
- [ ] At emulated Dynamic Type XL (root `font-size:20px`), no team cell overflows its box (`scrollWidth <= clientWidth`)
- [ ] No feature/data regression: score, kickoff, status pill, method tag (FT/AET/pens), tap-through all unchanged
**Edge cases:** dark mode (winner accent contrast on dark surface); pen/ET decided cards (method tag from `methodOfVictory` must stay adjacent — canonical statuses in `app/lib/match-status.js`); live cards (LIVE pill + minute); longest names (Bosnia and Herzegovina); RTL-safe order of flag+code; re-render survival (card re-paints on live poll).
**QA script (automated):** new `tests/ux/e2-names-enums.spec.mjs` — viewport 390×844: goto `#/home`, locate hero card, assert `getByText('ENG')` + `getByText('COD')` (or fixture-equivalent teams from `data/actual_results.json`), assert no element in the card has `textContent` ending in `…`, and `page.$$eval` on team cells asserting `scrollWidth <= clientWidth`; second pass after `page.addStyleTag({content:'html{font-size:20px}'})` + hash re-navigation (renderView rebuild) re-asserting both. Plus feature-level: extend `tests/feature/r13-team-names.test.mjs` asserting `large-match-card.js` source contains `fifaCode(` and no longer calls `shortTeamName(` for the name cell. Manual smoke (1 line): iPhone Settings → larger accessibility sizes → Home hero readable. ~90% automated.
**Estimate:** M. **Dependencies:** T1. Land order on this file: E1 T1.3 → E2 T2/T5 (rebase on E1's landed 'Today' string); coordinate with A4/A5/A9 follow-on epics (same file).

### Task T3 · Sweep the remaining ellipsizing name surfaces
**Description:** Audit every CSS rule that ellipsizes a team name (verified today: `.eb-team-name` styles.css:1749 bracket slots, `.hmr-teams` :1806 home match rows, `.winner-team` :1289, `.pw-bracket-name` play-view.js:613/618, `.pw-standings-name` :1700). Rule per spec: narrow fixed-width chips (bracket slots, play-view bracket) switch text to `fifaCode(name) || shortTeamName(name)`; row layouts with flexible width (`hmr-teams`, winner banner) drop `nowrap` and wrap instead. Person names (leaderboard `.lb-name`, `.fav-name`) are OUT of scope — only proper-noun team names. Do not touch the bracket resolver logic — display strings only at the render call sites.
**Files:** `app/styles.css`, `app/views/play-view.js`, `app/views/home-view.js` (hmr rows), bracket slot renderers that emit `.eb-team-name` (`app/components/projected-bracket-tree.js`).
**Acceptance criteria:**
- [ ] Bracket slot chips show `/^[A-Z]{3}$/` code (or existing "Waiting…" placeholder) — never a mid-word `…`
- [ ] Home "recent results" rows wrap; no `…` at 390px for `Bosnia and Herzegovina vs Trinidad and Tobago`
- [ ] Zero visual/behavior change for names that already fit (Brazil, Japan)
- [ ] What-if override taps on bracket slots still work after the text change (delegated listeners survive `renderView()` innerHTML rebuild)
- [ ] No feature/data regression: favorites ★, your-pick badges, confidence pills all still render in the same slots
**Edge cases:** unresolved slots ("Waiting…", W-numbers) untouched; dark mode chip contrast; Dynamic Type XL; live-poll re-render of home rows; Spanish locale (names are proper nouns — unlocalized, but surrounding labels via `t()` must not shift).
**QA script (automated):** extend `tests/ux/e2-names-enums.spec.mjs` — for routes `#/home`, `#/projected`, `#/bracket`: `page.$$eval('[class*=team-name],.hmr-teams,.winner-team,.pw-bracket-name', els => els.filter(e => e.scrollWidth > e.clientWidth).length)` must be 0 at 390px and at the 20px-root Dynamic-Type pass; on `#/projected` tap a slot and assert the override paint still fires (reuse pattern from `tests/ux/projected-bracket.spec.mjs`). Covers all criteria except pure visual "no change for short names" → 1-line manual smoke: eyeball Brazil rows on Home. ~90% automated.
**Estimate:** M. **Dependencies:** T1, T2 (shares the CSS approach). Sequencing: T3's `projected-bracket-tree.js` change lands BEFORE E6 T1.2/T3.1 (E6 adds the layout toggle + exports OVERRIDES from the same render paths — canonical order E2 → E6).

---

## Story S2 — As a fan, I never see developer identifiers like `round_of_32` in the UI

### Task T4 · Shared `stageLabel()` humanize helper (single source of truth)
**Description:** Four duplicated implementations exist today: `calendar-export.js:62` (regex chain), `large-match-card.js:251` (short: R32/Bronze), `home-view.js:567` (short: R32/QF/SF/3rd), `matchup-detail.js:408` (full, falls back to "Knockout stage"), plus `STAGE_LABELS` in `bracket-resolver.js:15`. Create `app/lib/stage-labels.js` exporting `stageLabel(stage, { style = 'full' | 'short' } = {})` and the canonical `STAGE_LABELS` map. `full` style routes through the **already-defined but currently unused** i18n keys `stage.r32/r16/qf/sf/final/third` (i18n.js:91–96; Spanish exists at strings.es.js:73–78) so ES localization comes free — add the two missing keys (`stage.group` → "Group Stage", short-style keys) to BOTH `i18n.js` and `strings.es.js`. `group` + a group letter renders "Group A". **Unknown/missing stage returns a humanized fallback (Title Case, underscores→spaces) — never the raw token.** `bracket-resolver.js` re-exports the shared map (keep its export name — `STAGE_ORDER` consumers in bracket views must not break).
**Files:** `app/lib/stage-labels.js` (new), `app/bracket-resolver.js`, `app/lib/i18n.js`, `app/lib/strings.es.js`.
**Acceptance criteria:**
- [ ] `stageLabel('round_of_32')` → `Round of 32`; `stageLabel('round_of_32',{style:'short'})` → `R32` (spec tokens §3 A3)
- [ ] All six knockout enums + `group_stage`/`group` map in both styles; `third_place` full → "Third-place playoff"
- [ ] Unknown input (`'weird_new_stage'`) → `"Weird New Stage"`, never containing `_`
- [ ] ES locale returns the strings.es.js values ("Dieciseisavos" for r32)
- [ ] `bracket-resolver.js` `STAGE_LABELS`/`STAGE_ORDER` exports unchanged in name and shape (no regression for bracket views/scoring paths)
**Edge cases:** null/undefined/'' stage → '' ; i18n fallback chain (`ES[key] ?? EN[key] ?? humanize(key)`, i18n.js:14) must not emit a dot-key; no circular import (lib module must not import from `bracket-resolver.js`).
**QA script (automated):** new `tests/feature/e2-stage-labels.test.mjs` (node --test): table-driven asserts for every enum × both styles; unknown-token humanize; null/''; locale switch via the i18n module's set-locale export asserting the ES string; import `bracket-resolver.js` and assert `STAGE_LABELS.round_of_32 === stageLabel('round_of_32')` identity + `STAGE_ORDER` length 6. 100% automated.
**Estimate:** S. **Dependencies:** none (parallel with T1).

### Task T5 · Replace all duplicate humanizers + fix the venue-detail P0 leak
**Description:** Point every render path at `stageLabel()` and delete the four local copies: (1) **the confirmed leak** `venue-detail.js:82` — currently `escapeHtml(match.stage || '')` renders `round_of_32` raw in the stage pill (spec Appendix A venue-detail P0) → `stageLabel(match.stage)`; (2) `matchup-detail.js:408` `prettyStageName` (keep its "Knockout stage" fallback semantics for unknown-but-knockout rows); (3) `home-view.js:567` → `style:'short'`; (4) `large-match-card.js:251` → `style:'short'` (note it maps `quarterfinals`→"Quarterfinal" singular today — canonical short form wins, document the copy change); (5) `calendar-export.js:62` → full style (ICS DESCRIPTION text). Keep escaping through `escapeHtml` at every call site (r14/r17 escape conventions).
**Files:** `app/views/venue-detail.js`, `app/views/matchup-detail.js`, `app/views/home-view.js`, `app/components/large-match-card.js`, `app/calendar-export.js`.
**Acceptance criteria:**
- [ ] Venue-detail knockout rows show "Round of 32"/"Round of 16" pills — zero raw enums
- [ ] Knockout matchup header still shows "Round of 32" (existing `tests/ux/knockout-matchup.spec.mjs` stays green)
- [ ] `grep -rn "round_of_32.*:.*'R" app/views app/components` finds no leftover local maps; exactly one map lives in `app/lib/stage-labels.js`
- [ ] Exported `.ics` events contain "Round of 32", never `round_of_32`
- [ ] No feature/data regression: venue match lists keep flags/scores/kickoffs; home recent-results rows keep team text + times; calendar export still produces valid VEVENTs
**Edge cases:** group rows on every surface keep "Group A" (venue-detail's group branch, matchup-detail :129); missing stage on legacy records; live vs FT vs PEN rows on venue-detail (label is stage, not status — must not collide with the status pill); ES locale on matchup header.
**QA script (automated):** extend `tests/ux/e2-names-enums.spec.mjs` — goto a knockout venue route (pick a venue hosting an R32 match from `data/schedule_full.json`), assert `getByText('Round of 32').first()` visible and `page.locator('body')` text does NOT match `/round_of_\d+/`; feature-side: extend `tests/feature/e2-stage-labels.test.mjs` to read the five source files and assert each imports `stage-labels.js` and contains no `round_of_32:` literal; assert `calendar-export.js` output via direct import: build an ICS for a fixture R32 match, regex-assert `Round of 32` present, `round_of_32` absent. Covers 5/5. 100% automated.
**Estimate:** M. **Dependencies:** T4.

### Task T6 · Leak audit + permanent regression net (all enums, all pages)
**Description:** One-time audit + a locked-in test. Audit: grep every render path for interpolation of raw enum-bearing fields — `\${...stage...}`, `\${...status...}`, `escapeHtml(m.stage`, `escapeHtml(match.stage` — across `app/views/*.js`, `app/components/*.js`; fix any leak found the same way as T5 (expected: none left after T5, but `status_view`, `pools`, `my-brackets` variants have not been hand-verified). Regression net: a Playwright spec that walks the public routes (`#/home`, `#/schedule`, `#/projected`, `#/bracket`, `#/venues`, one knockout `#/venue/id/…`, one knockout + one group `#/matchup/…`, `#/matches`, `#/standings`, `#/status`) and asserts `document.body.innerText` matches none of the known-enum patterns: `/\b(group_stage|round_of_32|round_of_16|quarterfinals?_\w+|semifinals?_\w+|third_place)\b/` and `/\bSTATUS_[A-Z_]+\b/` (canonical status tokens from `app/lib/match-status.js` must never render — `status-pill.js` already maps them to FT/PEN/LIVE, lock that in). Deliberately pattern-based (`/_[a-z]/` for known enum stems) so future enum additions that leak fail the gate.
**Files:** `tests/ux/e2-names-enums.spec.mjs` (the net), any leaking view found by the audit (report in PR description; expected none).
**Acceptance criteria:**
- [ ] Audit grep results recorded in the PR (file:line list, even if empty)
- [ ] Playwright net covers ≥10 routes above; each asserts zero matches of the stage-enum regex AND the `STATUS_*` regex on rendered `innerText`
- [ ] Net re-runs each route's assertion once more after a hash re-navigation (renderView innerHTML rebuild must not resurrect a leak from a different code path)
- [ ] Net is wired into the standard gate (runs under `npx playwright test --config tests/playwright.config.mjs tests/ux tests/integrated` with the ThreadingHTTPServer webServer untouched)
- [ ] No feature/data regression: net is read-only assertions — no app code changes unless the audit finds a leak, in which case that fix routes through `stageLabel()`
**Edge cases:** unresolved knockout slots must not trip the regex (W79, "3rd Group C" contain no underscore-enum); `#/status` pipeline page legitimately shows feed *keys* — scope the status-token assertion to visible text, and if a pipeline key is intentionally technical (e.g. `actual_results.json` filename), whitelist exact filenames, not patterns; ES locale pass on one route; live match day vs quiet day (net must pass in both data states — use whatever `data/actual_results.json` holds, no fixtures that assume liveness).
**QA script (automated):** `tests/ux/e2-names-enums.spec.mjs` — `for (const route of ROUTES)` loop: goto, `waitForLoadState`, `expect(await page.evaluate(() => document.body.innerText)).not.toMatch(STAGE_ENUM_RE)` + `.not.toMatch(/\bSTATUS_[A-Z_]+\b/)`, re-navigate `#/home` → route, re-assert. 100% automated; the audit itself is the 1-line manual step (grep + record).
**Estimate:** M. **Dependencies:** T5 (net will be red until T5 lands — land in the same PR or ordered).

---

## Epic-level regression gate (must be 100% green before the batched release)
1. `python3 scripts/validate_data.py` (untouched by this epic — must stay green)
2. `bash tests/smoke.sh`
3. `node --test tests/feature/*.mjs tests/competition.test.mjs` (picks up extended `r13-team-names` + new `e2-stage-labels`)
4. `npx playwright test --config tests/playwright.config.mjs tests/ux tests/integrated` (picks up new `e2-names-enums.spec.mjs`; existing `knockout-matchup.spec.mjs`, `rj30-winner-highlight.spec.mjs`, `projected-bracket.spec.mjs` double as regression cover for this epic's surfaces)

**Coverage:** 6 tasks, 30 acceptance criteria, 27 automated (90%); 3 one-line manual smokes (Dynamic Type on device, short-name visual parity, audit-grep record).
