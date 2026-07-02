# E6-wheel — Circular bracket wheel (A19, `layout=radial`)

**Epic id:** E6-wheel
**Title:** Signature circular/radial bracket as an additive `layout=radial` toggle on Projected
**Goal:** Ship the spec §9 radial bracket as a presentation-only alternate projection of the existing Projected data. Tree stays the default; the wheel is a toggle. Zero model/data changes — reuses `buildAutofill(data, source, {overrides})` (app/bracket-autofill.js:24), module-state `OVERRIDES` + `confidence()` + `strengthMap()` (app/components/projected-bracket-tree.js:32,43,35), and `flagFor()` (app/components/team-flag.js:114).
**Spec refs:** §9 (ring map, legibility rule, feasibility), §3-A19, §5A/§5B (theme palettes), §6 (type scale), §7 (motion tokens), §8 (a11y).

**Hard constraint (owner approval condition):** NO existing data or feature removed. The tree view, model picker, stage nav (GS/R32/R16/QF/SF/F), zoom, what-if overrides, GS seeding view, and path highlight must all keep working unchanged when `layout` is absent or `layout=tree`.

## Files this epic touches

New (E6-owned, no collision):
- `app/components/bracket-wheel.js` — wheel renderer (SVG + interactions)
- `app/components/bracket-wheel-geometry.js` — pure, DOM-free geometry (node-importable)
- `tests/ux/bracket-wheel.spec.mjs` — Playwright specs (auto-picked: gate runs the `tests/ux` dir)
- `tests/feature/bracket-wheel-geometry.test.mjs` — node unit tests

Existing (modified):
- `app/components/projected-bracket-tree.js` — add layout toggle + delegate to wheel when `params.layout === 'radial'`
- `app/styles.css` — `.whl-*` styles, theme-aware tokens, reduced-motion guards

**Shared files (other epics likely touch — coordinate):**
- `app/styles.css` (all visual epics)
- `app/components/projected-bracket-tree.js` (typography epic A1/A2 restyles its headers/pills; **E2 T3 changes slot-name rendering in this file (`.eb-team-name` → `fifaCode(name) || shortTeamName(name)`); rebase E6 on E2's landed text change — canonical order E2 → E6, E2 T3 before E6 T1.2/T3.1**)
- `app/lib/team-names.js` (**E2 T1 owns `fifaCode()` → E4 adds `slotLabel()` — both additive exports; E6 is a read-only consumer and never edits this file**)
- `app/components/team-flag.js` (E5-flags owns it; E6 consumes the circular-cropped variant)
- `tests/ux/projected-bracket.spec.mjs` (E6 extends with a no-regression assertion)

**Cross-epic shared-file map (canonical, identical in all six epic files — the PM builds the collision schedule from this):**
- `app/views/matchup-detail.js` — touched by E3 (whole epic), E2 T5, E1 T2.4 · land order: **E3 → E2 T5 → E1 T2.4**
- `app/views/home-view.js` — touched by E4 T4.1/T4.2, E2 T3/T5, E1 T2.2 · land order: **E4 T4.x → E2 T3/T5 → E1 T2.2** (E4's Today-section structure change lands before E1's type ramp; E2's hmr-row wrap change rebases on E4's Today-section restructure)
- `app/components/large-match-card.js` — touched by E1 T1.3 ('TODAY'→'Today' + pill CSS), E2 T2/T5 (team-cell rewrite) · land order: **E1 T1.3 → E2 T2/T5** (E2's team-cell rewrite rebases on E1's landed 'Today' string so E1's source-string test stays green)
- `app/components/projected-bracket-tree.js` — touched by E2 T3 (slot-name rendering → `fifaCode(name) || shortTeamName(name)`), E6 (layout toggle in `paint()`/`renderStageNav` + exporting/moving module-level `OVERRIDES`, projected-bracket-tree.js:32) · land order: **E2 T3 → E6 T1.2/T3.1** (canonical order E2 → E6; rebase E6 on E2's landed text change)
- `app/lib/team-names.js` — additive exports only: **E2 T1 (`fifaCode`) → E4 (`slotLabel`)**; E6 is a read-only consumer and never edits this file

**Epic dependencies:** E2 T1 (HARD — `fifaCode()` in `app/lib/team-names.js` is owned exclusively by E2 T1 with its ''-for-unknown contract, locked by `tests/feature/r13-team-names.test.mjs`; E6 imports it unchanged and never edits `team-names.js` — see T2.1). E5-flags (circular-cropped flag variant for junction/rim nodes — until it lands, the wheel uses `flagFor()` emoji as-is, so E6 is buildable in parallel with a 1-line swap at the end). Color-token epic (A8, `--gold`) — E6 defines the §5A/§5B hex values as `.whl-*`-scoped custom properties if the global tokens aren't in yet, so no hard block.

---

## Story 1 — As a fan, I can flip the Projected bracket into a circular wheel and back, losing nothing

### T1.1 Pure geometry module (ring map + wedge paths)
**Description.** New `app/components/bracket-wheel-geometry.js`, DOM-free (Math + string building only) so `node --test` can import it. Export `buildWheelLayout(rows)` where `rows` is the `buildAutofill` output `[{matchNumber, team, team_a, team_b}]`. Ring map center→out per §9: Champion disc · Final(2 finalist wedges) · SF(4) · QF(8) · R16(16) · R32 leaves(32 rim slots @ 11.25° pitch = 360/32). Match numbers: R32 73–88 (each match spans 2 adjacent leaves = 22.5°), R16 89–96 (45°), QF 97–100 (90°), SF 101–102 (180°), Final 104 (2 finalist wedges), 3rd-place 103 handled OUTSIDE the wheel (T2.2). Returns `{ wedges: [{matchNumber, ring, team, startAngle, endAngle, d, junction:{x,y}}...], rim: [{slot, angle, team, x, y}...32], core: {team, cx, cy, r} }` plus exported constants `VIEWBOX = '0 0 390 460'` and ring radii. Total wedge count = 32+16+8+4+2 = 62, + 1 champion core = 63 nodes (matches spec "~63 wedge paths"). Unresolved slots (feeder match undecided / placeholder per `isPlaceholder`, projected-bracket-tree.js:28) yield `team: null` wedges — geometry still emits the path so the wheel shape is always complete.
**Files:** `app/components/bracket-wheel-geometry.js` (new), `tests/feature/bracket-wheel-geometry.test.mjs` (new).
**Acceptance criteria:**
- [ ] `buildWheelLayout(rows)` returns exactly 62 wedges + 1 core; rim has exactly 32 slots at 11.25° pitch
- [ ] Wedge↔match mapping exact: ring `r32` covers 73–88, `r16` 89–96, `qf` 97–100, `sf` 101–102, `final` 104; 103 is NOT in the wheel
- [ ] `VIEWBOX === '0 0 390 460'` (spec §9: viewBox 0 0 390 ~460)
- [ ] Module imports cleanly in bare node (no `document`/`window` references)
- [ ] Empty/partial `rows` (e.g. only R32 decided) still returns the full 63-node shape with `team: null` on unresolved wedges — never throws
- [ ] No feature/data regression: module is purely additive, imports nothing that mutates state
**Edge cases:** empty rows array; rows missing the Final (104); duplicate matchNumbers; placeholder team strings ("W79", "1A") must map to `team: null`; angles wrap correctly at 360°→0°.
**QA script:** `tests/feature/bracket-wheel-geometry.test.mjs` (new, node --test — already in the gate's `tests/feature/*.mjs` glob). Asserts: counts (62/32/1), matchNumber→ring table for all of 73–104 incl. 103 excluded, 11.25° rim pitch (`rim[i+1].angle - rim[i].angle === 11.25`), VIEWBOX string, null-team on synthetic placeholder input, no-throw on `[]`. Covers 100% of criteria — no manual step.
**Estimate:** M. **Dependencies:** none (first task, pure).

### T1.2 Layout toggle on Projected (`layout=radial`), tree stays default
**Description.** In `app/components/projected-bracket-tree.js`: `paint()` (line 58) reads `params.layout`; when `'radial'` and stage ≠ 'gs', render the wheel via `renderBracketWheel(root, {rows: ovRows, modelRows, smap, ...})` from `app/components/bracket-wheel.js` instead of `renderTree` (line 119) — model picker + stage nav stay mounted above either layout. Add a two-segment Tree|Wheel control into `renderStageNav` (line 86) next to the zoom group, `data-testid="eb-layout-toggle"`, wired like the stage buttons: `setRoute(routeName, { model, stage, zoom, layout })` (state.js:54 already round-trips arbitrary params through the hash, path- or query-style — `#/projected?layout=radial` works today with zero router change; main.js:305 `renderProjectedShim` already spreads params through). No `layout` param (or `layout=tree`) ⇒ exactly today's tree. GS stage ignores the toggle (seeding view unchanged); the toggle is hidden or disabled on GS.
**Files:** `app/components/projected-bracket-tree.js`, `app/components/bracket-wheel.js` (new stub: renders `<svg data-testid="wheel-svg">` from T1.1 geometry, unpopulated), `app/styles.css`.
**Acceptance criteria:**
- [ ] `#/projected` with no `layout` param renders the existing tree — `[data-testid="eb-bracket"]`, `.eb-match` count > 20, `.eb-conf` present (today's assertions still pass verbatim)
- [ ] Toggle visible on rounds stages, 44pt min tap target (§8); tapping Wheel navigates to `layout=radial` and renders `[data-testid="wheel-svg"]` with viewBox `0 0 390 460`
- [ ] Toggle survives model/stage/zoom changes (layout param carried through every `setRoute` call in the nav)
- [ ] Tapping Tree returns to the tree with what-if `OVERRIDES` intact (module state, projected-bracket-tree.js:32 — survives by construction; assert it)
- [ ] Wheel is responsive: SVG scales to container width (width:100%, height:auto)
- [ ] No feature/data regression: GS seeding, zoom, reset, BR-7 path highlight all unchanged with layout unset
**Edge cases:** unknown `layout` value (`layout=banana` ⇒ tree, never crash); direct deep-link `#/projected?layout=radial&model=dt&stage=qf`; GS stage with `layout=radial` in the URL (seeding view renders, no wheel); model data still loading (empty rows ⇒ same "Projection unavailable" card as tree, paint() line 78).
**QA script:** `tests/ux/bracket-wheel.spec.mjs` (new) — test "toggle: default tree, radial opt-in": goto `#/projected`, assert tree testids + zero `wheel-svg`; click `[data-testid="eb-layout-toggle"] [data-layout="radial"]`, expect URL `/layout.radial|layout=radial/`, `wheel-svg` visible, viewBox attr exact; click back to tree, expect `.eb-match` count > 20 again; goto `#/projected?layout=banana`, expect tree + zero pageerrors. PLUS extend `tests/ux/projected-bracket.spec.mjs` first test with one line: `expect(await page.locator('[data-testid="wheel-svg"]').count()).toBe(0)` (locks tree-default). Covers all criteria except real-device feel — manual smoke: flip the toggle once on iPhone Safari.
**Estimate:** M. **Dependencies:** T1.1.

---

## Story 2 — As a fan, I see a populated wheel: flags at every junction, codes on the rim, the champion at the core

### T2.1 Populate the wheel: junction flags, rim codes, winning path, confidence pills, champion core
**Description.** In `app/components/bracket-wheel.js`, bind `ovRows` (override-aware `buildAutofill` output) onto the T1.1 geometry: (a) advancing team's flag at each inward junction — 62 junction nodes, using E5-flags' circular-cropped variant (interim: `flagFor()` emoji in an SVG `<text>` node); (b) 32 rim slots: flag + 3-letter code via `import { fifaCode } from '../lib/team-names.js'` — the helper is owned by E2 T1 (''-for-unknown contract: `'W79'`, `'2A'`, `''`, `null` → `''`; locked in `tests/feature/r13-team-names.test.mjs`) and E6 consumes it UNCHANGED, no edits to `team-names.js`. Display fallback lives at the wheel call site only: `const rimCode = fifaCode(name) || (isPlaceholder(name) ? '' : name.slice(0,3).toUpperCase())` (reuse `isPlaceholder`, projected-bracket-tree.js:28). When `rimCode === ''` (unresolved slot) the rim slot renders the existing neutral dashed placeholder — never a fake trigram like 'W79'. Codes render Caption2 style 11pt Semibold +0.6 (§6); (c) winning path: the projected champion's chain of wedges gets `.whl-path` with `stroke-width` scaled by `confidence()` (map conf 50→100% onto 2→6px, `--whl-path-w` custom property per wedge); (d) confidence pills: per legibility rule (§9) pills render ONLY on the focused wedge (T3.1) and the champion — pill = conf% in Caption1 12pt Medium, `#06210F` on `#4ADE80` (§8, ~8:1); (e) champion core disc: circular flag + team name (Headline 17pt Semibold §6) + title odds — `prob_pct` for the champion from `data.markets.tournament_winner` when present, else the product of the champion's per-round `confidence()/100` values, rendered "Brazil 24%"; if neither computable, name only (never "NaN%"). Unresolved wedges/rim slots render a neutral dashed slot (empty-state, A7 — honest, not blank).
**Files:** `app/components/bracket-wheel.js`, `app/styles.css`. (`app/lib/team-names.js` is READ-ONLY for E6 — `fifaCode()` is imported from E2 T1's implementation, never modified here.)
**Acceptance criteria:**
- [ ] 32 rim nodes each show flag + 3-letter code (ENG, COD…): `.whl-rim-abbr` text length ≤ 3, never a truncated full name (A2: no clipped proper nouns anywhere on the wheel)
- [ ] Every resolved inward junction shows the advancing team's flag (`.whl-junction-flag` count === resolved advancements); unresolved junctions show the dashed placeholder, count(junction flags) + count(placeholders) === 62
- [ ] Winning path wedges carry `.whl-path` with stroke-width varying by confidence (at least 2 distinct computed widths across a real dataset)
- [ ] Champion core shows flag + name + odds text matching `/^\S.* \d{1,2}%$/` (e.g. "Brazil 24%"), tabular figures (§6)
- [ ] Legibility rule: with nothing focused, zero team-name `<text>` nodes outside the rim codes + champion core (names/conf only for focused wedge or champion)
- [ ] Rim code sourcing honors E2 T1's contract: unresolved slot names (`'W79'`, `'2A'`, …) where `fifaCode()` returns `''` render the dashed placeholder rim slot with NO trigram text; the call-site `slice(0,3)` fallback applies ONLY to resolved real team names missing from the FIFA table; `fifaCode()` itself is not modified (r13-team-names.test.mjs stays green)
- [ ] No feature/data regression: tree view byte-identical behavior with layout unset
**Edge cases:** all-placeholder bracket (pre-R32-resolution: rim shows seed slots "1A/2B…" as dashed placeholders, core shows "TBD" no %); champion missing from `markets.tournament_winner` (fallback product path); conf `null` (placeholder opponent, projected-bracket-tree.js:44 → no pill, default 2px path); dark mode (T4.1); long names irrelevant by design (codes only) — that IS the Dynamic Type story on the rim; emoji flag fallback (globe) for unmapped teams.
**QA script:** split: (1) `tests/feature/bracket-wheel-geometry.test.mjs` — the `fifaCode()` unit table lives in E2's `tests/feature/r13-team-names.test.mjs`, NOT here; this file only tests the wheel's call-site fallback: export `rimCodeFor(name)` as a pure fn from bracket-wheel-geometry.js and assert `rimCodeFor('England')==='ENG'` (via imported fifaCode), `rimCodeFor('W79')===''` and `rimCodeFor('2A')===''` (dashed placeholder, no fake trigram), `rimCodeFor('Newlandia')==='NEW'` (resolved-but-unmapped fallback only). Also a champion-odds-format unit if odds math is exported as a pure fn (export `championOddsLabel(data, rows)` from bracket-wheel-geometry.js to keep it node-testable). (2) `tests/ux/bracket-wheel.spec.mjs` test "populated wheel": goto `#/projected?layout=radial`, assert `.whl-rim-node` count === 32, `.whl-wedge` count === 62, every `.whl-rim-abbr` textContent length ≤ 3, `.whl-core` text matches the odds regex or "TBD", `.whl-path` exists with ≥2 distinct `stroke-width` computed values, zero `.whl-name` nodes outside core when unfocused. Covers ~95% — manual smoke: eyeball flag crops on one junction after E5-flags lands.
**Estimate:** L. **Dependencies:** E2 T1 (HARD — `fifaCode()` must land first; E6 imports it unchanged), T1.1, T1.2; E5-flags for final flag variant (soft — emoji interim).

### T2.2 Third-place chip below the wheel
**Description.** Match 103 is not a ring (§9) — render it as a compact chip row under the SVG inside the wheel container: "3rd place · {flagA} AAA vs {flagB} BBB → {flag} winner conf%", built from `byNum.get(103)` exactly like the tree's third column (projected-bracket-tree.js:140-141). Tappable (hooks into T3.1 focus/override like any wedge).
**Files:** `app/components/bracket-wheel.js`, `app/styles.css`.
**Acceptance criteria:**
- [ ] `[data-testid="whl-third"]` renders below the SVG when match 103 resolves; shows both teams as flag+code and the projected winner with conf%
- [ ] Hidden (or dashed placeholder) when 103's slots are placeholders — never renders "W101 vs W102" raw slot codes without the placeholder styling
- [ ] Chip tap opens the same focus breakdown as a wedge (T3.1) and accepts an override
- [ ] No feature/data regression: tree's 3rd-place column untouched
**Edge cases:** 103 unresolved (pre-SF); 103 decided by real result (override must be ignored for FINAL matches — `resolveSlots` already enforces actual-results-win, bracket-autofill.js:30, assert the UI reflects it); pen/ET-decided semis feeding 103 (winner extraction is upstream in `winnerFromRecord`, app/lib/match-status.js:106 — display only, no new status logic).
**QA script:** `tests/ux/bracket-wheel.spec.mjs` test "third-place chip": with the real dataset assert `whl-third` visibility rule (present iff `.whl-core` isn't TBD-only… concretely: if resolved, visible with two 3-letter codes + conf pill; tap it → `[data-testid="wheel-focus"]` shows match 103). Covers all criteria automated.
**Estimate:** S. **Dependencies:** T2.1, T3.1 (tap wiring lands with T3.1).

---

## Story 3 — As a fan, I tap any tie on the wheel to see the full breakdown and play what-if, and my picks survive re-renders

### T3.1 Tap a wedge → focus breakdown + what-if override → re-cascade repaint
**Description.** Calm by default; tap to expand (§9 legibility rule). One delegated `click` listener on the wheel container (same pattern as the tree, projected-bracket-tree.js:148-154). Tap wedge/rim/chip → set module-level `_focusedMatch` and repaint: focused wedge lifts (stroke highlight), and a breakdown panel `[data-testid="wheel-focus"]` renders below the SVG: both teams (flag + FULL name — the one place full names appear), conf% pill each side, and two pick buttons. Picking the non-projected team writes `OVERRIDES[mn] = team` — the SAME shared object the tree uses (import it; export `OVERRIDES` from projected-bracket-tree.js or move it to a tiny shared module `app/components/bracket-overrides.js` re-exported by the tree so tree behavior is unchanged) — then re-runs `buildAutofill(data, source, {overrides: OVERRIDES})` and repaints the wheel: downstream junction flags, winning path, and champion core all re-cascade. Tapping the same pick again clears it (toggle, mirrors tree line 152). Reset control shows override count and clears all, matching `eb-reset` semantics (line 104). Overridden wedges get `data-overridden="1"` + a `✎` marker (parity with tree's `eb-override`).
**Files:** `app/components/bracket-wheel.js`, `app/components/projected-bracket-tree.js` (export/move `OVERRIDES` — no behavior change), `app/styles.css`.
**Acceptance criteria:**
- [ ] Tap wedge → `wheel-focus` panel with both FULL team names (wrap, never ellipsize — A2), per-team conf pills, 44pt pick buttons
- [ ] Override pick → champion core/junctions/path update in the same paint (assert core text changes when overriding a Final pick)
- [ ] Overrides are SHARED with the tree: set one on the wheel, toggle to tree, `.eb-match[data-overridden]` count ≥ 1; and vice versa
- [ ] Reset clears all overrides on both layouts; second tap on same pick un-sets it
- [ ] Decided (FINAL-status) matches: pick buttons disabled/inert — actual results always win (STATUS-GATING: only `FINAL_STATUSES`, app/lib/match-status.js:26, lock a tie; live/scheduled ties stay overridable)
- [ ] No feature/data regression: tree what-if (BR-6) and reset behave exactly as before the `OVERRIDES` export refactor
**Edge cases:** tap on unresolved wedge (focus shows "Winner of M89 vs Winner of M90" placeholders, no pick buttons); tap during data-load repaint (see T3.2); pen/ET-decided matches (STATUS_FINAL_PEN / AET are in `FINAL_STATUSES` — locked like any FT); override on R32 that eliminates the current champion (core must change); focus panel open when its match becomes decided by a live update (panel re-derives lock state on repaint).
**QA script:** `tests/ux/bracket-wheel.spec.mjs` test "tap→override→re-cascade" using the same `toPass`-retry scan as projected-bracket.spec.mjs:56-71 (re-render-safe): find an undecided wedge, read `.whl-core` text, tap, pick the non-projected team, assert `[data-overridden]` appears + reset visible; toggle to tree layout and assert `.eb-match[data-overridden]` ≥ 1 (shared state); reset → both clear. Plus a node test in `tests/feature/bracket-wheel-geometry.test.mjs`: overriding a synthetic Final row flips the layout's `core.team` (pure re-derivation). Covers all criteria automated.
**Estimate:** M. **Dependencies:** T2.1.

### T3.2 Re-render resilience: listeners + focus/toggle state survive `renderView` innerHTML rebuilds
**Description.** Known gotcha (BR-6 history, and the comment block at tests/ux/projected-bracket.spec.mjs:46-55): deferred feeds + live-poller ticks rebuild `root.innerHTML` 1–2s after first paint, destroying the wheel's DOM + listener mid-tap. Design for it the way the tree does: (a) ALL interactive listeners are attached inside the component render on elements it just created (delegated on the wheel container — never on `document` or stale nodes); (b) all interaction state lives in module scope and survives: `OVERRIDES` (already does), `_focusedMatch`, and the layout choice (in the URL via `setRoute`, so re-render re-reads it — paint() derives everything from `params` + module state); (c) after any repaint, if `_focusedMatch` is set, the focus panel re-renders open and the focused wedge re-highlights — a feed-driven rebuild must not silently close the breakdown or flip the user back to tree.
**Files:** `app/components/bracket-wheel.js` (structure), no new files.
**Acceptance criteria:**
- [ ] Wheel + focus panel + override markers fully reappear after a forced re-render (test triggers `renderProjectedShim` again by re-navigating with identical params or dispatching hashchange)
- [ ] `layout=radial` persists across live-poller/deferred-feed repaints (URL-derived — assert the wheel is still there 3s after first paint on a real page load)
- [ ] No listener leaks: repeated repaints don't stack handlers (a single tap toggles an override exactly once — assert override count is 1, not 0-because-double-toggled)
- [ ] No feature/data regression: tree's re-render behavior (locked by projected-bracket.spec BR-6 test) still green
**Edge cases:** tap landing in the exact rebuild window (the toPass-retry pattern is the test-side answer; the app-side answer is module state, so a lost tap is retriable and a landed tap is never un-done by the rebuild); scroll position of the focus panel after rebuild (acceptable to re-render at same document position, no jump-to-top); back/forward through layout toggles (hash history replays cleanly).
**QA script:** `tests/ux/bracket-wheel.spec.mjs` test "survives re-render": goto `#/projected?layout=radial`, set an override (retry pattern), then `page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')))` + wait for `wheel-svg`; assert override marker still present, focus panel restored, and a single fresh tap on the same pick clears it (proves exactly-one listener). Also `await page.waitForTimeout(3000)` after initial load and assert `wheel-svg` still attached (feed-repaint persistence). Covers all criteria automated.
**Estimate:** M. **Dependencies:** T3.1.

---

## Story 4 — As a fan, the wheel looks right in my theme, respects my motion settings, and works with VoiceOver

### T4.1 Theme-aware styling: light/teal (§5A) and dark/gold (§5B), reduced motion
**Description.** Style with CSS custom properties scoped under `.whl-root`, switched by the existing `:root[data-theme='dark']` mechanism (theme.js sets `documentElement.dataset.theme`; styles.css:40 is the dark block — same selector, additive rules only). Light (§5A): surface `#FFF` on bg `#F4F7F9`-family, wedge strokes `--primary #0E7490`, hero-teal accents `#0891B2`, winning path teal, champion accent `--gold #E7B03C`. Dark (§5B): canvas `#0A0E1A`, wedges on the dark elevation ramp (§8: `#171A21`/`#1E222B`, hairline `#2E3340`), winning path + champion core GOLD `#F59E0B` (deep `#B45309` for depth), cyan `#22D3EE` only as electric accent, soft gold glow on the core (CSS `filter: drop-shadow`, NOT SMIL). Re-cascade transition: wedge fill/stroke animate `--dur-base 210ms` `--ease-standard cubic-bezier(.22,1,.36,1)` (§7); focus-open uses `--dur-fast 150ms`. ALL animation inside `@media (prefers-reduced-motion: reduce)` guards → none (repo already has 5 such blocks, styles.css:2350 etc. — same pattern).
**Files:** `app/styles.css`, `app/components/bracket-wheel.js` (class hooks only).
**Acceptance criteria:**
- [ ] Light mode: winning path computed stroke is the teal family (`#0E7490`), champion accent `#E7B03C`
- [ ] Dark mode (`data-theme='dark'`): champion core/path gold `#F59E0B`; canvas/wedge fills from the dark ramp; NO black-on-cyan text anywhere on the wheel (A6/§8)
- [ ] Confidence pills keep `#06210F` on `#4ADE80` in BOTH themes (§8, ~8:1)
- [ ] All text on the wheel ≥ 4.5:1 contrast in both themes (rim codes, core label, focus panel)
- [ ] `prefers-reduced-motion: reduce` ⇒ zero transitions/animations on `.whl-*` (transition-duration computes to 0s or property unset)
- [ ] Theme flip does NOT lose wheel state (overrides/focus survive — pure CSS swap, no re-render needed)
- [ ] No feature/data regression: no changes to existing selectors in styles.css, additive `.whl-*` rules only
**Edge cases:** `theme=auto` following system dark; theme toggled while focus panel open; gold glow under reduced-motion (static drop-shadow is fine, animated pulse is not); Playwright forced-colors not required but don't break `forced-colors` (no info conveyed by color alone — path also has width, champion also has the core position).
**QA script:** `tests/ux/bracket-wheel.spec.mjs` test "theme + reduced motion": load `#/projected?layout=radial`, read `getComputedStyle` stroke of `.whl-path` (expect rgb(14,116,144) family); `page.evaluate(() => { localStorage.setItem('wc26.theme','dark'); document.documentElement.dataset.theme='dark'; })`, assert path/core computed color is rgb(245,158,11) family and overrides still present; new context with `reducedMotion: 'reduce'` (Playwright `contextOptions`/`page.emulateMedia`), assert `.whl-wedge` computed `transition-duration === '0s'`. Contrast: 1-line manual smoke (run the existing a11y eyeball on both theme screenshots) — everything else automated.
**Estimate:** M. **Dependencies:** T2.1; coordinates with the color-token epic on `--gold` (E6 ships scoped fallbacks either way).
**QA note:** do NOT touch `tests/playwright.config.mjs` — webServer stays ThreadingHTTPServer.

### T4.2 Accessibility: VoiceOver grouping, roles, hit targets
**Description.** §8 applied to the wheel: SVG gets `role="group"` + `aria-label="Projected knockout wheel"`; each tappable wedge/rim node is `role="button"`, `tabindex="0"`, keyboard-activatable (Enter/Space call the same handler — mirror the tree's `role="button" tabindex="0"` on `eb-tappable`, projected-bracket-tree.js:114), with a ONE-element label per tie: `"Quarterfinal 97: Brazil vs France. Projected: Brazil, 68 percent. Double-tap to view and override."`. Champion core label includes the odds ("Projected champion: Brazil, 24 percent title odds"). Focus panel pick buttons ≥ 44pt; wedge/rim hit areas padded to ≥ 44pt via transparent stroke widening (`pointer-events` stroke), not visual size. Decorative geometry (`.whl-grid`, connector arcs) `aria-hidden="true"`.
**Files:** `app/components/bracket-wheel.js`, `app/styles.css`.
**Acceptance criteria:**
- [ ] Every interactive node: `role="button"` + `tabindex="0"` + non-empty `aria-label` containing both team names (or slot placeholders) and the conf% for the projected winner
- [ ] Keyboard: Tab reaches wedges; Enter opens the same focus panel as tap; Enter on a pick sets the override
- [ ] All tap targets ≥ 44×44 CSS px effective hit area (bounding box of the interactive element incl. padding/stroke)
- [ ] Decorative nodes `aria-hidden`; exactly one label per tie (VoiceOver reads a match as one element, not 4 fragments — §8)
- [ ] No feature/data regression: tree a11y attributes untouched
**Edge cases:** placeholder ties (label says "Winner of match 89 vs winner of match 90 — not yet decided", no "double-tap to override"); decided ties (label appends "Final." and drops the override hint); focus order after repaint (focused element restored or focus moved to the focus panel, never lost to `<body>`); Dynamic Type — focus panel text wraps at 2× size, no clipping.
**QA script:** `tests/ux/bracket-wheel.spec.mjs` test "a11y contract": assert every `.whl-wedge[data-match] , .whl-rim-node[data-match]` has role/tabindex/aria-label (regex: two names + `%` when resolved); `page.keyboard.press('Tab')` until a wedge is `document.activeElement`, press Enter, expect `wheel-focus` visible; measure `boundingBox()` of 5 sampled interactive nodes ≥ 44×44. Dynamic Type wrap: manual smoke, 1 line (iOS Settings → larger text → open focus panel). ~90% automated.
**Estimate:** S. **Dependencies:** T3.1, T4.1.

---

## Regression gate (every task merges only when 100% green, in order)
1. `python3 scripts/validate_data.py`
2. `bash tests/smoke.sh`
3. `node --test tests/feature/*.mjs tests/competition.test.mjs` (picks up `bracket-wheel-geometry.test.mjs`)
4. `npx playwright test --config tests/playwright.config.mjs tests/ux tests/integrated` (picks up `bracket-wheel.spec.mjs`; existing `projected-bracket.spec.mjs` locks the tree default)

## Task order
T1.1 → T1.2 → T2.1 → {T2.2, T3.1} → T3.2 → T4.1 → T4.2. Critical path: T1.1→T1.2→T2.1→T3.1→T3.2. Cross-epic: E2 T1 must merge before T2.1 (fifaCode import). E5-flags can land any time before release (1-line swap in T2.1).
