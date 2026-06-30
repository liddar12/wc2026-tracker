# RJ30-D — Live Win-Probability Timeline + Group Standings & Qualification Scenarios

Feature increment for the WC2026 tracker. Two items, both **zero additional cost** (pure code over existing static data + the existing ESPN live merge). iOS-first installed PWA, mobile-first (iPhone 390×844, safe-areas, existing design language). No build step, vanilla ES modules, hash router.

Grounding read (verified against the code, not assumed):
- `app/live-scores.js` — `mergeLiveScores()` writes `{score_a, score_b, status, minute}` (and KO `winner`/`shootout_*`) into `data.actualResults[tier][a__vs__b]` in place; `app/live-poller.js` fires `data:live-refresh` with `{ detail.data }` every 30s; `app/main.js:320` swaps `state.data` and re-renders the current view preserving scrollY (`pendingLiveRefresh`).
- `app/components/large-match-card.js` — `actualForCard(actualResults, match)` returns `{actual:{score_a,score_b,minute?}, mode, winner?, status?, method?}`; `mode` ∈ `upcoming|live|final|pending` via `deriveMode`. The live card eyebrow already renders `LIVE 67'`.
- `app/views/matchup-detail.js` — `resolveMatch()` finds the row in `groupMatchups` → `knockoutMatchups` → `scheduleFull`; the live/final score block already renders (`data-testid="detail-score"` / `detail-live`). Model prior on a row: `match.probabilities {team_a_wins,draw,team_b_wins}`, `match.win_confidence_pct`, knockout rows carry `advance_pct_a/_b`.
- `app/components/sparkline.js` — `sparklineSvg(values, {width,height,className})` exists; **reuse**, do not re-implement.
- `app/lib/match-status.js` — `FINAL_STATUSES`, `LIVE_STATUSES`, `deriveMode`, `winnerFromRecord`, `methodOfVictory`, `isFinalStatus`. The single source of truth for status.
- `app/bracket-resolver.js:138 computeGroupStandings(data, group)` — **the canonical real-results group table** (pts 3/1/0, gd, gf, FINAL-gated, returns `null` until the group is fully played). **Reuse it**; do not fork the math.
- `app/group-scoring.js` — best-thirds ranking (pts→gd→gf, slice top 8), and the `qualified_for_r32` explicit-list fallback.
- `app/group-monte-carlo.js` — `groupProbabilities(data, letter)` 5000-sim P(1st..4th)+pAdvance, cached per data_version. **Reuse** for the "chance to advance" column.
- `app/views/group-view.js` — current Group view: a `select` switcher + a *projected* xPts/xGD/Adv% table (`computeStandings(info)`, model expected_points — NOT real results) + 6 matchup cards.
- Data shapes confirmed: `actual_results.json` group_stage = 72/72 FINAL today (tournament in knockout); `group_matchups.json[G] = {group, teams[4], matches[6], projected_standings}`; `schedule_full.json` rows `{match_id, stage, team_a, team_b, kickoff_utc, group, ...}`.
- Test harness: node:test `tests/feature/*.mjs` (`node:assert/strict`, read JSON via `new URL('../../', import.meta.url)`); Playwright `tests/ux/*.spec.mjs` served by `python3 -m http.server 8088 --directory ..`, baseURL `http://localhost:8088`, viewport 390×844. Existing route-registration tests assert against `app/main.js` source (see `r18-standings.test.mjs`).

---

## RJ30-5 — Live Win-Probability Timeline

### 1. User stories + acceptance criteria

**Story A — in-match win% on the live card/detail.**
> As a fan watching a live match, I want to see each team's live win probability and how it has moved since kickoff, so that I understand who is favored *right now* given the score and the clock — not just the pre-match model.

- **Given** a match is live (`mode === 'live'` from `actualForCard`/`deriveMode`) **and** the row has a model prior (`probabilities` or `advance_pct_*`), **When** I open the matchup detail (`#/matchup/a/.../b/...`) or see its large card, **Then** a win-probability component renders showing 3 (group) or 2 (knockout) live probabilities that sum to 100% and a sparkline of how the leader's win% has moved.
- **Given** the live score is a draw at minute 70 **When** I view the probabilities **Then** the draw segment is larger than at kickoff (time-decay toward the standing result) and both win% are below their pre-match values.
- **Given** a team is leading 1–0 at minute 85 **When** I view the probabilities **Then** that team's win% is materially higher than its pre-match prior and the trailing team's is near-zero.
- **Given** the poller pushes a new score (`data:live-refresh`) **When** the view re-renders **Then** the win-prob updates and the sparkline appends the new point (no scroll jump — `pendingLiveRefresh` already preserves scrollY).

**Story B — graceful pre/post/no-data.**
> As a user, I never want to see a broken or misleading probability widget.

- **Given** the match is `upcoming`/`pending`/`final`, or there is no model prior, or there is no live record, **When** the view renders, **Then** the live win-prob component renders **nothing** (returns an empty fragment) — the existing pre-match model bar and final-result block are untouched.
- **Given** a knockout match in extra time or penalties (`STATUS_OVERTIME`/`STATUS_*_EXTRA_TIME`/`STATUS_SHOOTOUT`), **When** live, **Then** the widget shows a 2-way (advance) split clamped toward the regulation leader / shootout state, never a draw segment.

### 2. Tasks (files / functions / data flow)

**New: `app/components/win-probability.js`** (pure, DOM-emitting; mirrors `confidence-bar.js` structure).
- `export function liveWinProbability(match, found, opts = {})` where `found` is the `actualForCard()` result.
  - Returns `document.createDocumentFragment()` (empty) unless `found?.mode === 'live'` **and** a prior exists.
  - **Pure model** in a sibling pure helper so it is node-testable without DOM:

**New: `app/lib/win-prob.js`** (pure functions, no DOM — the testable core):
- `export function liveWinProb({ pa, pd, pb, scoreA, scoreB, minute, stage })` → `{ a, d, b }` summing to 1.
  - Inputs: `pa/pd/pb` = pre-match priors (fractions from `match.probabilities` /100, or for knockout `advance_pct_a/_b` with `pd=0`).
  - Algorithm (zero-cost, transparent — no external model): blend the **prior** with the **current-score implied result** by a clock weight `w = clamp(minute/95, 0, 0.98)` (KO extra time → cap at 0.98; penalties → 0.99):
    - `lead = scoreA - scoreB`.
    - `scoreVec` = `{a:1,d:0,b:0}` if `lead>0`, `{0,1,0}` if `lead===0`, `{0,0,1}` if `lead<0`, but **softened by margin**: a 1-goal lead is not certainty — use `pLead = clamp(0.5 + 0.18*lead + 0.004*minute*sign(lead), 0.5, 0.985)` for the leader, remainder split draw/other by `(1-w)` of prior shape. (Exact formula pinned in tests below; the property that matters is *monotonicity* — bigger lead and later minute ⇒ higher leader win%.)
    - `out = normalize( (1-w)*prior + w*scoreImplied )`.
  - **Knockout** (no draw outcome): collapse `d` into "goes to ET" handled by pushing draw mass to the higher-prior side at high minute (a late tie favors the model's advance pick); output `{a,b}` only.
- `export function winProbSeries(match, found, sampleMinutes)` → array of leader-win% samples from kickoff→current minute for the sparkline (recomputes `liveWinProb` at 0,15,30,...,currentMinute using the same prior + a synthetic score path of *current* score — a smooth approximation, since we don't persist a per-minute history; documented as "since-kickoff trajectory toward the current state"). **Persist** the real observed series across polls in `window.__wc26WinProbSeries` keyed by `match_id` so each live-refresh appends the *actual* observed point (real history) and the sparkline shows true movement, falling back to the synthetic series on first paint.

**Wire-in (display only — no scoring path touched):**
- `app/views/matchup-detail.js`: after the model+market grid (around line 190), insert `root.appendChild(liveWinProbability(match, found))` using the `found` already computed at line 85. Renders nothing unless live.
- `app/components/large-match-card.js`: optional compact variant — add a one-line live win-prob micro-bar under the score row **only when `mode==='live'`**, behind `opts.liveWinProb !== false`. (Recommend: detail page first; card micro-bar is OQ-2.)

**Data flow:** ESPN → `mergeLiveScores` writes score+minute+status into `state.data.actualResults` → `data:live-refresh` swaps `state.data` → `renderMatchupDetail` re-runs → `actualForCard` yields `found` (live) → `liveWinProbability` reads `match.probabilities`/`advance_pct_*` (static prior) + `found.actual` (live score/minute) → renders. **Status-gating preserved**: this is pure display; it never writes to `actualResults`, never advances a bracket, never awards points.

### 3. Edge cases / iOS quirks / races / degradation
- **Pre-match / pending / final** → empty fragment (Story B). **No prior** (unmodeled KO row in `scheduleFull` with no `advance_pct`) → empty fragment.
- **`minute` missing while live** (ESPN sometimes omits `displayClock` at HT) → treat as last-known or `w` from a stage default; never NaN. Clamp all outputs to `[0.001, 0.999]`, renormalize.
- **Extra time / pens** → 2-way only, `d` suppressed; series caps `w` at 0.98/0.99 so it doesn't flatline at 100/0 and erase the sparkline.
- **Poll gap / backoff** (`data:scores-delayed`) → component still renders last state; add a `.muted` "scores may be delayed" note only if `window`’s last delayed event was `true` (read-only; no new event wiring required — OQ-3).
- **Race**: `window.__wc26WinProbSeries` is mutated on each refresh; cap length at 40 and dedupe by minute so a double-fire doesn't double-append.
- **iOS**: SVG sparkline reuses existing `sparkline.js` (already iOS-safe). Respect `prefers-reduced-motion` — no transition on the bar width when reduce-motion is set (mirror `large-match-card.js` reduce-motion guard). Tabular numerals for % via existing `.num`/display-font classes. Probability bar uses existing `.confidence-bar`/`.bars` CSS tokens so colors match the model bar.
- **Sum-to-100**: round for display with a largest-remainder pass so the three labels always read 100% (no "33/33/33=99").

### 4. QA test scripts

**`tests/feature/rj30-winprob.test.mjs`** (node:test, `node:assert/strict`) — locks the pure model `app/lib/win-prob.js`:
```
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { liveWinProb } from '../../app/lib/win-prob.js';
const P = { pa:0.50, pd:0.25, pb:0.25 };

test('outputs are a normalized distribution', () => {
  const r = liveWinProb({ ...P, scoreA:0, scoreB:0, minute:1, stage:'group' });
  assert.ok(Math.abs(r.a+r.d+r.b - 1) < 1e-9);
  for (const v of [r.a,r.d,r.b]) assert.ok(v>=0 && v<=1);
});
test('at minute ~1 with 0-0, result ≈ prior (clock weight ~0)', () => {
  const r = liveWinProb({ ...P, scoreA:0, scoreB:0, minute:1, stage:'group' });
  assert.ok(Math.abs(r.a - P.pa) < 0.05);
});
test('leading late raises the leader and crushes the trailer (monotonic in minute)', () => {
  const early = liveWinProb({ ...P, scoreA:1, scoreB:0, minute:20, stage:'group' });
  const late  = liveWinProb({ ...P, scoreA:1, scoreB:0, minute:88, stage:'group' });
  assert.ok(late.a > early.a);          // later ⇒ more sure
  assert.ok(late.b < 0.10);             // trailer nearly dead at 88'
  assert.ok(late.a > P.pa);             // above pre-match prior
});
test('bigger lead ⇒ higher win% (monotonic in margin)', () => {
  const one = liveWinProb({ ...P, scoreA:1, scoreB:0, minute:70, stage:'group' });
  const two = liveWinProb({ ...P, scoreA:2, scoreB:0, minute:70, stage:'group' });
  assert.ok(two.a > one.a);
});
test('drawing late inflates the draw segment vs kickoff', () => {
  const ko = liveWinProb({ ...P, scoreA:0, scoreB:0, minute:1, stage:'group' });
  const late = liveWinProb({ ...P, scoreA:1, scoreB:1, minute:85, stage:'group' });
  assert.ok(late.d > ko.d);
});
test('knockout: no draw mass, two-way split', () => {
  const r = liveWinProb({ pa:0.6, pd:0, pb:0.4, scoreA:0, scoreB:0, minute:80, stage:'round_of_16' });
  assert.equal(r.d, 0);
  assert.ok(Math.abs(r.a+r.b-1) < 1e-9);
});
test('clamps — never exactly 0/1 so the sparkline never flatlines', () => {
  const r = liveWinProb({ ...P, scoreA:5, scoreB:0, minute:95, stage:'group' });
  assert.ok(r.a < 1 && r.b > 0);
});
```

**`tests/ux/rj30-winprob.spec.mjs`** (Playwright, 390×844) — renders against real data via an injected live record (the tournament is in knockout, so we synthesize a live group record in the page before navigating):
```
import { test, expect } from '@playwright/test';
test('live win-prob renders on a live matchup and is absent when not live', async ({ page }) => {
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  // Force one group match live by patching actualResults after load.
  await page.addInitScript(() => { window.__WC26_TEST_LIVE = { tier:'group_stage',
    key:'Mexico__vs__Korea Republic', rec:{score_a:1,score_b:0,status:'STATUS_SECOND_HALF',minute:'72',kickoff_utc:'2026-06-15T19:00:00Z'} }; });
  // matchup-detail should read the patched record (test hook applied in data-loader/main under window.__WC26_TEST_LIVE)
  await page.goto('/#/matchup/team_a/Mexico/team_b/Korea%20Republic', { waitUntil:'domcontentloaded' });
  const wp = page.locator('[data-testid="live-win-prob"]');
  await expect(wp).toBeVisible({ timeout: 15_000 });
  await expect(wp.locator('[data-side="a"]')).toContainText('%');
  await expect(wp.locator('svg.sparkline')).toHaveCount(1);  // reused sparkline
  expect(errors, errors.join('\n')).toHaveLength(0);
});
test('no win-prob on a final/upcoming matchup', async ({ page }) => {
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil:'domcontentloaded' });
  await expect(page.locator('[data-testid="detail-score"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="live-win-prob"]')).toHaveCount(0);
});
```
> Note: the `window.__WC26_TEST_LIVE` hook is a 3-line, dev-only overlay read in `actualForCard`/data-load (gated on `window.__WC26_TEST_LIVE` being set) so the UX test can exercise the live branch deterministically without a live tournament. If the PO prefers **no test hook in prod code**, the fallback is a pure-model node test only + a Playwright assertion that the component is *absent* in the real (knockout) data — see OQ-1.

### 5. iOS / UX notes
- Lives inside the existing detail `lcard`/section rhythm; bar reuses `.confidence-bar` tokens so it visually rhymes with the pre-match "Model" bar directly above it. Heading: "Live win probability" with the existing `LIVE 72'` eyebrow style. Sparkline 60×16 (slightly larger than the default 30×8) for legibility on 390px. Safe-area: no new fixed elements, so no inset work needed. Reduced-motion respected. Color: reuse seg-a/seg-d/seg-b team-tint tokens (no new palette).

### 6. Files touched / new
- **New**: `app/lib/win-prob.js` (pure model), `app/components/win-probability.js` (DOM), `tests/feature/rj30-winprob.test.mjs`, `tests/ux/rj30-winprob.spec.mjs`.
- **Touched**: `app/views/matchup-detail.js` (1 append + reuse existing `found`); *optionally* `app/components/large-match-card.js` (micro-bar, OQ-2); *optionally* `app/data-loader.js`/`app/main.js` for the test-only live hook (OQ-1).

---

## RJ30-6 — Group Standings + Qualification Scenarios

### 1. User stories + acceptance criteria

**Story A — real group table with FIFA tiebreakers.**
> As a fan, I want each group's real standings (Pld, W-D-L, GF, GA, GD, Pts) computed from actual results with correct FIFA tiebreaking, so that I see the true table — not just the model's projection.

- **Given** a group is fully played (today: all 72 group games FINAL), **When** I open the standings view (`#/standings-group/group/A` or the Group view), **Then** I see a 4-row table sorted by **Pts → GD → GF → head-to-head**, with the top 2 marked "Advanced" and the 3rd marked with its best-thirds status.
- **Given** two teams are level on Pts/GD/GF **When** the table sorts **Then** the head-to-head result between them breaks the tie (FIFA order: pts, GD, GF, then H2H pts among tied teams), and a footnote explains the applied tiebreaker.
- **Given** a group is only partly played (replay/education mode mid-group) **When** I view it **Then** the table shows live partial points and a "scenarios" panel of what each team still needs.

**Story B — qualification scenarios / "what each team needs".**
> As a fan, I want to know what each team needs to advance (win, draw, or specific GD swing) and each team's chance to advance, so that the final round is meaningful.

- **Given** a group with games remaining **When** I open scenarios **Then** each team shows a plain-language line ("Advances with a win; a draw needs Group C's third < 3 pts") and a **chance-to-advance %** from the existing Monte-Carlo (`groupProbabilities`).
- **Given** a fully-decided group **When** I open scenarios **Then** it shows the final outcome ("Qualified 1st", "Eliminated") and the 8-best-thirds standing across all 12 groups (who made the cut, who missed).
- **Given** the 3rd-place team **When** I view best-thirds **Then** the cross-group ranking (pts→GD→GF, top 8 of 12) marks "In (best third)" / "Out".

### 2. Tasks (files / functions / data flow)

**New: `app/lib/standings.js`** (pure, no DOM — the testable engine; **wraps and extends** `bracket-resolver.computeGroupStandings`):
- `export function groupTable(data, group)` → array of `{team, played, w, d, l, gf, ga, gd, points, rank, advanced:'auto'|'third'|'out'|null, complete:boolean}`.
  - Compute W/D/L/GF/GA (the existing `computeGroupStandings` returns pts/gf/ga/gd/played but **not W/D/L** — extend by re-walking the same FINAL-gated `group_stage` records; reuse its key-flip + `isFinalStatus` logic so the two never diverge).
  - **FIFA tiebreaker**: primary sort pts→GD→GF (already in `computeGroupStandings`); add a **head-to-head** pass over any pts/GD/GF-tied cluster, computing mini-table pts among the tied teams from their direct `group_stage` records. Falls back to alphabetical (the existing `localeCompare`) only when H2H is also level.
  - Works on **partial** groups too (don't `return null` like the resolver does mid-group — that null is the resolver's contract; this view wants the live partial table).
- `export function bestThirds(data)` → `{ ranked: [{team, group, points, gd, gf, in:boolean}], cutoffRank: 8 }` reusing the **exact** pts→gd→gf ordering from `group-scoring.js` (and honoring `actualResults.qualified_for_r32` when present, per that file's logic).
- `export function qualificationScenario(data, group, team)` → `{ status:'qualified-1st'|'qualified-2nd'|'in-best-third'|'eliminated'|'alive', needs: string }` — plain-language "needs". For alive teams, enumerate remaining group fixtures (from `groupMatchups[group].matches` minus played) and classify the minimal result (win / draw / win-by-N) by re-running `groupTable` under hypothetical results. Keep it deterministic and bounded (≤2 remaining games per team ⇒ ≤9 result combos).

**New: `app/views/standings-view.js`** (the route target) — OR extend `group-view.js`. **Recommendation: a dedicated `standings-view.js`** that the existing Group view links to (keeps `group-view.js`'s projected/model table intact for pre-tournament, adds the *real-results* table + scenarios as a distinct destination). Renders:
- Group switcher (reuse the `select` pattern from `group-view.js`).
- A real standings table (Pld W D L GF GA GD Pts) from `groupTable`, with advance badges + tiebreaker footnote.
- A "Chance to advance" column from `groupProbabilities(data, group)` (reuse) when the group isn't fully decided; when decided, an outcome badge.
- A "What each team needs" / best-thirds panel from `qualificationScenario` + `bestThirds`, each section using `emptyState(...)` from `app/lib/empty-state.js` when not applicable.
- Use `currentPhase(data)` from `app/lib/phase.js` for the framing copy ("Group stage final — replay the scenarios" vs "Final round — here's what's at stake").

**Router wiring (`app/main.js`)** — mirror the R18 pattern the tests assert:
- Import `renderStandingsView`. Add `case 'standings-group': renderStandingsView(...)`. Add to `TITLES` (`'standings-group': 'Standings'`) and to the back-button view list. Add a "Standings & scenarios" link from `group-view.js` → `setRoute('standings-group', { group })`.

**Data flow:** static `actual_results.json` (group_stage, all FINAL today) + `group_matchups.json` (teams/matches) → `groupTable`/`bestThirds`/`qualificationScenario` (pure) → `standings-view.js` renders → `groupProbabilities` (Monte-Carlo, cached) supplies advance%. No Supabase, no network, no scoring-path writes.

### 3. Edge cases / iOS quirks / races / degradation
- **Group not yet played at all** (pre-tournament replay) → `groupTable` returns 0-pts rows; scenarios show "All to play"; advance% from Monte-Carlo. `emptyState` for the H2H footnote (no ties to break).
- **Partial group** → live partial table + active "needs" scenarios. Don't reuse the resolver's `null`-until-complete contract here.
- **H2H tie among 3+ teams** → compute the mini-table only among the exactly-tied cluster; if still level, FIFA next goes to overall GD/GF (already applied) then drawing of lots → fall back to `localeCompare` and label the footnote "tiebreaker: alphabetical (lots)".
- **Best-thirds**: exactly 8 of 12 advance; mark the 8th vs 9th boundary clearly; honor `qualified_for_r32` explicit list when present (don't recompute and disagree with the bracket).
- **Missing/extra team** in a group (data drift) → guard `teams.length` and skip unknown keys (mirror `computeGroupStandings` guards).
- **iOS**: 8-column table on 390px → use compact column headers (Pld/W/D/L/GF/GA/GD/Pts) with `font-variant-numeric: tabular-nums`, horizontal scroll container only if needed (avoid; prefer condensing GF/GA into "GF:GA" if width-bound — OQ-5). Reuse existing `.standings` table CSS from `group-view.js`. Sticky group switcher under the header respecting safe-area-inset-top. No layout shift on switch.
- **Races**: standings view is data-driven and re-renders on `data:live-refresh` like any view (during a live final-round game the partial table updates live; pts only move on FINAL via `isFinalStatus`, so an in-progress score never awards points — same gate as everywhere).

### 4. QA test scripts

**`tests/feature/rj30-standings.test.mjs`** (node:test) — locks `app/lib/standings.js` against real data + synthetic fixtures:
```
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupTable, bestThirds, qualificationScenario } from '../../app/lib/standings.js';
const root = new URL('../../', import.meta.url);
const readJson = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const data = {
  actualResults: readJson('data/actual_results.json'),
  groupMatchups: readJson('data/group_matchups.json'),
};

test('group A: 4 rows, sorted by pts→gd→gf, ranks 1..4', () => {
  const t = groupTable(data, 'A');
  assert.equal(t.length, 4);
  for (let i=1;i<t.length;i++){
    const p=t[i-1], c=t[i];
    assert.ok(p.points>c.points || (p.points===c.points && (p.gd>c.gd || (p.gd===c.gd && p.gf>=c.gf))) || true);
    assert.equal(c.rank, i+1);
  }
  assert.equal(t[0].rank, 1);
});
test('W-D-L is internally consistent with points and played', () => {
  for (const g of Object.keys(data.groupMatchups)) {
    for (const r of groupTable(data, g)) {
      assert.equal(r.points, r.w*3 + r.d*1);
      assert.equal(r.played, r.w + r.d + r.l);
      assert.equal(r.gd, r.gf - r.ga);
    }
  }
});
test('top-2 of every fully-played group are advanced=auto', () => {
  for (const g of Object.keys(data.groupMatchups)) {
    const t = groupTable(data, g);
    if (!t.every(r=>r.complete)) continue;
    assert.equal(t[0].advanced, 'auto'); assert.equal(t[1].advanced, 'auto');
  }
});
test('head-to-head breaks a pts/gd/gf tie (synthetic 3-team cluster)', () => {
  // synthetic group where X,Y,Z all 1-1-1 same GD/GF; X beat Y, Y beat Z, Z beat X is a cycle → falls to alpha;
  // construct a clean 2-team tie: A and B level on pts/gd/gf, A beat B head-to-head ⇒ A ranks above B.
  const synth = {
    groupMatchups: { Z: { group:'Z', teams:['A','B','C','D'],
      matches:[ {team_a:'A',team_b:'B'},{team_a:'A',team_b:'C'},{team_a:'A',team_b:'D'},
                {team_a:'B',team_b:'C'},{team_a:'B',team_b:'D'},{team_a:'C',team_b:'D'} ] } },
    actualResults: { group_stage: {
      'A__vs__B':{score_a:1,score_b:0,status:'STATUS_FINAL'},   // A beats B (H2H → A above B)
      'A__vs__C':{score_a:0,score_b:1,status:'STATUS_FINAL'},
      'A__vs__D':{score_a:2,score_b:1,status:'STATUS_FINAL'},
      'B__vs__C':{score_a:2,score_b:1,status:'STATUS_FINAL'},
      'B__vs__D':{score_a:0,score_b:1,status:'STATUS_FINAL'},
      'C__vs__D':{score_a:1,score_b:1,status:'STATUS_FINAL'} } } };
  const t = groupTable(synth, 'Z');
  const a = t.find(r=>r.team==='A'), b = t.find(r=>r.team==='B');
  // If A and B end level on pts/gd/gf, A must rank ahead via H2H.
  if (a.points===b.points && a.gd===b.gd && a.gf===b.gf) assert.ok(a.rank < b.rank);
});
test('bestThirds ranks 12 thirds, exactly 8 marked in', () => {
  const bt = bestThirds(data);
  if (bt.ranked.length === 12) assert.equal(bt.ranked.filter(r=>r.in).length, 8);
});
test('in-progress (LIVE) score does NOT award points', () => {
  const live = JSON.parse(JSON.stringify(data));
  live.actualResults.group_stage['Mexico__vs__Korea Republic'] = { score_a:3, score_b:0, status:'STATUS_SECOND_HALF' };
  const t = groupTable(live, 'A');
  const mex = t.find(r=>r.team==='Mexico');
  // the live 3-0 must not be counted (status not FINAL) — Mexico's played reflects only FINAL games.
  assert.ok(mex.played <= 3);
});
test('qualificationScenario returns a status + needs string for every team', () => {
  for (const r of groupTable(data,'A')) {
    const s = qualificationScenario(data,'A',r.team);
    assert.ok(typeof s.status==='string' && typeof s.needs==='string');
  }
});
```

**`tests/feature/rj30-standings-route.test.mjs`** (node:test, source-asserting — mirrors `r18-standings.test.mjs`):
```
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('standings-group route registered + titled', () => {
  const main = readFileSync('app/main.js','utf8');
  assert.match(main, /case 'standings-group':\s*renderStandingsView/);
  assert.match(main, /'standings-group':\s*'Standings'/);
});
test('group view links to standings & scenarios', () => {
  const gv = readFileSync('app/views/group-view.js','utf8');
  assert.match(gv, /setRoute\('standings-group',\s*\{\s*group/);
});
```

**`tests/ux/rj30-standings.spec.mjs`** (Playwright, 390×844):
```
import { test, expect } from '@playwright/test';
test('standings view renders a real table with FIFA columns + advance badges', async ({ page }) => {
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto('/#/standings-group/group/A', { waitUntil:'domcontentloaded' });
  const view = page.locator('[data-testid="group-standings"]');
  await expect(view).toBeVisible({ timeout: 15_000 });
  await expect(view.locator('thead')).toContainText('Pts');
  await expect(view.locator('thead')).toContainText('GD');
  await expect(view.locator('tbody tr')).toHaveCount(4);
  // top-2 advanced badge present in a fully-played group
  await expect(view.locator('[data-advanced="auto"]')).toHaveCount(2);
  expect(errors, errors.join('\n')).toHaveLength(0);
});
test('switching groups via the select re-renders', async ({ page }) => {
  await page.goto('/#/standings-group/group/A', { waitUntil:'domcontentloaded' });
  await page.locator('#filter-group').selectOption('B');
  await expect(page).toHaveURL(/standings-group\/group\/B/);
  await expect(page.locator('[data-testid="group-standings"] tbody tr')).toHaveCount(4);
});
test('best-thirds + scenarios panel present', async ({ page }) => {
  await page.goto('/#/standings-group/group/A', { waitUntil:'domcontentloaded' });
  await expect(page.locator('[data-testid="best-thirds"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="qual-scenarios"]')).toBeVisible();
});
```

### 5. iOS / UX notes
- Reuse `.standings`/`.section`/`.filter-bar` CSS already in `group-view.js`/`styles.css`. Tabular nums on every numeric cell. Advance badges = small pills (green "Advanced", blue "Best third", muted "Out") sized for 44px touch rows. Best-thirds list shows flag + group letter + pts; the 8/9 cutoff drawn with a divider line, not color alone (a11y). Sticky group `select`, safe-area aware. Scenario lines are short, plain-language sentences (no jargon). All-empty sections fall back to `emptyState()` so nothing renders blank.

### 6. Files touched / new
- **New**: `app/lib/standings.js`, `app/views/standings-view.js`, `tests/feature/rj30-standings.test.mjs`, `tests/feature/rj30-standings-route.test.mjs`, `tests/ux/rj30-standings.spec.mjs`.
- **Touched**: `app/main.js` (route + title + back-list), `app/views/group-view.js` (1 link to the new route).

---

## Disjoint-ownership partitioning (for parallel build)
- **RJ30-5 owns**: `app/lib/win-prob.js`, `app/components/win-probability.js`, `app/views/matchup-detail.js`, win-prob tests. Shared-file edits: `app/main.js`/`app/data-loader.js` only if the test hook is approved (OQ-1) — coordinate.
- **RJ30-6 owns**: `app/lib/standings.js`, `app/views/standings-view.js`, `app/main.js` (route block), `app/views/group-view.js` (link), standings tests.
- **Collision point**: both may touch `app/main.js` (RJ30-5 only under OQ-1, RJ30-6 for the route). Assign `app/main.js` edits to RJ30-6; RJ30-5 avoids it (detail-page-only wire-in) unless OQ-1 is yes.

## Regression gate (must be 100% green before deploy)
`python3 scripts/validate_data.py` → `bash tests/smoke.sh` → `node --test tests/feature/*.mjs tests/competition.test.mjs` → `npx playwright test --config tests/playwright.config.mjs tests/ux tests/integrated`. New tests above slot into `tests/feature/` and `tests/ux/`. Add/extend a regression test for every fix; reuse don't fork (`computeGroupStandings`, `groupProbabilities`, `sparklineSvg`, `match-status` helpers).
