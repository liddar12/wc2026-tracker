# E4-contrast-empty — Dark-hero contrast + empty states (A6 + A7)

**Epic id:** `E4-contrast-empty`
**Title:** Dark-mode hero contrast fix + honest empty/placeholder states
**Goal:** Kill the confirmed WCAG failure (near-black `#0B1014` text on bright-cyan `#22D3EE` hero in dark mode, ~2:1) and replace the three "looks broken" empty states — blank Position-Ratings bars, blank flags on unresolved knockout slots (W79/W80), and the empty "Today's matches" header card — with real values or honest, crafted empty copy. Presentation-only + additive; **zero data/feature removal** (owner's hard constraint).
**Spec references:** §3 A6, §3 A7, §5A (DARK palette), §8 (a11y/dark fixes), Appendix A: Home (empty header card), Team detail (P0 empty bars), venue-detail (P0 blank W79/W80 flags, spec line 253).

**Files this epic touches (all verified to exist unless marked NEW):**
- `app/styles.css` — hero tokens (`:root` blocks at 13/40, v2 blocks at ~2280/2337, `.home-hero` at 1477, R10 hero-muted override at 4266), `.pos-bars` (418–436), empty-state tweaks. **NO slot-badge CSS** — the TBD badge (`.flag-tbd`) is owned by E5 T6.
- `app/views/home-view.js` — `renderHero()` (95–127), `renderTodaySection()` (472–530)
- `app/views/team-detail.js` — Position bars (47–68)
- `app/views/venue-detail.js` — match rows (78–79): **text copy only** (slotLabel), lands AFTER E5 T6's badge wiring
- `app/lib/team-names.js` — new `slotLabel()` helper (text only; slot detection reuses the existing `isSlotPlaceholder` export from `app/bracket-resolver.js:33` — E4 creates NO new slot regex and NO new component file)
- `app/lib/i18n.js` + `app/lib/strings.es.js` — new empty-state strings (en + es)
- Tests: `tests/ux/e4-dark-hero.spec.mjs` (NEW), `tests/ux/e4-empty-states.spec.mjs` (NEW), `tests/feature/e4-contrast-empty.test.mjs` (NEW)

**Shared files (other epics likely touch — coordinate, merge carefully):**
- `app/styles.css` — every visual epic (E1 typography, E2 correctness badges, E5 flags) edits this; keep E4 edits to the named blocks only
- `app/views/home-view.js` — E1 T2.2 (typography/A1 header restyle) AND E2 T3/T5 (hmr-row wrap + stage labels) also edit this view · land order **E4 T4.x → E2 T3/T5 → E1 T2.2** (E4's Today-section structure change lands before E1's type ramp; E2's hmr-row wrap change rebases on E4's Today-section restructure)
- `app/lib/team-names.js` — SHARED: E2 T1 adds `fifaCode()`, E4 adds `slotLabel()` — both additive exports, land order **E2 T1 → E4 slotLabel**; E6 is a read-only consumer
- `app/components/team-flag.js` + `app/views/venue-detail.js` flag markup — **E5 T6 owns both**: the unresolved-slot badge is E5's `flagPlaceholder()` inside `team-flag.js` (`.flag-tbd`), with `flagFor()` routing slot codes through it via the existing `isSlotPlaceholder` (one regex, one file, fixes all 72 `flagFor` call sites at once), and E5 T6 wires the venue-detail flag spans. E4 does NOT modify `team-flag.js`, does NOT create any badge component, and touches venue-detail only to add the adjacent human copy. **Dependency contract (single direction, mirrored in E5's header):** E4 T3.1 `slotLabel()` (pure lib) → E5 T6 (badge + venue-detail flag wiring) → E4 T3.2 (venue-detail human copy).
- `app/lib/i18n.js`, `app/lib/strings.es.js` — any epic adding copy

**Cross-epic shared-file map (canonical, identical in all six epic files — the PM builds the collision schedule from this):**
- `app/views/matchup-detail.js` — touched by E3 (whole epic), E2 T5, E1 T2.4 · land order: **E3 → E2 T5 → E1 T2.4**
- `app/views/home-view.js` — touched by E4 T4.1/T4.2, E2 T3/T5, E1 T2.2 · land order: **E4 T4.x → E2 T3/T5 → E1 T2.2** (E4's Today-section structure change lands before E1's type ramp; E2's hmr-row wrap change rebases on E4's Today-section restructure)
- `app/components/large-match-card.js` — touched by E1 T1.3 ('TODAY'→'Today' + pill CSS), E2 T2/T5 (team-cell rewrite) · land order: **E1 T1.3 → E2 T2/T5** (E2's team-cell rewrite rebases on E1's landed 'Today' string so E1's source-string test stays green)
- `app/components/projected-bracket-tree.js` — touched by E2 T3 (slot-name rendering → `fifaCode(name) || shortTeamName(name)`), E6 (layout toggle in `paint()`/`renderStageNav` + exporting/moving module-level `OVERRIDES`, projected-bracket-tree.js:32) · land order: **E2 T3 → E6 T1.2/T3.1** (canonical order E2 → E6; rebase E6 on E2's landed text change)
- `app/lib/team-names.js` — additive exports only: **E2 T1 (`fifaCode`) → E4 (`slotLabel`)**; E6 is a read-only consumer and never edits this file

**Build gotchas honored:** `renderView()` rebuilds `root.innerHTML` — keep the `#home-updated-btn` freshness-popover wiring and `.lcard-stack` scroll-snap intact when restructuring the Today section. Playwright `webServer` stays `ThreadingHTTPServer` (`tests/playwright.config.mjs`) — new specs reuse the existing config, no config changes. Status-gating untouched: slot placeholders render only while a feeder match is unresolved; resolution still keys off `FINAL_STATUSES` in `app/lib/match-status.js`.

---

## Story S1 — Dark hero I can actually read
*As a fan opening the app at night, I want the Home hero readable in dark mode, so the first thing I see isn't black-on-cyan glare.*

### T1.1 — Theme-aware hero gradient tokens (dark teal + white text)
**Description:** The hero (`.home-hero`, styles.css:1477) paints `linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 70%, var(--accent)))` with `color: var(--primary-ink)`. `index.html:2` sets `data-redesign="v2"` on `<html>`, so in dark mode the v2 dark block (styles.css:2337–2349) wins: `--primary:#22D3EE`, `--primary-ink:#0B1014` → near-black on bright cyan, ~2:1. Fix by introducing dedicated hero tokens instead of piggybacking on `--primary`:
- In `:root` (light, styles.css:13) and the v2 light block (~2280): `--hero-grad-a: var(--primary); --hero-grad-b: color-mix(in srgb, var(--primary) 70%, var(--accent)); --hero-ink: var(--primary-ink);` (light hero already passes: white on teal-700 `#0E7490` ≈ 5.4:1, white on legacy navy `#1F4E78` ≈ 8.7:1 — no visual change in light).
- In BOTH dark blocks (`:root[data-theme='dark']` at 40 and the v2 dark block at 2337): `--hero-grad-a: #0E7490; --hero-grad-b: #155E75; --hero-ink: #FFFFFF;` (spec §5A DARK: "hero gradient DARK teal #0E7490→#155E75 (white text stays white)").
- Rewrite `.home-hero` to `background: linear-gradient(135deg, var(--hero-grad-a), var(--hero-grad-b)); color: var(--hero-ink);` — no other rule changes.
`--primary`/`--primary-ink` themselves are NOT changed (that's the A8/P1 color-unification epic).
**Files:** `app/styles.css`
**Acceptance criteria:**
- [ ] Dark mode (`wc26.theme='dark'` → `:root[data-theme='dark']`): computed `.home-hero` background-image contains `rgb(14, 116, 144)` (#0E7490) and `rgb(21, 94, 117)` (#155E75); computed `color` of `.home-hero-title` is `rgb(255, 255, 255)`.
- [ ] Contrast (WCAG relative-luminance): white on #0E7490 ≈ **5.4:1** and on #155E75 ≈ **7.3:1** — both ≥ 4.5:1 AA. The old failure (#0B1014 on #22D3EE ≈ 2:1) is gone.
- [ ] Light mode unchanged: `.home-hero` still gradients from `--primary` with computed title-text contrast ≥ 4.5:1.
- [ ] No feature/data regression: hero eyebrow, date title, hosts sub-line, countdown, freshness button + popover (`#home-updated-btn`) all still render and function in both themes.
**Edge cases:** theme = `auto` following `prefers-color-scheme: dark` (theme.js:7–8) must resolve to the dark tokens; legacy non-v2 scope (`:root[data-theme='dark']` without `data-redesign`) also fixed (both blocks edited); team-skin `--skin-accent` override must not leak into the dark hero (hero-grad-b is a fixed hex in dark); long Spanish date strings in `.home-hero-title` wrap, don't clip.
**QA script:** **NEW `tests/ux/e4-dark-hero.spec.mjs`** — `page.addInitScript(() => localStorage.setItem('wc26.theme','dark'))`, goto `/#/home`, assert: (1) `getComputedStyle(.home-hero).backgroundImage` includes `rgb(14, 116, 144)` and `rgb(21, 94, 117)`; (2) title color is `rgb(255, 255, 255)`; (3) in-test contrast helper (WCAG luminance fn) computes ratio(title color, #0E7490) ≥ 4.5 AND ratio(title color, #155E75) ≥ 4.5; (4) second test w/o init script (light): ratio(title color, sampled gradient endpoints from computed style) ≥ 4.5; (5) `#home-updated-btn` visible + click opens `#home-freshness-popover` in dark (feature-regression check). Covers 4/4 criteria — 100% automated.
**Estimate:** M. **Dependencies:** none (lands before E5/E1 styles.css merges; disjoint CSS blocks).

### T1.2 — §8 adaptive on-hero secondary text
**Description:** Secondary hero text (`.home-hero .muted`, `-sub`, `-eyebrow`, `-updated .muted`) is force-set to `rgba(255,255,255,0.92)` `!important` by the R10 block (styles.css:4276–4283) — correct for the new dark-teal hero, but audit it against §8 ("Hero on-gradient text adaptive: white dark / #0B1220 light"): bind these to `var(--hero-ink)` at 0.92 alpha via `color-mix(in srgb, var(--hero-ink) 92%, transparent)` so a future light-hero change (A8) stays adaptive, and verify the `.home-hero-updated .muted` low-alpha rule at styles.css:1524 can't win over it. Green freshness dot (`#4ade80`, styles.css:1514) stays — ≥3:1 on both new gradient stops (non-text indicator).
**Files:** `app/styles.css`
**Acceptance criteria:**
- [ ] Dark mode: computed color of `.home-hero-sub`, `.home-hero-eyebrow`, and `.home-hero-updated .muted` all evaluate ≥ 4.5:1 against #0E7490 (worst-case gradient stop).
- [ ] Light mode: same three elements ≥ 4.5:1 against the light hero's darker stop.
- [ ] The rgba(255,255,255,0.65) rule at styles.css:1524 no longer determines rendered color in either theme.
- [ ] No feature/data regression: "Updated Xm ago" stamp text + ⓘ affordance unchanged in content.
**Edge cases:** `data-theme` flips at runtime via the Settings toggle (theme.js cycle) — colors must update without reload (CSS vars do this; assert post-toggle); text-shadow (4282) kept — it aids, never substitutes for, contrast; ES locale strings (longer "Actualizado…") wrap.
**QA script:** extend **`tests/ux/e4-dark-hero.spec.mjs`** — for both themes, read computed colors of the three secondary selectors, contrast-assert ≥ 4.5 vs both hardcoded dark stops (dark run) / vs sampled gradient colors (light run); runtime-flip test: start light, `document.documentElement.setAttribute('data-theme','dark')` via evaluate, re-assert. 4/4 criteria automated.
**Estimate:** S. **Dependencies:** T1.1 (tokens must exist).

---

## Story S2 — Position ratings that show the numbers they claim
*As a fan on a team page, I want the GK/DEF/MID/FWD bars to visually show each rating, and to be told honestly when ratings aren't available — never blank grey tracks.*

### T2.1 — Fix the invisible bar fill (real proportional widths)
**Description:** Data exists (`data/teams.json` → `position_ratings {gk,def,mid,fwd}`, e.g. Mexico gk 55.7) and team-detail.js:55–63 emits `<span class="fill" style="width:NN%">`, but `.pos-bars .fill` (styles.css:432) is an inline `<span>` inside `.track` — `width`/`height:100%` are ignored on inline elements, so every bar renders as an empty grey track (the audit's P0, spec line 314). Fix: `.pos-bars .track { display:block; }` and `.pos-bars .fill { display:block; }` (track is already blockified as a grid item of `.row`, but pin it explicitly). Keep the 0–100 scale already clamped in team-detail.js:61. Optionally add `transition: width var(--motion-base) var(--ease-out)` — gated by the existing `prefers-reduced-motion` var-zeroing block (styles.css:2351).
**Files:** `app/styles.css`
**Acceptance criteria:**
- [ ] On `#/team/name/Mexico`, each `.pos-bars .fill` has rendered `offsetWidth > 0` and `offsetWidth / track.offsetWidth` within ±2% of `value/100` (gk 55.7 → ~55.7% of track).
- [ ] Numeric value labels (e.g. `55.7`) still render right-aligned next to each bar (no data removed).
- [ ] Fill uses `var(--primary)` and is visible in BOTH themes (contrast ≥ 3:1 vs `--surface-2` track).
- [ ] No feature/data regression: header, calendar button, Group matches, Roster sections unaffected.
**Edge cases:** value 0 (empty fill but track visible — valid), value ≥100 (clamped 100), non-number rating (row skipped at team-detail.js:57 — handled by T2.2), dark mode fill visibility, reduced-motion (no width animation), Dynamic-Type/long labels don't break the `44px 1fr 44px` grid.
**QA script:** **NEW `tests/ux/e4-empty-states.spec.mjs`** — goto `/#/team/name/Mexico`, for each `.pos-bars .row` read `data` value from the third cell text + measure `.fill`/`.track` offsetWidths, assert proportionality ±2% and `>0`; repeat once with dark init-script asserting `getComputedStyle(fill).backgroundColor !== getComputedStyle(track).backgroundColor`. Plus **NEW `tests/feature/e4-contrast-empty.test.mjs`** (node) source-contract: `app/styles.css` matches `/\.pos-bars \.fill\s*{[^}]*display:\s*block/`. 4/4 automated.
**Estimate:** S. **Dependencies:** none.

### T2.2 — Honest empty state when ratings are missing
**Description:** If `team.position_ratings` is absent/non-numeric, team-detail.js:57 `continue`s every row and the section renders a bare "Position ratings" heading over nothing — a silent blank. Count rendered rows; when 0, append `emptyState('Position ratings unavailable', { detail: 'Ratings appear once squad data is published for this team.', icon: '📊', testid: 'pos-ratings-empty' })` from the existing `app/lib/empty-state.js` contract (role="status", aria-live polite). Add i18n keys `team.ratingsEmpty` / `team.ratingsEmptyDetail` to `app/lib/i18n.js` + `app/lib/strings.es.js` and use `t()`.
**Files:** `app/views/team-detail.js`, `app/lib/i18n.js`, `app/lib/strings.es.js`
**Acceptance criteria:**
- [ ] Team with no numeric ratings: `[data-testid="pos-ratings-empty"]` renders with the copy above; zero `.track` elements (no blank bars).
- [ ] Team WITH ratings: empty state absent, bars render (T2.1 behavior intact).
- [ ] Empty-state node has `role="status"` (from lib) and localized copy exists in en + es.
- [ ] No feature/data regression: partial ratings (e.g. only gk+fwd numeric) still render those rows and NO empty state.
**Edge cases:** partial ratings (some positions missing) → render available rows only; `position_ratings: {}` vs key absent vs values as strings — all → empty state; ES locale renders the es string; dark mode empty-state contrast (uses `--text-muted`, already themed).
**QA script:** extend **`tests/ux/e4-empty-states.spec.mjs`** — `page.route('**/data/teams.json', …)` to serve a copy with Mexico's `position_ratings` deleted; goto team page; assert testid visible + `.pos-bars .track` count is 0; control test without the route asserts testid absent. Extend **`tests/feature/e4-contrast-empty.test.mjs`**: source-contract that team-detail.js imports `emptyState` from `../lib/empty-state.js` and references both i18n keys; assert keys exist in i18n.js AND strings.es.js. 4/4 automated.
**Estimate:** S. **Dependencies:** T2.1 (shared spec file).

---

## Story S3 — Unresolved knockout slots that look intentional
*As a fan browsing a venue's Final/knockout fixtures before the bracket resolves, I want "Winner of Match 79" with a crafted placeholder chip instead of a blank flag next to raw "W79".*

### T3.1 — `slotLabel()` text helper in `team-names.js` (pure lib, no UI)
**Description:** Export `slotLabel(code)` from `app/lib/team-names.js` (currently exports `shortTeamName`/`tinyTeamName`/`englishName` — pure, import-free). Mapping: `W79`→`Winner of Match 79`, `L61`→`Loser of Match 61`, `1A`→`Group A winner`, `2A`→`Group A runner-up`, `3 ABC`→`Third place (Group A/B/C)`; anything else (real names, unknowns) returned unchanged, never throw. Slot detection MUST reuse the existing `isSlotPlaceholder` export from `app/bracket-resolver.js:33` (`SLOT_RE = /^\d[A-L]$|^3 [A-L]+$|^W\d+$|^L\d+$/`) — do **NOT** create a duplicate `isSlotCode` regex; the pattern lives in exactly one place (E5 T6 routes `flagFor()` through the same export). Import direction `lib/team-names.js → bracket-resolver.js` is cycle-free (verified: bracket-resolver imports only `lib/match-status.js`). Gotcha: `isSlotPlaceholder(nonString)` returns `true` — guard `typeof code === 'string'` first and return the input as-is for `null`/`undefined`. **No component file, no CSS, no view change in this task** — the visual TBD badge is E5 T6's `flagPlaceholder()` (`.flag-tbd` in `team-flag.js`).
**Files:** `app/lib/team-names.js`
**Acceptance criteria:**
- [ ] Exact mapping: `slotLabel('W79')==='Winner of Match 79'`, `('L61')==='Loser of Match 61'`, `('1A')==='Group A winner'`, `('2A')==='Group A runner-up'`, `('3 ABC')==='Third place (Group A/B/C)'`.
- [ ] Identity + safety: `slotLabel('Brazil')==='Brazil'`, `('Narnia')==='Narnia'`, `null`/`undefined`/`''` returned as-is, no throw.
- [ ] Detection delegates to `isSlotPlaceholder` imported from `../bracket-resolver.js`; source-contract: no new slot-regex literal (`^W\\d`, `^\\d[A-L]`, etc.) appears in `team-names.js`.
- [ ] No feature/data regression: existing `shortTeamName`/`tinyTeamName`/`englishName` outputs byte-identical (snapshot in test).
**Edge cases:** lowercase `'w79'` — `SLOT_RE` is case-sensitive so it's NOT a slot; lock identity behavior, don't "fix" it (matches bracket-resolver semantics); non-string inputs (guard before `isSlotPlaceholder`); ES locale (labels stay English v1 — copy is data-adjacent, i18n keys deferred); no DOM access (must stay node-runnable).
**QA script:** extend **`tests/feature/e4-contrast-empty.test.mjs`** (node, DOM-free): table-test the 5 mappings + 5 identity/safety inputs; regex source-contract on `app/lib/team-names.js` (imports `isSlotPlaceholder`, contains no slot-regex literal); snapshot the three pre-existing exports over 10 fixed names. 4/4 automated.
**Estimate:** S. **Dependencies:** none upstream. **Blocks:** E5 T6 (consumes nothing at code level but sequences after this so its adjacent-copy note is truthful) and E4 T3.2. **Land order: this task → E5 T6 → E4 T3.2.**

### T3.2 — Venue-detail human copy: "Winner of Match 79" next to E5's `.flag-tbd` chip
**Description:** venue-detail.js:78–79 renders `flagFor(a)` + `escapeHtml(a)` per line; for slot codes the raw `W79`/`W80` text shows (spec P0, line 253). **E5 T6 has already landed by now**: `flagFor('W79')` returns the crafted `.flag-tbd` chip (placeholder routed inside `team-flag.js` via `isSlotPlaceholder`), and E5 T6 owns the venue-detail flag-span wiring (incl. removing the double-wrap, E5 T3). This task adds ONLY the text layer: in the two team lines, render `escapeHtml(slotLabel(a))` / `escapeHtml(slotLabel(b))` instead of the raw code (identity for real names, so one call covers both cases). Import `slotLabel` from `../lib/team-names.js`. No `team-flag.js`, no styles.css, no badge markup — consume E5's chip, do not invent one.
**Files:** `app/views/venue-detail.js`
**Acceptance criteria:**
- [ ] Venue page hosting the Final (unresolved feeders): rows show E5's `.flag-tbd` chip + human label ("Winner of Match 79"), zero `🏳` glyphs and zero raw `W79`/`W80` visible text.
- [ ] Once a feeder match resolves (record in `FINAL_STATUSES` per `app/lib/match-status.js`), the real team name + real `.fi` flag render — human copy only for unresolved slots (**status-gating unchanged**).
- [ ] Real-team lines byte-identical to pre-change output (`slotLabel` identity path); kickoff times, stage labels, "Matches here" count unchanged.
- [ ] No feature/data regression: no new element/class introduced by this task (badge classes all come from E5); `TBA` fallback for missing team fields (venue-detail.js:70–71) unchanged.
**Edge cases:** both teams unresolved vs one resolved; pen/ET winners (STATUS_FINAL_PEN / STATUS_FINAL_AET — canonical sets in `app/lib/match-status.js`) must resolve the slot like regulation FT; long labels ("Winner of Match 104") wrap, don't clip at 390px; dark mode chip contrast is E5's AC — do not re-assert ownership, just don't break it; VoiceOver reads only the human label (chip is `aria-hidden` per E5).
**QA script:** extend **`tests/ux/e4-empty-states.spec.mjs`**: `page.route` `**/data/schedule_full.json` to keep a Final row with `team_a:'W79', team_b:'W80'` at a known venue; goto that `#/venue/id/…`; assert `.flag-tbd` count ≥ 2 (E5's class — integration check, not ownership), text contains "Winner of Match 79", page HTML contains no `🏳` and no visible `W79` text; second route-fixture with the slot resolved in `actual_results.json` (status from `FINAL_STATUSES`) asserts real flag + name (status-gate regression). Extend **`tests/feature/e4-contrast-empty.test.mjs`**: source-contract that venue-detail.js imports `slotLabel` and contains no `flag-tbd`/badge markup literals of its own. ~4/4 automated; manual smoke: 1 glance at venue page on real iPhone dark mode.
**Estimate:** S. **Dependencies:** **E4 T3.1 (slotLabel) and E5 T6 (badge + venue-detail flag wiring) — this task lands LAST in the chain E4 T3.1 → E5 T6 → E4 T3.2.**

---

## Story S4 — A Today's-matches section that never shows a void
*As a fan on Home, I want the first match right under the "Today's matches" heading — or, on an off day, an honest "No matches today — next kickoff …" line — never an empty white card.*

### T4.1 — Kill the empty header card (heading + first card join up)
**Description:** `renderTodaySection()` (home-view.js:503–507) wraps the heading in its own `.home-card` with `marginBottom:'12px'` and the void the audit flagged (Appendix A Home, spec line 172). Change the heading to a plain section heading (`<h2 class="home-card-title home-section-heading">` directly in `wrap`, no `.home-card` container) with a small `.home-section-heading` CSS rule (margin 0 0 8px, existing token colors) so the first `.lcard` sits immediately below. Purely structural — the heading text, `t('home.today')`/`t('home.upNext')` logic, favorite/LIVE reorder (509–515), and 6-card cap all unchanged.
**Files:** `app/views/home-view.js`, `app/styles.css`
**Acceptance criteria:**
- [ ] No `.home-card` containing ONLY an `<h2>` exists in the Today section; vertical gap between heading baseline and first card top ≤ 24px at 390×844.
- [ ] Heading still reads "Today's matches" when today has fixtures and "Up next" on the fallback (es: "Partidos de hoy"/"A continuación").
- [ ] LIVE > favorite > time ordering and the ≤6-card cap unchanged (assert same card order as before the change for a fixed fixture).
- [ ] No feature/data regression: `.lcard-stack` scroll-snap still applies; re-render via `renderView()` (live-refresh path, main.js:416) doesn't duplicate headings.
**Edge cases:** live-refresh re-render (scroll position preserved — BR-6); favorite team set vs unset; 1 match vs 6+ matches today; ES locale; dark mode heading contrast (uses themed `--text`).
**QA script:** extend **`tests/ux/e4-empty-states.spec.mjs`** — goto `/#/home`, locate heading by text, assert `heading.closest('.home-card')` that has no sibling content is null; boundingBox gap heading→first `.lcard` ≤ 24; count `.lcard` ≤ 6. Extend **`tests/feature/e4-contrast-empty.test.mjs`**: source-contract that renderTodaySection no longer creates the heading-only `head` home-card. 4/4 automated.
**Estimate:** S. **Dependencies:** coordinate with E1-typography (also restyles `.home-card-title`) — E4 lands the structure, E1 the type ramp; merge order E4 → E1 preferred.

### T4.2 — Honest empty copy with next kickoff
**Description:** Two states need honest copy (home-view.js:485–498): (a) **no matches today but schedule continues** — today the code silently switches to "Up next" + 3 future cards (keep this feature!) but never says today is empty; prepend a muted line `No matches today — next kickoff {Fri, Jul 3 · 3:00 PM}`; (b) **nothing upcoming at all** (line 496–498 currently a bare muted `<p>` inside the header card) — replace with `emptyState(t('home.noMatchesToday'), { detail: t('home.scheduleDone'), icon: '⚽', testid: 'today-empty' })`. Implement `nextKickoffLabel(scheduleFull, nowMs)` as a **pure exported helper** (put it in `app/lib/phase.js`, which is already the pure date/phase lib) formatting the earliest future `kickoff_utc` in the viewer's locale/zone. Add i18n keys (`home.noMatchesToday`, `home.nextKickoff`, `home.scheduleDone`) en + es.
**Files:** `app/views/home-view.js`, `app/lib/phase.js`, `app/lib/i18n.js`, `app/lib/strings.es.js`
**Acceptance criteria:**
- [ ] Off-day fixture: line matching `/^No matches today — next kickoff /` renders above the "Up next" stack AND the 3 upcoming cards still render (feature kept, not replaced).
- [ ] Exhausted-schedule fixture: `[data-testid="today-empty"]` renders (role="status"), no bare "No upcoming matches in schedule." string remains in source.
- [ ] `nextKickoffLabel` is pure: same output for same `(scheduleFull, nowMs)`; returns `''`/null when no future kickoff (caller then omits the line).
- [ ] No feature/data regression: match-day render path (today has fixtures) byte-identical section content except T4.1's structure; es strings present.
**Edge cases:** kickoff crossing midnight ET (etDateISO bucketing, home-view.js:479–483 — "today" empty but a 10PM-ET game yesterday still live → LIVE reorder wins and section is NOT empty); timezone of viewer ≠ ET (label uses local time); live match in progress on an otherwise empty day; ES locale date formatting; reduced-motion (no new animation); dark-mode empty-state contrast.
**QA script:** extend **`tests/feature/e4-contrast-empty.test.mjs`** (node): import `nextKickoffLabel` from `app/lib/phase.js`; fixtures: future kickoffs → formatted label; empty/past-only schedule → falsy; purity double-call assert; i18n keys exist en+es. Extend **`tests/ux/e4-empty-states.spec.mjs`**: `page.route` `**/data/schedule_full.json` → (a) all kickoffs shifted +3 days: assert "No matches today — next kickoff" visible AND ≥1 `.lcard` below; (b) empty array: assert `[data-testid="today-empty"]` visible. ~6/6 automated; manual smoke: 1-line — open Home on a real off-day and eyeball the kickoff time matches the Schedule tab.
**Estimate:** M. **Dependencies:** T4.1 (same function/section).

---

## Regression gate (every task, before merge)
Run in order, gate on exit codes: `python3 scripts/validate_data.py` → `bash tests/smoke.sh` → `node --test tests/feature/*.mjs tests/competition.test.mjs` → `npx playwright test --config tests/playwright.config.mjs tests/ux tests/integrated`. New specs (`e4-dark-hero.spec.mjs`, `e4-empty-states.spec.mjs`, `e4-contrast-empty.test.mjs`) ride the existing globs — no config edits, webServer stays ThreadingHTTPServer.

**Coverage:** 32 acceptance criteria, 30 automated (≈94%), 2 one-line manual smokes.

**Cross-epic sequencing (authoritative, mirrored in E5-flags.md):** E4 T3.1 `slotLabel()` (pure lib) → E5 T6 `flagPlaceholder()` badge + venue-detail flag wiring → E4 T3.2 venue-detail human copy. One badge (`.flag-tbd`, owned by E5), one slot regex (`isSlotPlaceholder` in `app/bracket-resolver.js`), one direction.
