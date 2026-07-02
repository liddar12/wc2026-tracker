# E3-match-state · Decided + live match-state correctness (A4 + A5)

**Epic id:** `E3-match-state`
**Goal:** The matchup page must respect match state. Decided matches (FT / AET / PEN) stop rendering pre-match 50/50 bars, "Hybrid pick <loser>" and an interactive "Your pick" as if the match were upcoming — they get a retrospective "Result vs model" block instead. Live matches get an unmistakable red LIVE badge + pulsing dot + current minute, and the live win-probability is explicitly labeled live.
**Spec references:** §2 problem 5 (data-state correctness), §3 A4 + A5, §5A palette (`--danger #DC2626` badge red), §6 type scale (Caption2 11/13 Semibold +0.6 for status micro-pills), §7 motion tokens (honor `prefers-reduced-motion`), §8 (VoiceOver grouping — result reads as one element).
**Hard constraint:** NOTHING is removed. The model's pre-match numbers (W/D/L bar, hybrid pick, composite, "Why this prediction", upset signals, market column) all stay visible on decided matches — re-framed as pre-match/retrospective, never deleted. The user's pick stays visible after FT. Every task carries a no-regression AC.

## Files this epic touches (verified paths)

| File | Change |
|---|---|
| `app/views/matchup-detail.js` | Mode-aware section shaping (the whole epic lands here) |
| `app/components/result-vs-model.js` | **NEW** — retrospective "Result vs model" block |
| `app/lib/model-verdict.js` | **NEW** — pure verdict derivation (called-it / missed / no-model) |
| `app/components/win-probability.js` | Live labeling copy (already emits `LIVE {min}'`) |
| `app/components/status-pill.js` | Reuse `liveMinuteLabel()` (export it); no behavior change |
| `app/styles.css` | `.detail-live-badge` (red pill + pulsing dot), retro-block styles, reduced-motion guards |
| `app/lib/i18n.js` + `app/lib/strings.es.js` | New strings (verdict copy, "Pre-match model", "Your pick (locked)") — EN/ES parity |
| `app/lib/match-status.js` | **READ-ONLY dependency** — canonical `FINAL_STATUSES` / `LIVE_STATUSES` / `deriveMode()`; do not fork status sets |

**Shared files (other epics likely touch too):** `app/styles.css` (A1/A6/A8 token work), `app/lib/i18n.js` + `app/lib/strings.es.js` (any copy change), `app/views/matchup-detail.js` (E2 T5 stage-label swap AND E1 T2.4 typography re-header the same view — land order **E3 → E2 T5 → E1 T2.4**), `app/components/win-probability.js` (A12 motion work). Coordinate merges; E3 lands first on matchup-detail, then E2 T5 and E1 T2.4 rebase on it.

**Cross-epic shared-file map (canonical, identical in all six epic files — the PM builds the collision schedule from this):**
- `app/views/matchup-detail.js` — touched by E3 (whole epic), E2 T5, E1 T2.4 · land order: **E3 → E2 T5 → E1 T2.4**
- `app/views/home-view.js` — touched by E4 T4.1/T4.2, E2 T3/T5, E1 T2.2 · land order: **E4 T4.x → E2 T3/T5 → E1 T2.2** (E4's Today-section structure change lands before E1's type ramp; E2's hmr-row wrap change rebases on E4's Today-section restructure)
- `app/components/large-match-card.js` — touched by E1 T1.3 ('TODAY'→'Today' + pill CSS), E2 T2/T5 (team-cell rewrite) · land order: **E1 T1.3 → E2 T2/T5** (E2's team-cell rewrite rebases on E1's landed 'Today' string so E1's source-string test stays green)
- `app/components/projected-bracket-tree.js` — touched by E2 T3 (slot-name rendering → `fifaCode(name) || shortTeamName(name)`), E6 (layout toggle in `paint()`/`renderStageNav` + exporting/moving module-level `OVERRIDES`, projected-bracket-tree.js:32) · land order: **E2 T3 → E6 T1.2/T3.1** (canonical order E2 → E6; rebase E6 on E2's landed text change)
- `app/lib/team-names.js` — additive exports only: **E2 T1 (`fifaCode`) → E4 (`slotLabel`)**; E6 is a read-only consumer and never edits this file

**Build gotchas honored:** `renderView()` rebuilds `root.innerHTML` on every `data:live-refresh` (30s) — all state here must be derived from data on each render, never held in the DOM; scroll survives via `pendingLiveRefresh` (`app/main.js:83-180`). Status-gating stays untouched: this epic is display-only, it never writes results, advances brackets, or awards points. Playwright webServer stays `ThreadingHTTPServer` (`tests/playwright.config.mjs`).

---

## Story 1 — Decided-match retrospective (A4)

*As a fan opening a finished match, I want the final result and how the model did — not a stale pre-match pitch that pretends the game hasn't happened.*

### Task 1.1 · Pure verdict helper `modelVerdict(match, rec)`

**Description.** New pure module `app/lib/model-verdict.js` (no DOM — mirrors `app/lib/match-status.js` style). Input: the matchup row + the `actual_results` record. Output: `{ state:'called'|'missed'|'draw-called'|'no-model'|'not-final', modelSide, modelTeam, modelPct, actualSide, actualTeam, method }`.
- Model side: group rows via `modelChoice(match)` (`app/predictions.js:11` — handles `predicted_winner:'draw_likely'`); knockout rows via the larger of `advance_pct_a`/`advance_pct_b` when `predicted_winner` is absent.
- Actual side: `winnerFromRecord(rec, team_a, team_b)` + `methodOfVictory(rec)` from `app/lib/match-status.js` — **never** derive a PEN/AET winner from the score (regulation score is a tie; `rec.winner` is authoritative).
- `modelPct`: the model's pre-match % for its pick (group: `probabilities.team_a_wins`/`draw`/`team_b_wins`; knockout: `advance_pct_*`) — this is what feeds "leaned Japan 37%".
- Returns `not-final` unless `isFinalStatus(rec)`; returns `no-model` when the row has no model fields (bare `scheduleFull` fixture — `matchup-detail.js:52` `hasModel` gate).

**Files:** `app/lib/model-verdict.js` (new).

**Acceptance criteria**
- [ ] `modelVerdict` imports status truth ONLY from `app/lib/match-status.js` (no local status sets).
- [ ] Group match, model favored winner → `state:'called'`, `modelPct` = the favorite's pre-match %.
- [ ] Group match, model favored the loser → `state:'missed'` with `modelTeam` + `modelPct` (the "leaned Japan 37%" inputs).
- [ ] Group draw with `predicted_winner:'draw_likely'` → `state:'called'`, `actualSide:'draw'`.
- [ ] Knockout PEN record (`STATUS_FINAL_PEN`, tied score, `rec.winner` set) → `actualTeam` = `rec.winner`, `method:'pens'`; AET → `method:'aet'`.
- [ ] Live (`STATUS_HALFTIME`), scheduled stub (`STATUS_SCHEDULED` 0-0), and missing record → `state:'not-final'`.
- [ ] Model-less row + final record → `state:'no-model'`.
- [ ] No feature/data regression: module is additive; zero imports change elsewhere in this task.

**Edge cases:** PEN/AET tied regulation score; legacy record with no `status` (treated final per `isFinalStatus`); `advance_pct_a === advance_pct_b`; `predicted_winner` present on a knockout row; `NaN`/missing probabilities.

**QA script (automated):** **new `tests/feature/matchup-decided-state.test.mjs`** — `node --test` unit table (no DOM needed): assert every AC above with fixture rows/records, including a `STATUS_FINAL_PEN` record `{score_a:1,score_b:1,winner:'Morocco',shootout_a:4,shootout_b:3}` and a halftime record returning `not-final`. Covers 8/8 ACs (100%).

**Estimate:** S · **Dependencies:** none.

---

### Task 1.2 · "Result vs model" retrospective block

**Description.** New component `app/components/result-vs-model.js` → `resultVsModel(match, rec, verdict)`. Renders (final matches only; returns empty `DocumentFragment` otherwise, matching the `previewSection`/`renderMatchStats` empty-fragment convention):
1. **Result line, prominent:** `Japan 1 – 2 Senegal` with method label from `methodOfVictory` (`FT` implied, `after extra time`, `on penalties (4–3)` — reuse the exact en-dash/hi–lo suffix already produced at `matchup-detail.js:253-255`).
2. **Verdict line:** `✓ Model called it — Senegal 63%` or `✗ Missed — leaned Japan 37%`; `no-model` → `Final result` only, no verdict claim.
3. **Pre-match numbers preserved:** the verdict line always names the model's pick + its pre-match % — the same prediction, reshaped, not deleted.
Mount it in `app/views/matchup-detail.js` at the TOP of the model column (before `confidenceBar`, `matchup-detail.js:154-163`) when `found?.mode === 'final'` (`found` already computed at line 93). The existing bottom "Final result" section (lines 246-268) stays (it is a tested feature — `knockout-detail-finals.test.mjs`).

**Files:** `app/components/result-vs-model.js` (new), `app/views/matchup-detail.js`, `app/styles.css`, `app/lib/i18n.js`, `app/lib/strings.es.js`.

**Acceptance criteria**
- [ ] Block renders with `data-testid="result-vs-model"` on final matches only; empty fragment for live/upcoming/pending.
- [ ] Missed verdict shows `✗ Missed — leaned <modelTeam> <modelPct>%` (exact "leaned X NN%" shape); called shows `✓ Model called it — <team> <pct>%`.
- [ ] PEN final shows the shootout suffix `(hi–lo)` en-dash format; AET shows "after extra time".
- [ ] VoiceOver (§8): the block has one grouped accessible label, e.g. `aria-label="Final: Senegal 2, Japan 1, on penalties. Model leaned Japan 37 percent — missed."`.
- [ ] Verdict text ≥ Footnote 13pt; result line uses Title2-class weight (§6) — no new ALL-CAPS headers.
- [ ] EN + ES strings added in the same commit (i18n parity — `tests/feature/i18n.test.mjs` stays green).
- [ ] **No feature/data regression:** the model/market grid, composite breakdown, "Why this prediction", upset signals, market column, and the bottom "Final result" section ALL still render on the same page (locked by test).

**Edge cases:** group draw ("Drawn — model called the draw"); `no-model` knockout fixture (result only, no fabricated verdict); long team names (wrap, never clip — Dynamic Type); dark mode (use tokens, no hardcoded ink); missing `shootout_*` on a PEN record (suffix omitted, no `(NaN–NaN)`).

**QA script (automated):** extend **`tests/feature/matchup-decided-state.test.mjs`** — render via the DOM shim pattern from `tests/feature/rj30-winprob-render.test.mjs`: assert testid presence/absence per mode, verdict copy for called/missed/PEN/draw/no-model fixtures, aria-label content, and (regression) that a full `renderMatchupDetail` on a final fixture still contains `composite-grid`, `Why this prediction`, market column, and `final-result` testid. Plus **`tests/ux/matchup-state.spec.mjs` (new Playwright)**: `page.route('**/data/actual_results.json')` to serve a fixture with one FT group result + one PEN knockout result → assert the block is visible, and dark-mode + text-contrast smoke via `page.emulateMedia({colorScheme:'dark'})`. ~95% AC automated; manual smoke: 1-line VoiceOver read-through on device.

**Estimate:** M · **Dependencies:** Task 1.1.

---

### Task 1.3 · Re-frame (not remove) the pre-match model sections on decided matches

**Description.** In `app/views/matchup-detail.js`, when `found?.mode === 'final'`:
- `confidenceBar(match,{title})` (lines 159, 162) gets title `Pre-match model` (group) / `Pre-match regulation odds (W / D / L)` (knockout) instead of `Model` / `Regulation result (W / D / L)` — the same bars, same numbers, honest framing.
- `hybridPill` (`matchup-detail.js:466-485`) label becomes `Hybrid pick (pre-match)` on final matches — kills the "HYBRID PICK <loser>" read while keeping the pick + % visible.
- `advanceHeadline` (line 384) heading becomes `To advance (pre-match)` on final knockout matches.
Title is a param already (`confidenceBar` line 5); pass mode-aware titles from the view — no component fork.

**Files:** `app/views/matchup-detail.js`, `app/components/confidence-bar.js` (only if a subtitle slot is needed), `app/lib/i18n.js`, `app/lib/strings.es.js`.

**Acceptance criteria**
- [ ] On a final match the W/D/L bar renders with the exact same segment widths/percent labels as pre-match (numbers untouched) under a "Pre-match model" title.
- [ ] Hybrid pill on a final match reads `Hybrid pick (pre-match)` + team + %; on upcoming matches copy is unchanged (`Hybrid pick`).
- [ ] Upcoming and live matches render titles exactly as today (zero diff for non-final modes).
- [ ] **No feature/data regression:** bar, pill, composite, why, upset sections all still present on final matches; `tests/ux/knockout-matchup.spec.mjs` + `tests/feature/matchup-detail-wave2-wiring.test.mjs` stay green unmodified (or with copy-only assertion updates called out in the PR).

**Edge cases:** knockout with `advance_pct` but no `probabilities`; model-less row (grid already gated by `hasModel`, line 147 — must not start rendering); pending mode (overdue, no record) keeps pre-match framing WITHOUT "final" wording; ES locale.

**QA script (automated):** extend **`tests/feature/matchup-decided-state.test.mjs`** — shim-render the view for `{final, live, upcoming, pending}` fixtures and assert title strings per mode + identical bar segment widths pre/post. ~100% AC automated.

**Estimate:** S · **Dependencies:** Task 1.2 (shared mode plumbing).

---

### Task 1.4 · "Your pick" becomes a locked retrospective after FT

**Description.** `renderPickRow` (`app/views/matchup-detail.js:329-362`) currently renders three tappable pick buttons even on finished matches. When `found?.mode === 'final'`: render the same three options read-only (`disabled` + `aria-disabled`), highlight the user's pick (from `getPick(match)`, `app/state.js`) AND the actual outcome (`actualChoice(match, data.actualResults)`), and add a one-line outcome: `You picked Japan — missed (Senegal won)` / `You called it ✓` / `No pick made — match finished` . Picks are NEVER cleared or mutated (`setPick`/`clearPick` simply not wired on final) — pool scoring reads stored picks, untouched.

**Files:** `app/views/matchup-detail.js`, `app/styles.css`, `app/lib/i18n.js`, `app/lib/strings.es.js`.

**Acceptance criteria**
- [ ] On final: pick buttons are `disabled`, no click handler mutates state (clicking changes nothing in `localStorage`).
- [ ] User's stored pick stays visually marked (`is-picked` preserved) — data retained, not hidden.
- [ ] Outcome line renders correct/incorrect/no-pick variants; draw outcome handled (`actualChoice → 'draw'`).
- [ ] On live matches picking stays ENABLED exactly as today (live ≠ final; only `FINAL_STATUSES` locks — status-gating rule).
- [ ] 44pt targets + `aria-disabled` on locked buttons (§8).
- [ ] **No feature/data regression:** upcoming-match picking flow byte-identical; `tests/ux/play-funnel.spec.mjs` and `tests/feature/group-picks.test.mjs` stay green.

**Edge cases:** pick made then match went to pens (compare vs `winnerFromRecord`, not score); no stored pick; `pending` mode (no record → picking stays enabled, nothing claims a result); localStorage unavailable (guest).

**QA script (automated):** extend **`tests/ux/matchup-state.spec.mjs`** — seed a pick via `page.evaluate(localStorage.setItem…)`, route a final `actual_results.json`, open the matchup: assert buttons disabled, pick still highlighted, outcome copy, and `localStorage` unchanged after clicking a disabled button; second scenario with a live record asserts buttons enabled. Feature-side: extend **`tests/feature/matchup-decided-state.test.mjs`** for the outcome-copy matrix (picked-winner / picked-loser / picked-draw / no-pick). ~100% AC automated.

**Estimate:** M · **Dependencies:** Task 1.2.

---

## Story 2 — Live-match state (A5)

*As a fan opening an in-progress match, I want to see instantly that it's live — a red badge, a pulsing dot, the minute — and to trust that any probability shown is a live number, not a pre-match one.*

### Task 2.1 · Header LIVE badge: red pill + pulsing dot + minute

**Description.** The header centre currently shows a bare `<small class="detail-score-live">LIVE 26'</small>` (`app/views/matchup-detail.js:102-104`) with no styling weight. Replace its markup with a proper badge: `<span class="detail-live-badge" data-testid="detail-live"><span class="live-dot" aria-hidden="true"></span>LIVE 26'</span>`. Minute label logic: export `liveMinuteLabel(minute, status)` from `app/components/status-pill.js:64` (it already maps halftime → `HT`, shootout → `pens`, strips trailing `'`) and reuse it — do NOT re-implement. CSS in `app/styles.css`: pill background `--danger #DC2626` (§5A), white Caption2 text (11/13 Semibold, +0.6 tracking — the ONE sanctioned all-caps micro-pill, §6), dot reuses the existing `pulse-live` keyframes (styles.css:2606) with the established `@media (prefers-reduced-motion: reduce) { animation: none }` guard (pattern at styles.css:2826). Keep `data-testid="detail-live"` (existing tests reference it).

**Files:** `app/views/matchup-detail.js`, `app/components/status-pill.js` (export only), `app/styles.css`.

**Acceptance criteria**
- [ ] Live match header shows red pill `#DC2626`, white text, pulsing dot, `LIVE <minute>'`.
- [ ] Halftime (`STATUS_HALFTIME`, no minute) → `LIVE HT`; shootout (`STATUS_SHOOTOUT`) → `LIVE pens`; missing minute → `LIVE` (no `undefined'`).
- [ ] `prefers-reduced-motion: reduce` → dot renders static (no `animation`), badge still fully visible.
- [ ] Badge text ≤ Caption2 scale (11/13 Semibold +0.6) — §6 token cited in CSS comment.
- [ ] `data-testid="detail-live"` preserved (no existing-test churn).
- [ ] FT/AET/PEN matches show NO live badge (method label `FT`/`AET`/`pens` renders instead — existing lines 99-101 unchanged); `STATUS_SCHEDULED` 0-0 stubs show `vs`, never a score or badge.
- [ ] **No feature/data regression:** score, winner tag (`is-winner`), share/star row all unchanged.

**Edge cases:** dark mode (red pill on dark surface — contrast ≥3:1 vs `#14191E`); ET phases (`STATUS_FIRST_HALF_EXTRA_TIME` minute >90 renders as-is); long minute strings (`90'+7` — no wrap/clip); `pending` mode (no badge, no fabricated liveness).

**QA script (automated):** extend **`tests/feature/matchup-decided-state.test.mjs`** (shim render: badge markup per status matrix — live/HT/pens/final-pen/scheduled-stub/pending) + **`tests/ux/matchup-state.spec.mjs`**: route a live `actual_results.json` (`STATUS_FIRST_HALF`, minute 26) → assert badge visible, computed `background-color` = `rgb(220, 38, 38)`, dot `animation-name` = `pulse-live`; then `page.emulateMedia({reducedMotion:'reduce'})` + reload → `animation-name` = `none`. ~100% AC automated.

**Estimate:** M · **Dependencies:** none (parallel with Story 1).

---

### Task 2.2 · Live win-probability explicitly labeled live; pre-match numbers labeled pre-match while live

**Description.** `app/components/win-probability.js` already renders `Win probability <small class="live-indicator">LIVE 26'</small>` (line 158) and the `Now (live)` / `Pre-match (model)` stacked bars (lines 197-201) — verify and lock this contract, and align the `live-indicator` styling with Task 2.1's badge (same red + dot, shared CSS class). Also, while a match is live, apply Task 1.3's mode-aware titles: the static model column reads `Pre-match model` (so the live widget is the only thing claiming "now"). No numeric or model changes — labels only.

**Files:** `app/components/win-probability.js`, `app/views/matchup-detail.js`, `app/styles.css`.

**Acceptance criteria**
- [ ] Live widget heading contains `LIVE` + minute; styled with the shared badge class from Task 2.1 (one visual language for liveness).
- [ ] `Now (live)` and `Pre-match (model)` captions both present (stacked bars) — the pre-match prior stays visible during live play (nothing deleted).
- [ ] Widget renders ONLY when `found.mode === 'live'` AND a prior exists (existing gate, `win-probability.js:117-119`) — locked by test.
- [ ] While live, static model column title reads `Pre-match model` (no bare "Model" implying current odds).
- [ ] Reduced motion: existing `data-reduced-motion` path (line 154) still sets transitions off — regression-locked.
- [ ] **No feature/data regression:** knockout et/pk line, sparkline/goal markers, aria-labels all unchanged (`tests/feature/rj30-winprob-render.test.mjs` green).

**Edge cases:** knockout live (2-seg advance bar, `et-pk` line); halftime minute-less heading; live match with no prior (widget absent, badge from 2.1 still shows liveness); 0-0 early minutes (bars ≈ prior — labels must still distinguish Now vs Pre-match).

**QA script (automated):** extend **`tests/feature/rj30-winprob-render.test.mjs`** (existing shim harness): assert heading contains `LIVE`, both stack captions, and the shared badge class; extend **`tests/feature/matchup-decided-state.test.mjs`** for the live-mode model-column title. ~100% AC automated.

**Estimate:** S · **Dependencies:** Tasks 1.3, 2.1.

---

### Task 2.3 · State survives the 30s live-refresh re-render

**Description.** `app/live-poller.js:102-131` dispatches `data:live-refresh` every 30s; `app/main.js` sets `pendingLiveRefresh` and `renderView()` rebuilds `root.innerHTML` restoring scrollY (main.js:83-180). Everything this epic adds must be a pure function of `(data, params)` — verify no module-level DOM state leaks (the badge, retro block, and locked pick row are all rebuilt from data each render; the win-prob series store `window.__wc26WinProbSeries` persists by design, `win-probability.js:49-78`). Add the regression lock: after a simulated refresh the badge/retro/locked-pick states re-render identically and scroll is preserved. Also lock the state TRANSITION: a record flipping live → `STATUS_FINAL_PEN` between polls must swap badge → retro block on the next render with no reload.

**Files:** none beyond Story 1/2 outputs (this task is verification + tests); touch `app/views/matchup-detail.js` only if a leak is found.

**Acceptance criteria**
- [ ] After `window.dispatchEvent(new CustomEvent('data:live-refresh', {detail:{data}}))` on a scrolled matchup page: scrollY within ±2px, LIVE badge still present with the updated minute.
- [ ] Live → final flip between two dispatches: badge gone, `result-vs-model` block + locked pick row present — no page reload, no stale "HYBRID PICK" resurrection.
- [ ] Pick made pre-refresh survives the re-render (still highlighted).
- [ ] **No feature/data regression:** `tests/feature/live-minute-persist.test.mjs` and `tests/ux` scroll-preserving behavior stay green.

**Edge cases:** refresh while the team-color banner's async `getTeamColors` import (matchup-detail.js:70-78) is in flight (no orphan writes to a detached node — banner is re-created each render, old promise writes to the detached one harmlessly; verify no error); backoff mode (2-min cadence) — same path; refresh delivering an unchanged record (idempotent render).

**QA script (automated):** extend **`tests/ux/matchup-state.spec.mjs`**: (1) route live fixture → open matchup → `page.evaluate(scrollTo(0,600))` → mutate the routed fixture to minute 41 → dispatch `data:live-refresh` in-page → assert scrollY 600±2 and badge text `LIVE 41'`; (2) mutate the fixture to `STATUS_FINAL_PEN` + `winner` → dispatch → assert badge count 0 and `result-vs-model` visible. ~100% AC automated.

**Estimate:** M · **Dependencies:** Tasks 1.2, 1.4, 2.1.

---

## Story 3 — Status-matrix hardening

*As a fan, whatever weird state a match is in (pens, extra time, halftime, a 0-0 stub, an overdue result), the page never lies about it.*

### Task 3.1 · Full status-matrix regression for the matchup page

**Description.** One table-driven test that renders the matchup detail through every canonical state and asserts the exact section set. Matrix rows (statuses from `app/lib/match-status.js` — the canonical sets, never re-declared): `STATUS_FULL_TIME`, `STATUS_FINAL_AET`, `STATUS_FINAL_PEN` (+`winner`+shootout), legacy no-status final, `STATUS_FIRST_HALF` (minute 26), `STATUS_HALFTIME` (no minute), `STATUS_SHOOTOUT`, `STATUS_SCHEDULED` 0-0 stub, no record + future kickoff (upcoming), no record + kickoff 5h ago (pending). Expected per row: which of {LIVE badge, live win-prob widget, result-vs-model block, locked picks, interactive picks, "vs" centre, score centre} render. This is the epic's contract file — any future change that lets a stub render as a result or a final render as upcoming fails here.

**Files:** `tests/feature/matchup-decided-state.test.mjs` (the matrix lives here), `tests/ux/matchup-state.spec.mjs` (3 representative rows end-to-end: FT, live, scheduled-stub).

**Acceptance criteria**
- [ ] All 10 matrix rows asserted; scheduled stub shows `vs` (no score, no result, no badge) — display-only rule locked.
- [ ] `pending` shows neither liveness nor a result claim.
- [ ] Matrix imports `FINAL_STATUSES`/`LIVE_STATUSES` from `app/lib/match-status.js` and iterates the REAL sets (a new status added to the lib auto-joins the matrix).
- [ ] **No feature/data regression:** full gate green — `python3 scripts/validate_data.py` → `bash tests/smoke.sh` → `node --test tests/feature/*.mjs tests/competition.test.mjs` → `npx playwright test --config tests/playwright.config.mjs tests/ux tests/integrated`, gated on exit codes.

**Edge cases:** the matrix IS the edge-case list; additionally assert `winnerFromRecord` null on a tied-score final with no `winner` (defensive draw handling) renders "Drawn", not a fabricated winner.

**QA script (automated):** as described — the matrix in `tests/feature/matchup-decided-state.test.mjs` + 3 Playwright rows in `tests/ux/matchup-state.spec.mjs`. 100% automated.

**Estimate:** M · **Dependencies:** all Story 1 + Story 2 tasks (this lands last, closes the epic).

---

## Epic-level QA summary

| Test file | Type | New/extended |
|---|---|---|
| `tests/feature/matchup-decided-state.test.mjs` | node --test, DOM shim | **NEW** — verdict unit table, retro block, re-framed titles, pick lock copy, badge markup matrix, full status matrix |
| `tests/ux/matchup-state.spec.mjs` | Playwright, `page.route` fixtures | **NEW** — final/live/stub end-to-end, badge CSS + reduced-motion, pick lock, live-refresh survival + live→final flip |
| `tests/feature/rj30-winprob-render.test.mjs` | node --test | extended — live labeling contract |
| `tests/ux/knockout-matchup.spec.mjs` | Playwright | unchanged, must stay green (regression sentinel) |

Coverage: ~37/39 acceptance criteria automated (~95%). Manual smoke (2 lines): VoiceOver read of the retro block on device; visual check of the pulsing dot on a real live match day.
