# E5-flags — Crafted flags everywhere, no emoji (FLAG P0)

**Epic id:** E5-flags
**Goal:** Every flag in the app renders as a crafted flag-icons SVG — no emoji flags anywhere the CSS is loaded. England / Scotland / Wales get real crafted flags (root cause: `flagFor()` only emits `fi fi-<code>` for 2-letter codes, so `GB-ENG/GB-SCT/GB-WLS` fall through to the wavy black-flag emoji). Adds two shared, additive APIs consumed by sibling epics: a circular-cropped flag variant (E6 bracket wheel) and a crafted unresolved-slot placeholder (E4 W79/W80 empty states).
**Spec refs:** §2.3 (emoji + mixed icon languages), §3 A7 (unresolved-slot flags W79/W80), §3 A13 / Appendix-A Matchup "Standardize on one flag rendering system app-wide", Appendix-A Venue detail P0 ("blank gray placeholder rectangles … W79/W80"), §9 (wheel: flags on rim, `flagFor()` reuse).
**Hard constraint:** presentation-only + additive. The emoji layer stays as the offline/CDN-failure fallback (`has-flag-emoji-only`); no data, route, or feature is removed.

**Files this epic touches (all verified to exist):**
- `app/components/team-flag.js` — core fix + new APIs (`flagFor` at :114-124 is the defect site)
- `app/styles.css` — `.flag.fi` block at :4193-4206; add circle + placeholder styles
- `app/views/venue-detail.js` — double-wrapped `.flag` span + blank W79/W80 flags (:78-79)
- `app/views/settings-view.js` — double-wrapped `.flag` spans (:74, :83)
- `index.html` — flag-icons@7 CDN link (:59) — verify only, no change expected
- Tests: `tests/feature/e5-crafted-flags.test.mjs` (NEW), `tests/ux/e5-flags.spec.mjs` (NEW), `tests/feature/bracket-third-place.test.mjs` (extend — already asserts `fi fi-` at :42-45)

**Shared files (other epics likely touch too):**
- `app/styles.css` (every visual epic), `index.html` (E1 typography/tokens), `app/components/team-flag.js` (E6 wheel imports the circle API; E5 owns ALL badge/flag internals — E4 never touches this file), `app/views/venue-detail.js` (E5 T6 owns the flag-span wiring; E4 T3.2 adds only the adjacent human copy AFTER T6; E2 T5 stage-label fix + E1 raw-enum/typography fix are text-only in the same rows), `app/views/settings-view.js` (E1/E3).

**Cross-epic shared-file map (canonical, identical in all six epic files — the PM builds the collision schedule from this; E5 touches none of these five files, listed so every build agent sees the same map):**
- `app/views/matchup-detail.js` — touched by E3 (whole epic), E2 T5, E1 T2.4 · land order: **E3 → E2 T5 → E1 T2.4**
- `app/views/home-view.js` — touched by E4 T4.1/T4.2, E2 T3/T5, E1 T2.2 · land order: **E4 T4.x → E2 T3/T5 → E1 T2.2** (E4's Today-section structure change lands before E1's type ramp; E2's hmr-row wrap change rebases on E4's Today-section restructure)
- `app/components/large-match-card.js` — touched by E1 T1.3 ('TODAY'→'Today' + pill CSS), E2 T2/T5 (team-cell rewrite) · land order: **E1 T1.3 → E2 T2/T5** (E2's team-cell rewrite rebases on E1's landed 'Today' string so E1's source-string test stays green)
- `app/components/projected-bracket-tree.js` — touched by E2 T3 (slot-name rendering → `fifaCode(name) || shortTeamName(name)`), E6 (layout toggle in `paint()`/`renderStageNav` + exporting/moving module-level `OVERRIDES`, projected-bracket-tree.js:32) · land order: **E2 T3 → E6 T1.2/T3.1** (canonical order E2 → E6; rebase E6 on E2's landed text change)
- `app/lib/team-names.js` — additive exports only: **E2 T1 (`fifaCode`) → E4 (`slotLabel`)**; E6 is a read-only consumer and never edits this file

**Dependency contract (single direction, mirrored in E4-contrast-empty.md):** T5 (circle API) blocks E6's wheel rim. For unresolved slots there is ONE badge (`.flag-tbd`, owned here by T6) and ONE slot regex (the existing `isSlotPlaceholder` in `app/bracket-resolver.js` — no epic adds another): **E4 T3.1 `slotLabel()` (pure lib in `team-names.js`) → E5 T6 (badge + venue-detail flag wiring) → E4 T3.2 (venue-detail human copy)**.

---

## Story 1 — As a fan of England, Scotland or Wales, I see my nation's real crafted flag, never a wavy black emoji

### T1 — Verify the flag-icons@7 dependency actually covers GB subdivisions (spike, gate for T2)
**Description:** Confirm both load-bearing claims before writing code: (a) `index.html:59` loads `https://cdn.jsdelivr.net/npm/flag-icons@7/css/flag-icons.min.css` with `onload` → `html.has-flag-svg` / `onerror` → `html.has-flag-emoji-only`; (b) that CSS ships `.fi-gb-eng`, `.fi-gb-sct`, `.fi-gb-wls` and their `.fis` (1×1 square) variants. Pre-verified 2026-07-01 by curling the CDN css (all five selectors present, incl. `fi-gb-eng.fis`) — this task turns that into a pinned regression check so a CDN major-version drift can't silently break it.
**Files:** `index.html` (read-only), `tests/feature/e5-crafted-flags.test.mjs` (new).
**Acceptance criteria:**
- [ ] Test asserts `index.html` contains `flag-icons@7/css/flag-icons.min.css`, the `onload` handler adding `has-flag-svg`, and the `onerror` handler adding `has-flag-emoji-only` (fallback layer NOT removed — no feature regression).
- [ ] Test fetches (or reads a committed fixture of) the flag-icons css and asserts `.fi-gb-eng`, `.fi-gb-sct`, `.fi-gb-wls`, `.fis` selectors exist. Network-independent: commit the 28 KB css as `tests/baseline/flag-icons-7.min.css` fixture and assert against that; a separate `--test-skip`-able live check compares fixture vs CDN.
- [ ] No app files modified by this task.
**Edge cases:** CDN unreachable in CI (fixture-first, live check optional); flag-icons publishing a v8 (pin stays `@7`).
**QA script:** `tests/feature/e5-crafted-flags.test.mjs` — `test('index.html wires flag-icons@7 with svg/emoji fallback classes')` (regex on `index.html`), `test('flag-icons v7 fixture ships gb-eng/gb-sct/gb-wls incl. square variants')` (string-contains on fixture). Covers 3/3 criteria automatically.
**Estimate:** S. **Dependencies:** none (first task of the epic).

### T2 — `flagFor()` emits `fi fi-gb-eng` / `fi-gb-sct` / `fi-gb-wls` for GB subdivision codes
**Description:** In `app/components/team-flag.js:121`, `fiClass` is only built when `code.length === 2`, so `GB-ENG/GB-SCT/GB-WLS` (mapped at :16, :30, :31) return a bare `.flag` span whose content is the tag-sequence emoji — the wavy black flag on iOS. Fix: build the class for any known code via `fi fi-${code.toLowerCase()}` (GB-ENG → `fi-gb-eng`, which flag-icons ships per T1). Keep the existing emoji text INSIDE the span as the `has-flag-emoji-only` fallback (styles.css:4196 hides it under the SVG — do not delete). Also route the lookup through the existing `isoFor()` (:91-99) instead of the raw `ISO[team] || ISO[team?.trim()]` at :119 and :127, so accent/spelling variants get SVG flags too (isoFor already exists and is tested; this is wiring, not new normalization). Apply the same to `rawFlagFor()` (:126-128) so `flagSpan()` inherits it.
**Files:** `app/components/team-flag.js`.
**Acceptance criteria:**
- [ ] `flagFor('England')` output contains `class="flag fi fi-gb-eng"` (order-insensitive: matches `/fi fi-gb-eng/`) and `aria-hidden="true"`.
- [ ] Same for `Scotland` → `fi-gb-sct`, `Wales` → `fi-gb-wls`.
- [ ] All 2-letter behavior unchanged: `flagFor('Brazil')` still matches `/fi fi-br/`; `flagFor("Côte d'Ivoire")` still matches `/fi fi-ci/` (locks bracket-third-place.test.mjs:42-45).
- [ ] Accent/spacing variants resolve via `isoFor`: `flagFor('cote d ivoire')` → `fi-ci`, `flagFor(' Türkiye ')` → `fi-tr`.
- [ ] Unknown team (`flagFor('Narnia')`) still returns a `.flag` span with NO `fi` class and no thrown error (fallback preserved — no regression).
- [ ] Emoji fallback text still present inside every span (offline layer intact).
**Edge cases:** `null`/`undefined`/`''` team (must not throw — :119 uses optional chaining today, keep it); slot codes like `W79`/`1A` (must NOT get an `fi` class — that's T6's placeholder path); dark mode (SVG flags unaffected; hairline handled in T5 CSS); CDN failure (`has-flag-emoji-only` → emoji shows through, GB trio shows the tag-sequence emoji as before — acceptable degraded mode, assert class still emitted).
**QA script:** `tests/feature/e5-crafted-flags.test.mjs` — `test('GB subdivisions emit crafted fi classes')`, `test('two-letter codes unchanged')`, `test('isoFor-normalized variants get fi classes')`, `test('unknown/null/slot inputs degrade safely')`. Pure-function string assertions, node-runnable (team-flag.js touches `document` only in `flagSpan`). Covers 6/6 criteria.
**Estimate:** S. **Dependencies:** T1.

---

## Story 2 — As a fan on any page, every flag I see is the same crafted SVG system — no emoji flags anywhere

### T3 — Audit + fix every flag render path (72 `flagFor` call sites; kill double-wrapping and stray emoji)
**Description:** Sweep all 72 `flagFor(` call sites (29 files under `app/`). Two confirmed defects to fix: (1) `app/views/venue-detail.js:78-79` wraps `flagFor()`'s returned `<span class="flag …">` inside ANOTHER `<span class="flag">` — nested `.flag` spans break the `.flag.fi` sizing rules (styles.css:4196-4203) and produce the spec's "blank gray placeholder rectangles" on venue detail; (2) `app/views/settings-view.js:74` and `:83` do the same double-wrap in the favorite-team picker (spec Appendix-A Settings: "emoji flags in the team grid"). Fix by interpolating `flagFor(x)` directly (it already carries `class="flag"` + `aria-hidden`). Then verify by scan, not by eye: a repo test greps `app/**/*.js` for (a) any `<span class="flag"[^>]*>\s*\$\{flagFor` double-wrap pattern and (b) any emoji-flag codepoints (U+1F1E6–U+1F1FF regional indicators, U+1F3F4 black flag, U+1F3F3 white flag) outside `app/components/team-flag.js` (the only legitimate home of the fallback glyphs — verified today: currently the ONLY file containing them).
**Files:** `app/views/venue-detail.js`, `app/views/settings-view.js`, `tests/feature/e5-crafted-flags.test.mjs`.
**Acceptance criteria:**
- [ ] No nested `.flag` spans: venue-detail and settings-view interpolate `flagFor()` bare; a source-scan test proves no `class="flag"` wrapper around a `flagFor` interpolation anywhere in `app/`.
- [ ] Source-scan test: zero emoji-flag codepoints in any `app/**/*.js` except `app/components/team-flag.js`.
- [ ] Settings favorite-team grid, current-favorite chip, and venue-detail match lines still render team name + flag for every team (no removal — the `escapeHtml(name)` text next to each flag is untouched).
- [ ] `settings-view.js:74` inline `font-size:24px` sizing still applies to the flag (move the style onto the flagFor span via a wrapper class if needed, don't drop the size).
- [ ] Venue detail for a venue with only resolved fixtures shows two `.fi` flags per match line.
**Edge cases:** venue-detail lines where team is a slot code (`W79`) — handled by T6, but this task must not crash on them meanwhile; long team names next to flags at Dynamic Type sizes (flag is `em`-sized at styles.css:4201, so it scales — assert no fixed px regression except deliberate ones already in css); dark mode (no color logic here); i18n team names (flags keyed by canonical English name from data feeds — unchanged).
**QA script:** `tests/feature/e5-crafted-flags.test.mjs` — `test('no emoji flag codepoints outside team-flag.js')` (readdir + regex over app/), `test('no double-wrapped .flag spans')` (regex `/class="flag"[^>]*>\s*\$\{\s*flagFor/` over app/), `test('venue-detail + settings templates interpolate flagFor bare')`. Plus `tests/ux/e5-flags.spec.mjs` — Playwright: open `#/settings`, assert favorite-team grid rows contain `.flag.fi` elements and `document.querySelector('.settings-team-chip .flag .flag')` is null; open a venue-detail route, same nested-span assertion. Covers 5/5 criteria. Manual smoke (1 line): eyeball Settings grid on an iPhone for flag size parity.
**Estimate:** M. **Dependencies:** T2 (so GB rows in the settings grid go SVG in the same pass).

### T4 — Full-roster regression test: all 48 teams render a crafted flag, zero emoji emitted
**Description:** The epic's lock. Iterate every team key in `data/teams.json` (48 teams, dict keyed by canonical name — includes England and Scotland; ISO map also covers non-qualified Wales) and assert `flagFor(name)`: (a) contains `class="flag fi fi-…"` with a non-empty code; (b) when `html.has-flag-svg` is set the visible result is the SVG (Playwright side: computed `background-image` on the `.fi` element is non-none and `color` is transparent per styles.css:4197); (c) node side: the markup's *class list* is the contract — emoji chars may exist inside the span (hidden fallback layer) but never as the only layer. Also assert `rawFlagFor(name)` never returns the white-flag `'🏳'` unknown-fallback for a rostered team (catches ISO-map gaps when the roster changes).
**Files:** `tests/feature/e5-crafted-flags.test.mjs`, `tests/ux/e5-flags.spec.mjs`, `tests/feature/bracket-third-place.test.mjs` (extend its :42 loop from spot-checks to the full roster or delegate to the new file with a cross-reference comment).
**Acceptance criteria:**
- [ ] Node test: for all 48 `data/teams.json` keys, `flagFor(name)` matches `/class="flag fi fi-[a-z-]+"/` — explicitly including England → `fi-gb-eng`, Scotland → `fi-gb-sct`.
- [ ] Node test: `flagFor('Wales')` → `fi-gb-wls` (ISO map coverage beyond the current roster).
- [ ] Node test: `rawFlagFor(name) !== '🏳'` for all 48.
- [ ] Playwright: on `#/home` (or `#/schedule`) with the CDN css loaded, `document.documentElement.classList.contains('has-flag-svg')` is true and every rendered `.flag.fi` has computed `background-image !== 'none'`.
- [ ] Playwright dark mode (`theme` set to dark via the app's Settings toggle or localStorage key): same assertions pass — flags identical in both themes.
- [ ] Gate placement: file runs under `node --test tests/feature/*.mjs` (step 3) and `npx playwright test … tests/ux` (step 4) of the regression gate with zero changes to `tests/playwright.config.mjs` (webServer stays ThreadingHTTPServer).
**Edge cases:** roster churn (test reads `data/teams.json` live, so a future 48-team change self-updates); CDN blocked in the Playwright sandbox — the spec must tolerate `has-flag-emoji-only` by asserting *either* svg-mode assertions *or* (fallback class present AND every `.flag` non-empty), so the gate can't flake on network; renderView `innerHTML` rebuilds — Playwright must re-query `.flag.fi` after any navigation, never hold node handles across route changes.
**QA script:** as named above. `tests/ux/e5-flags.spec.mjs` new spec: `test('all rendered flags are SVG-crafted, light+dark')`. Covers 6/6 criteria; nothing manual.
**Estimate:** M. **Dependencies:** T2, T3.

---

## Story 3 — As a fan spinning the bracket wheel, team flags read as crisp circular badges on the rim (shared API for E6)

### T5 — `flagCircle(team)` — circular-cropped crafted flag variant
**Description:** Additive export in `app/components/team-flag.js`: `flagCircle(team, { size } = {})` returning `<span class="flag flag-circle fi fis fi-<code>" aria-hidden="true">…</span>` — flag-icons' `.fis` gives the 1×1 square artwork (verified shipped in v7 for all codes incl. `fi-gb-eng.fis`), and new CSS clips it: `.flag.flag-circle { border-radius: 50%; width: 1em; height: 1em; display: inline-block; box-shadow: inset 0 0 0 1px var(--border, rgba(0,0,0,.12)); }` appended near styles.css:4206 so it composes with the existing `html.has-flag-svg .flag.fi` rule (the `width:1.33em` at :4201 must be overridden to `1em` by the more specific `.flag.flag-circle`). `size` maps to an inline `font-size` so E6 can scale rim nodes with one knob. Unknown team → circular neutral disc (delegates to T6's placeholder styling, no crash). This is the API §9 consumes ("32 flag nodes" on the rim); document the export signature in a JSDoc block for E6.
**Files:** `app/components/team-flag.js`, `app/styles.css`.
**Acceptance criteria:**
- [ ] `flagCircle('Brazil')` matches `/fi fis fi-br/` and `/flag-circle/`; `flagCircle('England')` → `fi fis fi-gb-eng`.
- [ ] CSS: `.flag.flag-circle` has `border-radius: 50%` and equal width/height (1em), overriding the 1.33em rectangle rule — asserted via Playwright computed style (`borderRadius` ends in `%`, `width === height`).
- [ ] Hairline ring uses a theme token (`var(--border)` fallback) so it's visible on dark surfaces (dark-mode Playwright check: ring not pure-invisible on `#14191E`-class surfaces).
- [ ] `size` option sets inline font-size; omitted → inherits (no inline style attr).
- [ ] Existing `flagFor` output byte-identical for all 48 teams before/after this task (pure addition — regression assert by snapshot in the node test).
- [ ] No existing view changes in this task (E6 is the consumer).
**Edge cases:** unknown/slot team (neutral disc, no `fi` class, no throw); dark mode (ring token); reduced motion (n/a — static); CDN failure (`has-flag-emoji-only`: circle span shows the emoji glyph centered — acceptable, assert non-empty); Dynamic Type (em-based, scales with parent font).
**QA script:** `tests/feature/e5-crafted-flags.test.mjs` — `test('flagCircle emits fis + flag-circle classes, flagFor unchanged')` (incl. the 48-team `flagFor` snapshot diff). `tests/ux/e5-flags.spec.mjs` — inject a `flagCircle` node into a live page via `page.evaluate` (import the module in-page — no build step, plain ESM URL `./app/components/team-flag.js`) and assert computed `border-radius`/size in light + dark. Covers 6/6.
**Estimate:** M. **Dependencies:** T2. **Blocks:** E6 wheel-rim task (E6 must import `flagCircle`, not re-implement).

---

## Story 4 — As a fan viewing an undecided knockout slot, I see a crafted TBD badge, not a blank rectangle or white-flag emoji

### T6 — `flagPlaceholder(slot)` — crafted unresolved-slot badge (shared API for E4)
**Description:** Today unresolved slots either render `'·'` (bracket-view.js:71-72 via `isSlotPlaceholder`, regex `/^\d[A-L]$|^3 [A-L]+$|^W\d+$|^L\d+$/` at bracket-resolver.js:33) or fall into `flagFor('W79')` → white-flag emoji `'🏳'` (team-flag.js:102/110) — the venue-detail P0 in the spec. Add `flagPlaceholder(slot)` to team-flag.js: `<span class="flag flag-tbd" aria-hidden="true"></span>` styled as a neutral rounded chip (surface-2 fill, `var(--border)` hairline, same 1.33em×1em footprint as `.flag.fi` so layouts don't shift; circular when combined with `flag-circle`). Change `flagFor`/`rawFlagFor` to detect `isSlotPlaceholder(team)` (import from `app/bracket-resolver.js` — it's a pure regex, no cycle: bracket-resolver does not import team-flag) and return the placeholder instead of the white-flag emoji. Wire the one confirmed broken consumer now: `venue-detail.js:78-79` (post-T3 shape) gets the TBD chip for W79/W80 lines. This task delivers only the badge API + the safe default; the adjacent human copy ("Winner of Match 79") is E4 T3.2's, which consumes E4's `slotLabel()` (from `app/lib/team-names.js`, itself delegating to the same `isSlotPlaceholder`) and lands AFTER this task.
**Files:** `app/components/team-flag.js`, `app/styles.css`, `app/views/venue-detail.js`.
**Acceptance criteria:**
- [ ] `flagPlaceholder('W79')` returns a `.flag.flag-tbd` span with NO emoji codepoints and NO `fi` class.
- [ ] `flagFor('W79')`, `flagFor('1A')`, `flagFor('3 ABC')`, `flagFor('L103')` all route to the placeholder markup (regex-driven via `isSlotPlaceholder`) — no white-flag emoji in output.
- [ ] `flagFor` for all 48 real teams unaffected (re-run the T4 roster loop).
- [ ] `.flag-tbd` computed size equals `.flag.fi` footprint (1.33em × 1em) so slot rows don't reflow when a slot resolves into a real flag after a FINAL result.
- [ ] Venue-detail W79/W80 lines show the chip + existing slot text; once `data/actual_results.json` resolves the slot (FINAL statuses only — `app/lib/match-status.js` sets; never live/scheduled), the same line renders the real `.fi` flag. Locked with a fixture test, not live data.
- [ ] Unknown non-slot strings (`'Narnia'`) keep today's behavior (plain `.flag` span, white-flag emoji fallback) — placeholder is only for slot codes; no feature/data regression.
**Edge cases:** dark mode (chip uses surface-2/border tokens, visible on dark); pen/ET finals (`STATUS_FINAL_PEN`/AET are FINAL — slot must resolve; use match-status.js sets in the fixture, don't hand-roll); live match feeding the slot (STATUS_FIRST_HALF → slot stays TBD chip); reduced motion (static); `null`/`''` team (placeholder? No — keep current plain-span fallback for null, chip only for matched slot codes, to avoid changing empty-string semantics elsewhere); renderView innerHTML rebuild (chip is stateless markup, safe).
**QA script:** `tests/feature/e5-crafted-flags.test.mjs` — `test('slot codes get crafted TBD chip, never emoji')` (all four slot-code shapes), `test('slot resolves to real flag on FINAL only')` (fixture with `STATUS_FULL_TIME` vs `STATUS_FIRST_HALF` vs `STATUS_FINAL_PEN` through the venue-detail/bracket resolve path using `resolveSlots` from bracket-resolver). `tests/ux/e5-flags.spec.mjs` — Playwright: route to `#/bracket`, assert unresolved slots contain `.flag-tbd` (or `'·'`-free crafted chip) and zero `🏳` text nodes page-wide (`page.locator('text=🏳').count() === 0`); computed-size equality check `.flag-tbd` vs `.flag.fi`. Covers 6/6.
**Estimate:** M. **Dependencies:** T2, T3; sequence after E4 T3.1 (`slotLabel` lib — no code dependency, ordering only). **Blocks:** E4 T3.2 (venue-detail human copy — consumes E4's `slotLabel()` for adjacent copy; must consume this task's `flagPlaceholder`/`.flag-tbd`, never invent its own badge or slot regex). **Chain: E4 T3.1 → E5 T6 → E4 T3.2.**

---

## Epic-level regression gate
Run in order, gate on exit codes (never grep colored output):
1. `python3 scripts/validate_data.py`
2. `bash tests/smoke.sh`
3. `node --test tests/feature/*.mjs tests/competition.test.mjs` — picks up `e5-crafted-flags.test.mjs` automatically
4. `npx playwright test --config tests/playwright.config.mjs tests/ux tests/integrated` — picks up `e5-flags.spec.mjs`; webServer stays ThreadingHTTPServer, untouched.

**No-regression sweep (epic DoD):** the T4 roster loop + T3 emoji scan + T5 `flagFor` snapshot together prove no flag lost, no team lost, no fallback layer removed. Existing `tests/feature/bracket-third-place.test.mjs:42-45` assertions must stay green unmodified (they lock pre-existing behavior this epic extends).
