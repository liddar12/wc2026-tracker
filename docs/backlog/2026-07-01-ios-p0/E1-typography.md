# E1-typography — Typography reset (A1)

**Epic id:** `E1-typography`
**Title:** iOS type ramp + grouped-list headers across all 16 public pages
**Goal:** Kill the ALL-CAPS letter-spaced "web dashboard" headers. Every public screen gets (a) iOS grouped-list section headers (sentence case, 13px semibold, secondary color), (b) exactly one Large Title, (c) the exact §6 type scale as CSS tokens. Caps survive ONLY on Caption2 status micro-pills. Presentation-only: **zero data or feature removal**.
**Spec refs:** §1 (page inventory), §2 problem 1, §3 A1, §6 (type scale — copied verbatim into T1.1), §8 (secondary-label contrast), Appendix A (per-page caps findings).
**Out of scope (do NOT touch):** tabular figures (A16/P2), nav/tab-bar/bottom-bar (Track B), spacing grid (A10), iconography/emoji removal (A13), color palette (A8). Non-public auth views (`my-brackets-view.js:143,156`, `my-picks.js:248`, `pools-view.js:218` inline caps) are excluded — log as P1 follow-up.

**Files this epic touches (all verified to exist):**
- `app/styles.css` (tokens + all de-caps rules — single owner within E1: only T1.x tasks edit it)
- New: `app/lib/view-title.js`, `tests/feature/typography-scale.test.mjs`, `tests/ux/typography.spec.mjs`
- Views: `app/views/home-view.js`, `app/views/schedule-view.js`, `app/views/bracket-view-r6.js`, `app/views/brackets-live-view.js`, `app/views/matchup-list.js`, `app/views/matchup-detail.js`, `app/views/venues-view.js`, `app/views/venue-detail.js`, `app/views/team-detail.js`, `app/views/group-view.js`, `app/views/golden-awards-view.js`, `app/views/golden-boot-view.js`, `app/views/model-accuracy-view.js`, `app/views/status-view.js`, `app/views/settings-view.js`, `app/views/settings-push-card.js`
- Components: `app/components/large-match-card.js`, `app/components/status-pill.js`, `app/components/parlay.js`, `app/components/model-picker.js`

**Shared files (other epics likely touch too — coordinate via PM):**
**Canonical merge order (identical in all six epic files — the single source of truth for `app/styles.css` / shared-view sequencing): E4 (hero/empty CSS blocks + structure) → E3 (matchup-detail view work) → E1 (tokens + de-caps sweep) → E2 (names/enums) → E5 (flags) → E6 (wheel).** E1 therefore lands THIRD: its styles.css token block and de-caps sweep merge on top of E4's hero/empty CSS and E3's matchup-detail changes; E1's T1.2 de-caps grep-allowlist must be re-verified against the post-E4/E3 styles.css before merge.
`app/styles.css` (every Track-A epic), `app/components/large-match-card.js` (E1 T1.3 + E2 T2/T5 — see map below), `app/components/status-pill.js` (E-live A5), `app/views/matchup-detail.js` (E3 whole epic + E2 T5 + E1 T2.4 — see map below), `app/views/venue-detail.js` (E-enums A3 / E2 T5, E-empty A7 / E4), `app/views/team-detail.js` (E-empty A7 / E4), `app/views/home-view.js` (E4 T4.x + E2 T3/T5 + E1 T2.2 — see map below), `app/views/bracket-view-r6.js` (E-wheel A19 adds `layout=radial`).

**Cross-epic shared-file map (canonical, identical in all six epic files — the PM builds the collision schedule from this):**
- `app/views/matchup-detail.js` — touched by E3 (whole epic), E2 T5, E1 T2.4 · land order: **E3 → E2 T5 → E1 T2.4**
- `app/views/home-view.js` — touched by E4 T4.1/T4.2, E2 T3/T5, E1 T2.2 · land order: **E4 T4.x → E2 T3/T5 → E1 T2.2** (E4's Today-section structure change lands before E1's type ramp; E2's hmr-row wrap change rebases on E4's Today-section restructure)
- `app/components/large-match-card.js` — touched by E1 T1.3 ('TODAY'→'Today' + pill CSS), E2 T2/T5 (team-cell rewrite) · land order: **E1 T1.3 → E2 T2/T5** (E2's team-cell rewrite rebases on E1's landed 'Today' string so E1's source-string test stays green)
- `app/components/projected-bracket-tree.js` — touched by E2 T3 (slot-name rendering → `fifaCode(name) || shortTeamName(name)`), E6 (layout toggle in `paint()`/`renderStageNav` + exporting/moving module-level `OVERRIDES`, projected-bracket-tree.js:32) · land order: **E2 T3 → E6 T1.2/T3.1** (canonical order E2 → E6; rebase E6 on E2's landed text change)
- `app/lib/team-names.js` — additive exports only: **E2 T1 (`fifaCode`) → E4 (`slotLabel`)**; E6 is a read-only consumer and never edits this file

**Known build gotchas honored:** `renderView()` rebuilds `root.innerHTML` (main.js:170) — Large Titles are static markup emitted inside each view's own render, no listeners, so re-render-safe (BR-6). Playwright `webServer` stays ThreadingHTTPServer (`tests/playwright.config.mjs`) — new spec plugs into the existing config, no config change.

---

## Story 1 — As a fan, section headers read like a native iOS app, not a shouty web dashboard

### T1.1 · Type-ramp tokens + utility classes (tokens-first, everything else depends on this)
**Description.** Add the §6 scale as CSS custom properties + utility classes in `app/styles.css`, next to the existing v2 token block (styles.css:2301–2334). 1pt = 1px. Do not delete existing `--t-*` tokens (other selectors consume them); add the new ramp alongside and migrate consumers in T1.2/T2.x.
Tokens (name / size / line-height / weight / tracking):
```
--type-large-title: 34px/41px 700 +0.4px   --type-headline: 17px/22px 600
--type-title1:      28px/34px 700 +0.3px   --type-body:     17px/22px 400
--type-title2:      22px/28px 700 +0.2px   --type-callout:  16px/21px 400
--type-title3:      20px/25px 600          --type-subhead:  15px/20px 400
--type-footnote:    13px/18px 400          --type-caption1: 12px/16px 500
--type-caption2:    11px/13px 600 +0.6px  (ONLY status micro-pills)
```
Utility classes `.t-large-title … .t-caption2` set font-size/line-height/weight/letter-spacing. Add `.group-header` = 13px/18px, weight 600, `text-transform: none`, `letter-spacing: 0`, `color: var(--text-muted)` (the iOS grouped-list header; §8 muted contrast tokens are E-color's job — reuse `--text-muted` as-is).
**Files:** `app/styles.css`.
**Acceptance criteria:**
- [ ] All 11 ramp tokens exist with the exact px values above (spec §6 verbatim).
- [ ] Utility classes `.t-*` + `.group-header` exist; `.group-header` is 13px semibold (600), sentence-preserving (`text-transform: none`), `color: var(--text-muted)`.
- [ ] Only weights 400/500/600/700 appear in the new block (spec: Regular/Medium/Semibold/Bold only).
- [ ] No existing selector removed or renamed; existing `--t-*`/`--weight-*` tokens untouched in this task. No feature/data regression: full gate green.
**Edge cases:** dark mode inherits via `var(--text-muted)` (styles.css:45) — no hardcoded hex; long ES i18n strings must wrap (no `white-space: nowrap` in `.group-header`); Dynamic-Type-ish zoom (browser text-size) scales because tokens are used via classes, not inline px in JS.
**QA script:** `tests/feature/typography-scale.test.mjs` (NEW, node --test; joins gate step 3). Reads `app/styles.css` as text and asserts: each of the 11 tokens present with exact value strings (e.g. `/--type-large-title:\s*34px/`); `.group-header` block contains `font-weight: 600`, `13px`, `var(--text-muted)`, `text-transform: none`; new block contains no `font-weight: 8\d\d|900`. Covers 4/4 AC (regression AC covered by running the gate).
**Estimate:** S. **Depends on:** none (unblocks everything).

### T1.2 · De-caps every section-header selector → grouped-list style
**Description.** The caps come from CSS, not strings (view text is already sentence case, e.g. `venues-view.js:71` "Host venues", `group-view.js:54` "Projected standings"). Convert these `app/styles.css` selectors to the `.group-header` recipe (remove `text-transform: uppercase` + `letter-spacing`, set 13px/600/muted): `.section h2` (553–558), `.home-card-title` (1580–1590), `[data-redesign="v2"] .home-card-title, [data-redesign="v2"] .home-hero-eyebrow` (2366–2372 — v2 is global via `index.html:2`, this override is the main caps driver), `.what-changed-title` (1263), `.section-heading-with-tip` (1322), `.search-group-title` (1409), `.home-hero-eyebrow` (1485), `.home-countdown-label` (1534), `.cd-lbl` (1559), `.gb-table-head` (1719), `.eb-col-head` (1741), `.cg-codebox-label` (1922), `.bb-round h3` (2164), `.freshness-card h3` (2706), `.bb-here` (2909), `.hybrid-pill-label` (3454), `.pw-stage-label` (3847), `.pw-bracket-col-head` (3997), `.pw-model-picker-label` (4337), `.pw-team-stat-label` (4382), `.watch-head` (950), `.lcard-eyebrow` (2467), `.lcard-team-name` (2498 — team names must never be caps; sizing/truncation itself is E2), `.lcard-method` (2565), `.parlay-leg-market` (1776), `.ms-poss-label` (4910), `.ms-xg-label` (4980). Keep each selector's non-type properties (flex layout on `.home-card-title` etc.) intact. EXEMPT (stay caps, handled in T1.3): `.status-pill` (2809), `.ai-pill` (4814), `.backtest-badge` (3588) — status micro-pills only.
**Files:** `app/styles.css`.
**Acceptance criteria:**
- [ ] `grep -n 'text-transform: uppercase' app/styles.css` returns ONLY the T1.3 allowlisted micro-pill selectors (`.status-pill`, `.ai-pill`, `.backtest-badge`).
- [ ] Section headers render sentence case, 13px, weight 600, `var(--text-muted)`, `letter-spacing: 0` (spec: "sentence case, 13pt semibold, secondary color").
- [ ] Team names (`.lcard-team-name`) render without `text-transform` (Headline 17/22 semibold token applied; width/truncation untouched — E2's file).
- [ ] Every header still displays its full original text — no string edits, no removed headers, no removed meta spans (`.home-card-meta` counts per page unchanged). Full gate green (notably `tests/feature/hidden-features.test.mjs`, `home-order.test.mjs`, `tests/ux/*`).
**Edge cases:** dark mode (muted token flips); ES locale (`app/lib/strings.es.js` values are sentence case — verify none relied on CSS caps for meaning); headers containing counts/emoji ("Matches here (5)", "🏆 Golden Awards") keep their text verbatim; `.cd-lbl` countdown labels on the hero (white-on-teal) keep `opacity` for contrast; what-if/bracket headers re-render via `renderView()` innerHTML rebuild — CSS-only change is state-safe.
**QA script:** extend `tests/feature/typography-scale.test.mjs`: parse `app/styles.css`, collect every rule containing `text-transform: uppercase`, assert selector set ⊆ {`.status-pill`, `.ai-pill`, `.backtest-badge`}; assert `.home-card-title` and `.section h2` blocks contain `text-transform: none` or no transform, and no `letter-spacing: 0.4px`. Plus `tests/ux/typography.spec.mjs` (NEW Playwright, 390×844): for routes `#/home #/schedule #/venues #/group/A #/status #/settings`, `getComputedStyle` of first `.home-card-title`/`.section h2` asserts `textTransform === 'none'`, `fontSize === '13px'`, `fontWeight === '600'`; and per route assert header count > 0 AND innerText of a known header equals its sentence-case string (parity guard). Covers 4/4 AC.
**Estimate:** M. **Depends on:** T1.1.

### T1.3 · Caption2 status micro-pills — the ONLY surviving caps; "Final" over "FINAL"
**Description.** Bring `.status-pill` (styles.css:2800–2811, currently 10px/700/+0.06em) to exact Caption2: `font-size: 11px; line-height: 13px; font-weight: 600; letter-spacing: 0.6px;` — caps may stay on this pill class. Same treatment for `.ai-pill` and `.backtest-badge`. Literal texts: acronyms `FT`/`PEN`/`TBD`/`LIVE {m'}` in `app/components/status-pill.js` stay (already terse, spec-blessed "FT"); full words lose shout-case: `large-match-card.js:273–274` `'TODAY'`→`'Today'`, `'TOMORROW'`→`'Tomorrow'` (pill CSS caps removed there if the chip isn't a status pill — verify chip class; if it renders via `.status-pill` the display stays caps-capable but source text must be sentence case per spec "prefer 'Final' over 'FINAL'").
**Files:** `app/styles.css`, `app/components/status-pill.js`, `app/components/large-match-card.js`.
**Acceptance criteria:**
- [ ] `.status-pill` computed style = 11px/13px, weight 600, letter-spacing 0.6px (spec Caption2 "11/13 Semibold +0.6").
- [ ] All pill states keep exact behavior: `is-final` (FT), PEN (STATUS_FINAL_PEN or drawn-score-with-winner), `is-live` (+ minute label), `is-scheduled` (date · time), TBD — logic in `status-pill.js:16–61` byte-identical except display strings listed above.
- [ ] `'TODAY'`/`'TOMORROW'` sources read `'Today'`/`'Tomorrow'`.
- [ ] No status-gating change: FINAL/LIVE sets still come from `app/lib/match-status.js` (FINAL_STATUSES/LIVE_STATUSES); `tests/feature/match-status.test.mjs`, `status-wiring.test.mjs`, `live-minute-persist.test.mjs`, `knockout-penalty-winner.test.mjs` all green.
**Edge cases:** pen/ET finals (STATUS_FINAL_PEN → PEN pill), AET; live minute persistence across re-renders; scheduled 0-0 stubs must stay `is-scheduled` (never final); unresolved knockout slots (TBD pill); dark mode pill fills (`--bad` live red) unchanged.
**QA script:** extend `tests/feature/typography-scale.test.mjs`: import `statusPill` from `app/components/status-pill.js` (pure module) and assert pill HTML for fixtures {final, final_pen, live+minute, scheduled, tbd} contains `FT`/`PEN`/`LIVE`/`is-scheduled`/`TBD` respectively (locks behavior); assert `large-match-card.js` source contains `'Today'` and not `'TODAY'`. CSS values asserted via the styles.css text checks. In `tests/ux/typography.spec.mjs`: computed style of a rendered `.status-pill` on `#/schedule` = 11px/600/0.6px. Covers 4/4 AC.
**Estimate:** S. **Depends on:** T1.1, T1.2 (allowlist).

### T1.4 · Weight + face normalization (Regular/Medium/Semibold/Bold only)
**Description.** styles.css has 21 `font-weight: 800/900` declarations (e.g. `.watch-head:950`, `.gb-table-head`, `.parlay-leg-market:1776`, `--weight-display: 800` at 2312) — clamp all to 700. Point `--font-display` (styles.css:2301, 'Barlow Condensed' — the audit's "condensed all-caps face") and `--font-body` (2302) at the system SF stack: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif` (matches body stack at line 66). Do NOT remove the Google-Fonts `<link>` from index.html in this task (avoid shell churn; dead-link cleanup is a follow-up note).
**Files:** `app/styles.css`.
**Acceptance criteria:**
- [ ] `grep -cE 'font-weight:\s*(800|900)' app/styles.css` = 0; `--weight-display: 700`.
- [ ] `--font-display`/`--font-body` resolve to the -apple-system stack; no selector references 'Barlow' any more.
- [ ] Visual only — no layout-affecting property (size/margin/padding) changed in this task. Full gate green.
**Edge cases:** dark mode unaffected; SF stack on non-Apple test browsers falls to Segoe/system-ui (Playwright chromium — assert stack string, not rendered face); score digits previously 800 stay bold-legible at 700 (Title2 22/28 700 per §6).
**QA script:** extend `tests/feature/typography-scale.test.mjs`: regex asserts zero `font-weight: 800|900` and zero `Barlow` in `app/styles.css`; assert `--font-display` value starts with `-apple-system`. Covers 3/3 AC.
**Estimate:** S. **Depends on:** T1.1.

---

## Story 2 — As a fan, every screen tells me where I am with one iOS Large Title

### T2.1 · `.view-title` class + `largeTitle()` helper
**Description.** New `app/lib/view-title.js` exporting `largeTitle(text, {sub} = {})` → escaped `<h1 class="view-title">…</h1>` (uses `app/lib/escape.js`). CSS in `app/styles.css`: `.view-title { font-size: 34px; line-height: 41px; font-weight: 700; letter-spacing: 0.4px; color: var(--text); margin: 4px 0 12px; overflow-wrap: break-word; }` (LargeTitle 34/41 Bold +0.4). Detail screens whose hero already IS the title (matchup hero, venue/team name) instead tag the existing element `data-large-title` and apply the token — no duplicate h1s inside cards. `index.html:71` `h1.app-title` (chrome wordmark) is NOT touched (Track B retires it).
**Files:** `app/lib/view-title.js` (new), `app/styles.css`.
**Acceptance criteria:**
- [ ] `.view-title` = exactly 34px/41px/700/+0.4px (spec §6 LargeTitle).
- [ ] Helper returns escaped HTML (XSS-safe for venue/team names), no listeners (innerHTML-rebuild safe per BR-6).
- [ ] Wraps, never clips (`overflow-wrap: break-word`, no `text-overflow: ellipsis`).
**Edge cases:** long names at 34px ("Bosnia and Herzegovina", "Mercedes-Benz Stadium") wrap to 2 lines; dark mode via `var(--text)`; reduced motion N/A (no animation added); re-render (`renderView()` innerHTML) — pure markup.
**QA script:** extend `tests/feature/typography-scale.test.mjs`: import `largeTitle` and assert `largeTitle('<img onerror=x>')` output is escaped and contains `class="view-title"`; styles.css text asserts the 34px/41px/700 block exists. Covers 3/3 AC.
**Estimate:** S. **Depends on:** T1.1.

### T2.2 · Sweep: Home + Schedule
**Description.** `home-view.js`: promote the hero title (`home-view.js:117`, `.home-hero-title`, 22px) to the screen's Large Title — apply LargeTitle token via `data-large-title` on the existing element (text unchanged: the dates line); eyebrow "FIFA World Cup 2026" (line 116) becomes a Footnote-weight line (CSS already de-capsed in T1.2). `schedule-view.js`: the day heading (`schedule-view.js:123`, `document.createElement('h2')`) becomes the Large Title via `largeTitle()` with the same date string; `parlay.js:247` header text "Parlay of the Day" → "Parlay of the day".
**Files:** `app/views/home-view.js`, `app/views/schedule-view.js`, `app/components/parlay.js`.
**Acceptance criteria:**
- [ ] `#/home` and `#/schedule` each render exactly one `.view-title, [data-large-title]` element at computed 34px/700.
- [ ] All Home sections still present and ordered (Today's matches, full-schedule CTA, Don't miss, Recent results, Jump to, Elo movers — `home-order.test.mjs` green); Schedule keeps day picker, mine-filter toolbar, parlay card, all match cards (counts unchanged for a fixed dataset).
- [ ] Parlay header reads "Parlay of the day" with game-count meta span intact.
- [ ] `tests/ux/qa-guest.spec.mjs`, `fav-team-layout.spec.mjs`, `tournament-day-ux.test.mjs` green.
**Edge cases:** empty schedule day (empty-state `<p>` at schedule-view.js:24 still renders under the title); hero countdown present/absent (pre/post kickoff); live day (LIVE pills beside Today chips); dark hero (white-on-teal title — contrast is E-color A6's file, don't change hero colors); ES locale date strings wrap.
**QA script:** `tests/ux/typography.spec.mjs`: for `#/home` and `#/schedule` assert `page.locator('.view-title, [data-large-title]')` count === 1 and computed fontSize '34px'; assert Home section-header innerTexts still include "Recent results"/"Jump to" (i18n EN) and Schedule still shows ≥1 `.status-pill` + parlay card text "Parlay of the day". Manual smoke (1 line): eyeball hero wrap on iPhone 390pt.
**Estimate:** M. **Depends on:** T1.2, T2.1.

### T2.3 · Sweep: Projected bracket + Live bracket
**Description.** `bracket-view-r6.js` (Projected — `pw-*` classes; `projected-bracket-view.js` is a shim, don't touch): insert `largeTitle('Projected bracket')` at the top of the view render, before the model picker; stage-nav/model-picker labels keep their text ("Model" label via `model-picker.js`), caps removal already CSS-side (T1.2 `.pw-stage-label`, `.pw-model-picker-label`, `.pw-bracket-col-head`). `brackets-live-view.js`: `largeTitle('Bracket')` above the Live|Projected toggle; round headers (`.bb-round h3`) text stays ("Round of 32" etc.).
**Files:** `app/views/bracket-view-r6.js`, `app/views/brackets-live-view.js`, `app/components/model-picker.js`.
**Acceptance criteria:**
- [ ] `#/projected` and `#/bracket` each render exactly one Large Title (34px/700).
- [ ] What-if tap→override→re-cascade flow untouched: model picker chips, stage nav (GS/R32/…/F), zoom control, confidence pills all present; `tests/ux/projected-bracket.spec.mjs`, `bracket-section.spec.mjs`, `tests/feature/r12b-model-picker.test.mjs`, `r14-bracket-resolver.test.mjs`, `bracket-builder.test.mjs` green.
- [ ] Live|Projected mode toggle and all round groups R32→3RD still render with identical slot counts.
- [ ] Scroll/what-if state survives re-render (existing BR-6 behavior unregressed — title markup is static, added before stateful nodes).
**Edge cases:** unresolved slots (W79/W80 TBD chips render under the title); pen/ET winners in live bracket slots (status sets from `app/lib/match-status.js`); reduced-motion (no new animation); dark mode; radial toggle (E-wheel A19 adds `layout=radial` to `bracket-view-r6.js` — coordinate merge, title must render in both layouts).
**QA script:** `tests/ux/typography.spec.mjs`: `#/projected` + `#/bracket` → exactly one 34px title each; assert `.pw-stage-label` computed `textTransform === 'none'`; parity: model-picker chip count ≥ 3 and R32 slot count unchanged vs data fixture; what-if regression: tap a team, assert override pill appears (reuses `projected-bracket.spec.mjs` helper pattern). Covers 4/4 AC.
**Estimate:** M. **Depends on:** T1.2, T2.1. **Coordinates with:** E-wheel (A19) on `bracket-view-r6.js`.

### T2.4 · Sweep: Matches list + Matchup detail (decided AND live)
**Description.** `matchup-list.js`: `largeTitle('Matches')` above the "What changed today" panel and filters (panels/filters keep full function — A11/A4 own their behavior). `matchup-detail.js`: the match hero is the title — tag the hero fixture element `data-large-title`; score line gets Title1 token (28/34 bold +0.3 — spec: hero score "2 – 1"); section `<h2>`s ("To advance" :391, "Your pick" :225, "Final result" :266, "Why this prediction" :177 + component `.section h2`s: when-where-watch, lineups, referee, h2h, form, scorers, xg) inherit T1.2 grouped-list style — text unchanged, sentence case verified.
**Files:** `app/views/matchup-list.js`, `app/views/matchup-detail.js`.
**Acceptance criteria:**
- [ ] `#/matches` and `#/matchup/{id}` each render exactly one Large-Title-styled element; matchup hero score computes 28px/700.
- [ ] Every matchup section still renders for both a FINAL match and a LIVE match fixture: When & where, To advance, Your pick, Lineups, Referee, Head-to-head, Recent form, Top scorers, Expected goals, Final result — zero sections dropped (A4's decided-state collapse is a DIFFERENT epic; E1 must not pre-empt it).
- [ ] Pick buttons, watchlist stars, filters (group/team/venue selects) fully functional; `tests/ux/knockout-matchup.spec.mjs`, `tests/feature/matchup-detail-wave2-wiring.test.mjs`, `rj30-when-where-watch.test.mjs`, `winner-highlight.test.mjs` green.
- [ ] Status correctness untouched: FT/PEN/LIVE hero states render per `match-status.js` sets.
**Edge cases:** live match (minute label next to hero — A5 epic adds LIVE badge; keep hooks clear), FT vs STATUS_FINAL_PEN vs AET heroes; long team names wrap at 28px score row (never clip — E2 owns codes); unresolved knockout matchup (both teams TBD); dark mode; delegated pick-button listeners survive innerHTML re-render (no listener moved).
**QA script:** `tests/ux/typography.spec.mjs`: route to a known FT match and a synthetic LIVE match (route-intercept `actual_results.json`/live feed as in `knockout-matchup.spec.mjs`), assert one `[data-large-title]`, score fontSize '28px', and ALL ten section headers present by text (parity list above) in both states. Covers 4/4 AC (state matrix automated).
**Estimate:** M. **Depends on:** T1.2, T2.1. **Coordinates with:** E-decided (A4), E-live (A5) on `matchup-detail.js`.

### T2.5 · Sweep: Venues, Venue detail, Team detail, Group detail
**Description.** `venues-view.js`: `largeTitle('Venues')`; keep "Host venues" (`:71`) as grouped header. `venue-detail.js:18`: replace the inline-styled `<h2 style="margin:0;font-size:20px;">` venue name with the Large Title treatment (`data-large-title` on the existing element; drop the inline font-size); "Matches here (N)" (`:34`) stays a grouped header with count. `team-detail.js:20`: same conversion for team name; "Position ratings" (`:51`), "Group matches" (`:77`), "Roster (N)" (`:88`) stay grouped headers. `group-view.js`: `largeTitle('Group {X}')` from route params; "Projected standings" (`:54`), "Matches" (`:68`) stay.
**Files:** `app/views/venues-view.js`, `app/views/venue-detail.js`, `app/views/team-detail.js`, `app/views/group-view.js`.
**Acceptance criteria:**
- [ ] All four routes render exactly one 34px/700 title; venue/team/group names shown in full (wrap, never truncate).
- [ ] Zero data removal: venue meta line (Cap/surface/elevation/TZ), all venue match rows incl. unresolved W79/W80 rows, position-rating rows GK/DEF/MID/FWD with numeric values, roster count, standings table columns, Adv% — all byte-identical content.
- [ ] Group title derives from `params` for every group A–L (12 routes).
- [ ] `tests/feature/r18-standings.test.mjs`, `refs-render.test.mjs`, `tests/ux/r18-standings.spec.mjs` green.
**Edge cases:** venue names with accents/long names at 34px ("Estadio BBVA" fine; "Mercedes-Benz Stadium" wraps); unresolved slots W79/W80 (raw-enum fix is A3's epic — do not alter row content here); teams with empty ratings (A7's epic); snake_case stage pills untouched (A3); dark mode; ES locale headers.
**QA script:** `tests/ux/typography.spec.mjs`: `#/venues`, first `#/venue/id/*`, `#/team/name/Brazil`, `#/group/A` → one large title each; parity asserts: venue-detail match-row count equals `schedule_full.json` fixture count for that venue; team-detail shows 4 rating rows with numbers; group-detail table has 4 team rows. Covers 4/4 AC.
**Estimate:** M. **Depends on:** T1.2, T2.1. **Coordinates with:** E-enums (A3), E-empty (A7).

### T2.6 · Sweep: Golden Awards, Model accuracy, Status, Settings
**Description.** `golden-awards-view.js:58` `<h1 class="home-card-title">🏆 Golden Awards` → `<h1 class="view-title">` (emoji stays — A13 is excluded); same for `golden-boot-view.js:32`. `model-accuracy-view.js:108` header text "Model Accuracy" → "Model accuracy" (test uses `/Model Accuracy/i` — safe) and add `largeTitle('Model accuracy')` at view top, demoting the card h2 to grouped header. `status-view.js`: `largeTitle('Status')` above the "Pipeline status" card (`:57`). `settings-view.js` + `settings-push-card.js`: `largeTitle('Settings')`; all 8 `.home-card-title` section headers (Favorite team, Language, Match alerts, Theme, Motion, Account, …) inherit T1.2 style, text verified sentence case.
**Files:** `app/views/golden-awards-view.js`, `app/views/golden-boot-view.js`, `app/views/model-accuracy-view.js`, `app/views/status-view.js`, `app/views/settings-view.js`, `app/views/settings-push-card.js`.
**Acceptance criteria:**
- [ ] `#/golden-boot`, `#/model-accuracy`, `#/status`, `#/settings` each render exactly one 34px/700 Large Title.
- [ ] Golden Boot list rows (all players + odds/goals/proj columns), all 72 model-accuracy match rows + per-model chips, every feeds row + health pill on Status, and every Settings control (favorite-team grid, language + theme segments, reduce-motion toggle, alerts, account, reset) render unchanged — counts identical.
- [ ] "measured" badge (`.backtest-badge`) keeps Caption2 caps styling (allowlisted).
- [ ] `tests/ux/model-accuracy.spec.mjs`, `status-view.spec.mjs`, `i18n-settings.spec.mjs`, `r19-golden-boot.spec.mjs`, `tests/feature/golden-awards.test.mjs`, `pipeline-status-build.test.mjs` green.
**Edge cases:** degraded vs ok pipeline states (pill casing "Degraded"/"ok" content untouched — Status pill redesign is P1); 11k-px golden-boot scroll (title renders once at top, no sticky work — A11 excluded); reduce-motion setting toggle still persists; theme toggle live-switches dark tokens under the new title; ES settings headers.
**QA script:** `tests/ux/typography.spec.mjs`: 4 routes → one large title each + parity counts (golden-boot row count > 20, status feed rows === fixture feeds length via route-intercept of `pipeline_status.json` like `status-view.spec.mjs:26`, settings section-header count === 8, model-accuracy rows === fixture length); assert `#view` text still matches `/Model accuracy/i`. Covers 4/4 AC.
**Estimate:** M. **Depends on:** T1.2, T2.1.

---

## Story 3 — As a fan, nothing I use today disappears (QA guardrails wired into the gate)

### T3.1 · Static typography-conformance test (gate step 3)
**Description.** Finalize `tests/feature/typography-scale.test.mjs` (accumulated by T1.x/T2.1) as the lockfile for the type system: token values, caps allowlist, weight ceiling, font stack, helper escaping, sentence-case source strings (`'Today'`, `'Parlay of the day'`, `'Model accuracy'`). Pure `node --test`, no server, joins `node --test tests/feature/*.mjs` automatically.
**Files:** `tests/feature/typography-scale.test.mjs` (new).
**Acceptance criteria:**
- [ ] Test file runs green in gate step 3 and RED if: any non-allowlisted `text-transform: uppercase` is reintroduced, any 800/900 weight returns, any §6 token value drifts, or `Barlow` reappears.
- [ ] Runs in <2s, no network, no DOM.
**Edge cases:** ANSI/exit-code gating only (per repo rule — assert via test framework, never grep colored output); CSS comments containing the word "uppercase" must not false-positive (parse declarations, not raw lines).
**QA script:** the task IS the QA script; verified by intentionally flipping one token locally → test fails (documented in test header comment).
**Estimate:** S. **Depends on:** T1.1–T1.4, T2.1.

### T3.2 · Playwright type-audit + feature-parity spec (gate step 4)
**Description.** Finalize `tests/ux/typography.spec.mjs` (accumulated by T2.2–T2.6): one `test.describe` per route group, 390×844, using the existing ThreadingHTTPServer webServer from `tests/playwright.config.mjs` (NO config change). Adds a dark-mode pass: set `data-theme='dark'`, re-assert grouped-header color equals resolved `--text-muted` and title color equals `--text`. Adds the global caps audit: on each of the 16 routes, `page.evaluate` walks all `h1,h2,h3,.home-card-title,.section h2` and asserts computed `textTransform !== 'uppercase'`; walks `.status-pill` and asserts 11px/600.
**Files:** `tests/ux/typography.spec.mjs` (new).
**Acceptance criteria:**
- [ ] Covers all 16 public routes (spec §1 inventory); each asserts: exactly one Large Title (34px/700), zero uppercase headers, status-pill Caption2, and the per-route parity checks defined in T2.2–T2.6.
- [ ] Light + dark both asserted on ≥4 representative routes (home, matchup FT, bracket, settings).
- [ ] Suite green in gate step 4 alongside `tests/ux tests/integrated`; no flake (route-intercept fixtures, `domcontentloaded` + explicit selector waits, no bare timeouts beyond existing repo pattern).
- [ ] ≥90% of E1 acceptance criteria automated between T3.1 + T3.2 (traceability table in the spec file header comment mapping task → test name). Remaining manual smoke: 1-line "load home + matchup on a real iPhone, confirm titles wrap and nothing shouts".
**Edge cases:** live vs FT vs PEN matchup states (intercepted fixtures); unresolved-slot venue rows; reduced-motion emulation (`page.emulateMedia({ reducedMotion: 'reduce' })`) on one route to prove no dependency; ES locale on settings route (header still 13px/600).
**QA script:** the task IS the QA script; CI proof = full gate run 1→4 green from a clean checkout.
**Estimate:** M. **Depends on:** T2.2–T2.6.

---

## Traceability / rollout
- Order: T1.1 → (T1.2, T1.4, T2.1) → T1.3 → T2.2–T2.6 in parallel (disjoint view files; styles.css frozen after Story 1) → T3.1/T3.2 finalize.
- Rollback: single revert of the E1 merge commit (CSS + view markup only, no data/schema).
- Total: 12 tasks (4+6+2 across 3 stories) · estimates: 5 S, 7 M.
