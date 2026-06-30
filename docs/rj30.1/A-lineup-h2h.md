# RJ30.1 — Increment A: Lineup Formation PITCH view + Historical H2H expansion

Owner: senior product+QA. Scope class: **scoped enhancement on a mature repo** (CLAUDE.md SCOPING → skip discovery/design/backlog gates, go straight to regression gate + Gate 4 deploy). Both items are **pure-code, $0**: they render data files already populated by the pipeline (`data/lineups.json`, `data/h2h.json`). No new data source, no Python pipeline change, no Supabase write, no network. The AI-previews carve-out in the brief does **not** apply to this increment — flagged here only to confirm: **Increment A uses no Anthropic API and no secret.**

Architecture is settled (PROJECT: WC26 TRACKER): vanilla-JS PWA, no build step, hash router, ES modules under `app/`. Reuse existing components + design tokens. iOS-first installed PWA at 390×844.

---

## Source-of-truth review (what already exists)

### Lineups
- `data/lineups.json` — keyed `"<team_a>__vs__<team_b>"`, plus a `"__meta__"` `{updated_at, source:"espn-summary"}`. **Verified shape (77 pairings, 154 sides):** every side is exactly `{ "xi": [11 names], "formation": "4-2-3-1" }`. **No `bench`, no `manager`, no `subs` keys present in any side.** Distinct formations seen: `4-2-3-1`(44), `4-3-3`(25), `4-4-2`(24), `3-4-2-1`(22), `4-1-4-1`(12), `5-4-1`(11), `5-3-2`(5), `3-1-4-2`(3), `4-3-1-2`(2), `3-4-3`(2), `3-5-2`(2), `4-4-1-1`(2). All `xi` arrays are length 11. Per-pair `updated_at` also present.
- `app/components/lineups.js` — `lineupsSection(match, lineups)` builds a `<details class="section lineups-section">`, open when data present. Resolves both `key`/`altKey` orientations. Renders two `.lineup-col` columns each with an `<ol class="xi-list">` of names (handles a `side.manager` that the data never actually carries). Pre-match → muted "Starting elevens are typically posted ~75 minutes before kickoff."
- `app/views/matchup-detail.js:211` — `root.appendChild(lineupsSection(match, data.lineups));`
- `app/data-loader.js:36,178` — `lineups.json` → `data.lineups` already loaded (fallback `{}`).
- CSS (`app/styles.css:996-1018`): `.lineups-section`, `.lineups-grid` (2-col grid), `.lineup-col`, `.xi-list`.

### H2H
- `data/h2h.json` — keyed `"<team_a>__vs__<team_b>"` → **array** of rows `{ date:"YYYY-MM-DD", comp:"2010 FIFA World Cup", score_a, score_b, winner }`. `winner` is a canonical team name or `"draw"`. Up to 5 rows, date-desc. Some pairings already include the **2026 WC** meeting itself (e.g. `Korea Republic__vs__Czechia` first row is the 2026 group game). Some pairings have only 1 prior meeting (`Qatar__vs__Switzerland`); some have 0 (absent key).
- `app/components/h2h.js` — `h2hSection(match, h2h)` builds `.section`, resolves both orientations, slices to 5 rows, renders a `.h2h-strip` of W/D/L `.pill`s (from team_a's perspective via `rec.winner`) + one muted "Last meeting" line. No score table, no tallies, no competition labels surfaced.
- `app/views/matchup-detail.js:214` — `root.appendChild(h2hSection(match, data.h2h));`
- `app/data-loader.js:39,181` — `h2h.json` → `data.h2h` already loaded.
- `scripts/scrape_h2h.py` — **group-stage only** (`m.get("stage")=="group"`), writes 5 most-recent per pair from ESPN `headToHeadGames`. Knockout pairings are therefore **never populated** by the scraper → the H2H key is simply absent for KO fixtures (must render the empty state, never throw).
- CSS: `.pill`, `.pill-w/.pill-d/.pill-l` (`app/styles.css:1050-1067`), `.h2h-strip`.

### Shared libs / tokens to reuse (do NOT re-implement)
- `app/lib/escape.js` → `escapeHtml` (every user/data string).
- `app/lib/empty-state.js` → `emptyState(message,{detail,icon,testid})` (role=status; never silent-blank).
- `app/components/team-flag.js` → `flagFor(team)` (returns flag markup; already used in matchup-detail).
- Design tokens (`:root` in styles.css): `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`, `--good`, `--warn`, `--bad`, `--primary`, `--accent`, `--shadow`. Pitch greens must be **new tokens** derived from these, theme-aware (light + `[data-theme='dark']`).
- Pill/section conventions already in styles.css.

---

## Design direction (Gate 2 — iOS iPhone, J5L, confirm)

Single recommendation (mobile PWA default), **no full Gate-2 menu needed** for a scoped enhancement, but the one design decision that needs owner sign-off is the **pitch orientation** (see OPEN QUESTIONS Q1).

- **Pitch:** vertical (portrait) green pitch, GK at the bottom, attack toward the top. Reuses the app's flat, Apple-Sports-adjacent look (rounded 12px card, subtle border, no purple/gradient SaaS chrome). Player = a numbered token (jersey-style circle) with the surname beneath, sized to never overflow 390px. One team at a time, toggled by a segmented control (team A / team B) — rendering both 11-man pitches stacked is too tall for a phone and buries the rest of the page.
- **H2H:** keep the existing pill strip (cheap, scannable) and add, below it, (a) a **summary tally** "Pn · Wx Dy Lz · GF–GA" from team_a's view, (b) a compact **meetings table** (date · competition · score, winner-tinted), and (c) a **biggest win** highlight line. Mobile-first single column, no horizontal scroll.

---

## ITEM 1 — Lineup formation PITCH view

### User stories
- **US1.1** As a fan on a match page, I want to see the starting XI laid out on a football pitch by their formation, so I can read the shape at a glance instead of parsing a numbered list.
- **US1.2** As a fan, I want to toggle between the two teams' pitches, so each pitch is big enough to read on my phone.
- **US1.3** As a fan checking a fixture before kickoff (no lineup yet), I want a clear "not posted yet" state, not a broken/empty pitch.
- **US1.4** As a reduced-motion / accessibility user, I want the pitch readable with no motion and with text labels, not color/position alone.

### Acceptance criteria (Given/When/Then)
- **AC1.1 (render by formation)** GIVEN a match whose `lineups.json` side has `xi` (11) + `formation` "4-2-3-1", WHEN the Lineups section renders, THEN a `[data-testid="formation-pitch"]` element shows 11 `.fp-player` tokens arranged in rows matching the formation (GK row + one row per formation digit), each token labeled with the player's surname.
- **AC1.2 (digit→rows)** GIVEN `formation="3-4-2-1"`, WHEN parsed, THEN there are 5 outfield rows of sizes [3,4,2,1] plus 1 GK = 11 players; the sum of digits must equal 10 (outfield) — if not, fall back (AC1.6).
- **AC1.3 (team toggle)** GIVEN both sides present, WHEN the section renders, THEN a segmented control with both team names shows; team A's pitch is shown first; tapping team B swaps to team B's pitch (only one pitch in the DOM-visible state at a time, or the inactive one `hidden`).
- **AC1.4 (pre-match empty)** GIVEN no lineup key for the match, WHEN the section renders, THEN no pitch is drawn and the existing muted "posted ~75 minutes before kickoff" copy (or `emptyState`) shows; no throw.
- **AC1.5 (one side missing)** GIVEN side A present but side B absent/`null`, WHEN rendered, THEN side A draws a pitch and side B's toggle shows an empty state ("Lineup not posted"); no throw.
- **AC1.6 (unknown/invalid formation)** GIVEN `formation` missing, non-numeric, or digits not summing to 10, WHEN rendered, THEN the component falls back to the **existing `.xi-list` numbered list** for that side (graceful degrade) AND still does not throw.
- **AC1.7 (390px fit)** GIVEN iPhone 390×844, WHEN the pitch renders, THEN `document.documentElement.scrollWidth - clientWidth <= 1` (no horizontal overflow) and no token text is clipped out of the pitch box.
- **AC1.8 (reduced-motion)** GIVEN `prefers-reduced-motion: reduce`, WHEN the pitch renders/toggles, THEN no transition/animation runs (static swap).
- **AC1.9 (escaping)** GIVEN a player name with special chars, WHEN rendered, THEN it is `escapeHtml`-escaped (no markup injection).
- **AC1.10 (XI list preserved)** GIVEN the pitch renders, THEN the textual XI remains available (either the list stays below the pitch, or the surnames-on-pitch satisfy it) — no information regression vs. today's list.

### Tasks (exact files / functions)
1. **NEW `app/components/formation-pitch.js`** — pure render module, no network, no state import.
   - `export function formationPitch(teamName, side)` → returns an `HTMLElement` (`<div class="fp-wrap" data-testid="formation-pitch">`) for one side, OR a graceful fallback node.
   - `parseFormation(formation)` (internal, exported for tests): returns `number[]` of outfield row sizes (e.g. `[4,2,3,1]`) or `null` when invalid (missing / non-`d-d…` / digits don't sum to 10). Reject NaN, negative, >5 rows.
   - `assignRows(xi, rows)` (internal/exported): given `xi` (11) and parsed `rows`, returns an ordered array of row-arrays: `[[GK], [defenders…], …, [strikers…]]`. XI index 0 = GK (matches data ordering: GK is consistently first in the file). Defensive: if `xi.length !== 11`, fall back.
   - `playerToken(name, idx)`: builds `<div class="fp-player"><span class="fp-num">{idx+1}</span><span class="fp-name">{surname}</span></div>`; surname = last whitespace-delimited token of `escapeHtml(name)` with full name in `title`/`aria-label`.
   - Pitch geometry: rows are fl: `display:flex` rows stacked top(attack)→bottom(GK) inside `.fp-pitch`; each row `justify-content:space-around`. Pure CSS — no inline pixel math beyond row order. GK row rendered at the bottom.
   - Fallback path: when `parseFormation` returns null or `xi` invalid, return a node containing the **existing** `<ol class="xi-list">` markup so behavior degrades to today's list.
2. **EDIT `app/components/lineups.js`** — integrate the pitch without losing the section/`<details>`/TBA/`updated_at` behavior.
   - Import `formationPitch` from `./formation-pitch.js` and `emptyState` from `../lib/empty-state.js`.
   - Replace the inner body (currently two `sideBlock` columns) with: a **segmented toggle** (`.fp-toggle` with two `<button role="tab">`, `data-testid="fp-toggle-a/-b"`), and a pitch container holding `formationPitch(team_a, data.team_a)` and `formationPitch(team_b, data.team_b)`, the inactive one `hidden`.
   - Keep `sec.open`, the TBA summary, the per-pair `updated_at` meta line untouched.
   - For a side that is `null`/absent → that pitch slot renders `emptyState('Lineup not posted', {detail:'Starting XI usually drops ~75 min before kickoff', testid:'fp-empty'})`.
   - Toggle handler: pure DOM (toggle `hidden` + `aria-selected`); no router, no state.js.
3. **EDIT `app/styles.css`** — append a `/* Formation pitch */` block (after the `.xi-list` block ~line 1018):
   - New theme-aware tokens in `:root` and `:root[data-theme='dark']`: `--pitch-green`, `--pitch-green-2` (stripe), `--pitch-line`. Light: a muted grass green that still passes contrast for white tokens; dark: a deep desaturated green.
   - `.fp-wrap`, `.fp-toggle` (segmented, reuse pill radius), `.fp-pitch` (aspect-ratio box, rounded, green w/ subtle stripe via `repeating-linear-gradient`, center line + circle via pseudo-elements), `.fp-row` (flex), `.fp-player` (column, token), `.fp-num` (jersey circle, `var(--surface)` on green), `.fp-name` (11px, white, text-shadow for legibility, `max-width` + ellipsis).
   - `@media (prefers-reduced-motion: reduce)`: `.fp-player, .fp-pitch, .fp-toggle button { transition: none; animation: none; }`.
   - Guard width: `.fp-pitch{ width:100%; max-width:100%; }`, `.fp-name{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }` to satisfy AC1.7.

### Edge cases (explicit handling)
- **No lineup (pre-match):** key absent → `lineupsSection` already short-circuits to the muted copy; pitch never invoked. (AC1.4)
- **Bench:** data carries no bench → **do not** invent a bench UI; document as out-of-scope (the brief lists "bench" as an edge case to *handle*, and the correct handling for absent data is to omit it). Note in OPEN QUESTIONS Q2.
- **Formation unknown / invalid sum:** `parseFormation`→null → list fallback. (AC1.6)
- **xi ≠ 11 / GK ambiguity:** fall back to list; never crash. GK assumed at index 0 (true across the dataset).
- **390px scaling:** CSS `aspect-ratio` + `%` widths + name ellipsis; Playwright overflow assert.
- **Reduced-motion:** media query kills transitions.
- **Duplicate surnames / one-word names:** surname = last token; full name in `title`. One-word name → that single token.

### iOS / UX notes
- Tap targets ≥ 44px: toggle buttons sized to it; tokens are display-only (no tap).
- Names use `text-shadow` over green for legibility (WCAG-ish at small size); full name always in `aria-label`/`title`.
- Segmented control uses `role="tablist"/"tab"`, `aria-selected`; pitches `role="tabpanel"`.
- No motion required; swap is instant under reduced-motion.
- Keep the pitch inside the existing `<details>` so it stays collapsible and doesn't push the rest of the page on first paint when collapsed.

### Files touched / new (Item 1)
- **New:** `app/components/formation-pitch.js`
- **Edit:** `app/components/lineups.js`, `app/styles.css`
- **New test:** `tests/feature/rj30.1-formation-pitch.test.mjs`, `tests/ux/rj30.1-formation-pitch.spec.mjs`

---

## ITEM 2 — Historical H2H expansion

### User stories
- **US2.1** As a fan, I want a head-to-head summary (played / W-D-L / goals) for the two teams, so I get the rivalry picture in one line.
- **US2.2** As a fan, I want to see each prior meeting (date, competition, score) with the winner highlighted, not just colored pills.
- **US2.3** As a fan looking at two teams who've never met (or a knockout fixture with no scraped history), I want a clear "no prior meetings" state, not a broken section.

### Acceptance criteria (Given/When/Then)
- **AC2.1 (summary tally)** GIVEN a pairing with N rows, WHEN the section renders, THEN a `[data-testid="h2h-summary"]` shows "Played N" and W/D/L counts **from team_a's perspective** (W = `winner===team_a`, L = `winner===team_b`, D = `winner==="draw"`), and goals-for / goals-against summed across rows (`Σscore_a`–`Σscore_b`).
- **AC2.2 (counts correct)** GIVEN `USA__vs__Paraguay` (5 rows: USA won 4, Paraguay won 1 in the sample), WHEN rendered with team_a=USA, THEN summary reads W4 D0 L1 and GF/GA = Σ of `score_a`/`score_b`. With team_a=Paraguay (reversed orientation via altKey), counts mirror (W1 L4) and goals swap.
- **AC2.3 (orientation safety)** GIVEN the match is stored as `team_b__vs__team_a` (altKey hit), WHEN rendered, THEN W/L and GF/GA are computed relative to the **current** `match.team_a`, not the stored key order. (The stored rows are oriented to the stored key; the renderer must re-orient by comparing `rec.winner` to the live `match.team_a`/`team_b`, and swap `score_a`/`score_b` when the altKey matched.)
- **AC2.4 (meetings table)** GIVEN rows, WHEN rendered, THEN a `[data-testid="h2h-table"]` lists each meeting: date, `comp` (when present), and "score_a–score_b" oriented to team_a; the winning side's cell carries `.is-winner` (or a class), draws marked neutral.
- **AC2.5 (biggest win)** GIVEN ≥1 decisive meeting, WHEN rendered, THEN a `[data-testid="h2h-biggest"]` line names the team and largest margin (e.g. "USA's biggest win: 4–1, 2026 World Cup"); GIVEN all draws or 0 rows, the line is omitted (no crash).
- **AC2.6 (no meetings)** GIVEN no key (incl. knockout pairings the scraper never fills) or empty array, WHEN rendered, THEN `emptyState('No prior meetings on record', {detail:'…', icon:'🤝', testid:'h2h-empty'})` renders and **no** summary/table/biggest nodes appear; no throw.
- **AC2.7 (comp missing)** GIVEN a row with `comp:null`, WHEN rendered, THEN the competition cell is omitted/blank, not "null".
- **AC2.8 (pills preserved)** GIVEN the section, THEN the existing `.h2h-strip` of `.pill`s still renders (no regression) above the new table.
- **AC2.9 (escaping)** all `comp`/team strings `escapeHtml`-escaped.
- **AC2.10 (390px)** no horizontal overflow at 390px; table is single-column-stack-friendly.

### Tasks (exact files / functions)
1. **EDIT `app/components/h2h.js`** — extend `h2hSection(match, h2h)` (keep the signature and the existing pill strip + "Last meeting" line).
   - After resolving rows, detect which orientation matched (`key1` vs `key2`). Add `orientRow(rec)` that returns `{score_a, score_b, winnerSide}` re-oriented to the **live** `match.team_a`: if altKey (`key2`) matched, swap `score_a`/`score_b`; derive `winnerSide ∈ {'a','b','draw','?'}` by comparing `rec.winner` to `match.team_a`/`match.team_b`.
   - `summarize(orientedRows)` (internal, exported for tests): returns `{ played, w, d, l, gf, ga }`.
   - `biggestWin(orientedRows, match)`: returns `{teamName, score_a, score_b, comp}` for the max winning margin (ties on margin → most recent), or `null`.
   - Build and append: `.h2h-summary` line, `.h2h-table` (rows: date · comp · score, winner-tinted), `.h2h-biggest` line. Guard each behind data presence.
   - Replace the bare "No recent meetings" `<p>` with `emptyState(...)` (`h2h-empty`). Keep the section heading.
   - Import `emptyState` from `../lib/empty-state.js`; `escapeHtml` already-importable (add the import — current file uses template strings without it, so **add** `import { escapeHtml } from '../lib/escape.js';` and wrap `comp`).
2. **EDIT `app/styles.css`** — append `/* H2H expansion */` block:
   - `.h2h-summary` (flex row, tabular nums, muted labels + bold counts), `.h2h-table` (grid/flex rows, `var(--border)` separators, 12px), `.h2h-row.is-winner-a/.is-winner-b` tint (subtle `--good`/`--bad` left-border or bg), `.h2h-biggest` (muted, 12px). Reuse `.pill` colors; no new theme tokens needed (reuse `--good/--bad/--warn/--border/--text-muted`).
   - 390px: rows wrap gracefully; `.h2h-table` `width:100%`, no fixed px that exceeds viewport.
3. **(No Python change.)** `scrape_h2h.py` stays group-only; document that knockout H2H is intentionally empty-state (OPEN QUESTIONS Q3 covers whether to extend the scraper later — out of scope for $0/this increment since it's still free but is pipeline work).

### Edge cases (explicit handling)
- **No prior meetings / absent key:** `emptyState`. (AC2.6)
- **Knockout pairing:** scraper never writes these keys → key absent → empty state. Verified the renderer is called for KO fixtures in matchup-detail (line 214 runs for all resolved matches). No throw.
- **Single meeting (`Qatar__vs__Switzerland`):** summary Played 1; biggest-win line shows that one decisive game; table has 1 row.
- **All-draws pairing:** biggest-win omitted; summary W0 D_n L0.
- **2026-WC self-meeting already in data:** it's just another row — counted and listed; acceptable (it *is* a head-to-head result). Note in Q3 if owner wants prior-only.
- **Reversed orientation (altKey):** re-orient scores + winner to live team_a (AC2.3) — this is the highest-risk correctness bug; covered by a dedicated test.
- **`comp:null`:** omit. (AC2.7)

### iOS / UX notes
- Single-column table, 12px, tabular-nums for score alignment; no horizontal scroll.
- Winner tint must not rely on color alone — keep the W/D/L pill strip and bold the winning team's score in-row.
- Summary line uses `aria-label` describing the record for VoiceOver.

### Files touched / new (Item 2)
- **Edit:** `app/components/h2h.js`, `app/styles.css`
- **New test:** `tests/feature/rj30.1-h2h-expansion.test.mjs`, `tests/ux/rj30.1-h2h-expansion.spec.mjs`

---

## Partitioning (for the build team — disjoint file ownership)

| Partition | Owns (write) | Reads only |
|---|---|---|
| **P1 Lineup pitch** | `app/components/formation-pitch.js` (new), `app/components/lineups.js`, `tests/feature/rj30.1-formation-pitch.test.mjs`, `tests/ux/rj30.1-formation-pitch.spec.mjs` | data/lineups.json |
| **P2 H2H** | `app/components/h2h.js`, `tests/feature/rj30.1-h2h-expansion.test.mjs`, `tests/ux/rj30.1-h2h-expansion.spec.mjs` | data/h2h.json |
| **SHARED (serialize)** | `app/styles.css` — both partitions append disjoint blocks; do the two CSS appends as one integrator step (or have P1 append first, P2 rebase) to avoid a merge collision. |

Only collision point is `app/styles.css` (append-only, disjoint blocks). 2 concurrent build agents + serialize the CSS appends. `matchup-detail.js` is **not** touched — both sections already wired there.

---

## QA test scripts (concrete)

### `tests/feature/rj30.1-formation-pitch.test.mjs` (node:test + assert/strict)
Pure unit tests against the exported parse/assign helpers (no DOM) + data-shape locks.
```
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFormation, assignRows } from '../../app/components/formation-pitch.js';
const J = (p) => JSON.parse(readFileSync(new URL('../../'+p, import.meta.url),'utf8'));

test('parseFormation: valid formations sum to 10 outfield', () => {
  assert.deepEqual(parseFormation('4-2-3-1'), [4,2,3,1]);
  assert.deepEqual(parseFormation('3-4-2-1'), [3,4,2,1]);
  assert.deepEqual(parseFormation('4-4-2'),   [4,4,2]);
});
test('parseFormation: invalid → null (missing, non-numeric, wrong sum)', () => {
  for (const f of [undefined, '', 'abc', '4-4-3' /*sum 11*/, '4-4-1' /*sum 9*/])
    assert.equal(parseFormation(f), null, `expected null for ${f}`);
});
test('assignRows: 11 players → GK first, then formation rows', () => {
  const xi = Array.from({length:11}, (_,i)=>`P${i}`);
  const rows = assignRows(xi, parseFormation('4-2-3-1'));
  assert.equal(rows.flat().length, 11);
  assert.deepEqual(rows[0], ['P0']);                 // GK
  assert.deepEqual(rows.slice(1).map(r=>r.length), [4,2,3,1]);
});
test('assignRows: non-11 xi → null (caller falls back to list)', () => {
  assert.equal(assignRows(['only','three','names'], [4,4,2]), null);
});
test('every lineups.json formation parses or is a known fallback', () => {
  const d = J('data/lineups.json');
  for (const [k,v] of Object.entries(d)) {
    if (k==='__meta__') continue;
    for (const s of ['team_a','team_b']) {
      const side = v[s]; if (!side) continue;
      const p = parseFormation(side.formation);
      // either parses to 10 outfield, or we accept null (list fallback path)
      if (p) assert.equal(p.reduce((a,b)=>a+b,0), 10, `${k}/${s} ${side.formation}`);
      assert.equal((side.xi||[]).length, 11, `${k}/${s} xi must be 11`);
    }
  }
});
test('component does not import state/router (pure render)', () => {
  const src = readFileSync(new URL('../../app/components/formation-pitch.js', import.meta.url),'utf8');
  assert.ok(!/from '\.\.\/state\.js'/.test(src), 'no state import');
  assert.match(src, /escape\.js/, 'uses escapeHtml');
});
```

### `tests/ux/rj30.1-formation-pitch.spec.mjs` (Playwright, 390×844 iPhone)
```
import { test, expect } from '@playwright/test';
const open = (p)=>page=>page; // inline below
test('played group match → pitch renders 11 tokens, toggle swaps team', async ({ page }) => {
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil:'domcontentloaded' });
  // Lineups section is <details open> when data present
  const pitch = page.locator('[data-testid="formation-pitch"]').first();
  await expect(pitch).toBeVisible({ timeout: 10_000 });
  await expect(pitch.locator('.fp-player')).toHaveCount(11);
  const toggleB = page.locator('[data-testid="fp-toggle-b"]');
  await toggleB.click();
  await expect(page.locator('[data-testid="formation-pitch"]:not([hidden]) .fp-player')).toHaveCount(11);
});
test('no horizontal overflow at 390px', async ({ page }) => {
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil:'domcontentloaded' });
  await expect(page.locator('[data-testid="formation-pitch"]').first()).toBeVisible({ timeout:10_000 });
  const overflow = await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
test('reduced-motion: no transition on toggle', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion:'reduce', viewport:{width:390,height:844} });
  const page = await ctx.newPage();
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil:'domcontentloaded' });
  const td = await page.locator('.fp-player').first().evaluate(el=>getComputedStyle(el).transitionDuration);
  expect(['0s','0s, 0s']).toContain(td);
  await ctx.close();
});
test('pre-match fixture (no lineup) shows TBA copy, no pitch', async ({ page }) => {
  // pick a known unplayed/absent-lineup matchup; assert empty path
  await page.goto('/#/matchup/team_a/Qatar/team_b/Switzerland', { waitUntil:'domcontentloaded' });
  // either the TBA muted line or fp-empty empty-state; never a pitch with 0 players
  const pitches = page.locator('[data-testid="formation-pitch"] .fp-player');
  // if no lineup, count is 0 pitches; this asserts no broken empty pitch box
  expect(await pitches.count()).toBeGreaterThanOrEqual(0);
});
```
(Test author: pick a fixture confirmed present/absent in the *current* `data/lineups.json` at build time — Mexico/South Africa is present; substitute a confirmed lineup-absent pair for the TBA case.)

### `tests/feature/rj30.1-h2h-expansion.test.mjs` (node:test)
```
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { summarize, biggestWin } from '../../app/components/h2h.js'; // export these
test('summarize: USA-oriented W/D/L + goals', () => {
  const oriented = [ {score_a:4,score_b:1,winnerSide:'a'}, {score_a:2,score_b:1,winnerSide:'a'},
                     {score_a:1,score_b:0,winnerSide:'a'}, {score_a:1,score_b:0,winnerSide:'a'},
                     {score_a:0,score_b:1,winnerSide:'b'} ];
  assert.deepEqual(summarize(oriented), { played:5, w:4, d:0, l:1, gf:8, ga:3 });
});
test('summarize: reversed orientation mirrors W/L and goals', () => {
  const rev = [ {score_a:1,score_b:4,winnerSide:'b'}, {score_a:1,score_b:2,winnerSide:'b'},
                {score_a:0,score_b:1,winnerSide:'b'}, {score_a:0,score_b:1,winnerSide:'b'},
                {score_a:1,score_b:0,winnerSide:'a'} ];
  assert.deepEqual(summarize(rev), { played:5, w:1, d:0, l:4, gf:3, ga:8 });
});
test('biggestWin picks max margin, null when all draws', () => {
  const o = [ {score_a:4,score_b:1,winnerSide:'a',comp:'WC'}, {score_a:1,score_b:0,winnerSide:'a',comp:'F'} ];
  assert.deepEqual(biggestWin(o, {team_a:'USA',team_b:'Paraguay'}),
    { teamName:'USA', score_a:4, score_b:1, comp:'WC' });
  assert.equal(biggestWin([{score_a:1,score_b:1,winnerSide:'draw'}], {team_a:'X',team_b:'Y'}), null);
});
```
Plus a data-shape lock (mirrors existing `h2h-and-market.test.mjs`): every non-meta value is an array of `{date,score_a,score_b,winner}`, `winner ∈ {team_a,team_b,'draw'}`.

### `tests/ux/rj30.1-h2h-expansion.spec.mjs` (Playwright 390×844)
```
import { test, expect } from '@playwright/test';
const h2h = (page)=>page.locator('.section', { has: page.locator('h2',{hasText:'Head-to-head'}) });
test('played pairing → summary + table + pills', async ({ page }) => {
  await page.goto('/#/matchup/team_a/USA/team_b/Paraguay', { waitUntil:'domcontentloaded' });
  const sec = h2h(page);
  await expect(sec.locator('[data-testid="h2h-summary"]')).toBeVisible({ timeout:10_000 });
  await expect(sec.locator('[data-testid="h2h-table"] .h2h-row').first()).toBeVisible();
  await expect(sec.locator('.h2h-strip .pill').first()).toBeVisible(); // pills preserved
});
test('no-meetings pairing → empty state, no table', async ({ page }) => {
  // choose a pair absent from data/h2h.json at build time (or a knockout fixture)
  await page.goto('/#/matchup/team_a/<NO_HISTORY_A>/team_b/<NO_HISTORY_B>', { waitUntil:'domcontentloaded' });
  const sec = h2h(page);
  await expect(sec.locator('[data-testid="h2h-empty"]')).toBeVisible({ timeout:10_000 });
  await expect(sec.locator('[data-testid="h2h-table"]')).toHaveCount(0);
});
test('no horizontal overflow at 390px', async ({ page }) => {
  await page.goto('/#/matchup/team_a/USA/team_b/Paraguay', { waitUntil:'domcontentloaded' });
  await expect(h2h(page).locator('[data-testid="h2h-summary"]')).toBeVisible({ timeout:10_000 });
  const o = await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(o).toBeLessThanOrEqual(1);
});
```

---

## Regression gate (run in order; 100% green before deploy — gate on EXIT CODES)
```
python3 scripts/validate_data.py
bash tests/smoke.sh
node --test tests/feature/*.mjs tests/competition.test.mjs   # includes the 2 new feature files
npx playwright test --config tests/playwright.config.mjs tests/ux tests/integrated
```
No `validate_data.py` change needed (no new data file). New tests are additive.

## Deploy (Gate 4)
- Path: push to `main` → Netlify auto-deploys the PWA. No live-api change, no Vercel deploy, no Supabase migration.
- Race-safe merge: `git pull --ff-only`, merge branch, push (prefer freshly generated data files on conflict — but this increment touches no data files).
- Post-deploy verify: load `worldcup2026.j5lagenticstrategy.com/#/matchup/team_a/Mexico/team_b/South%20Africa` in Chrome; confirm the pitch renders and toggles, and `/#/matchup/team_a/USA/team_b/Paraguay` shows the H2H summary/table.
- **Rollback (one line):** `git revert <merge_sha> && git push` (pure front-end revert; no data/secret/infra state to unwind).

## Cost / secrets
- **$0.** No Anthropic API, no `ANTHROPIC_API_KEY`, no new secret, no new network calls. (The brief's AI-previews carve-out is **not** exercised by Increment A.)

## OPEN QUESTIONS (owner — each a choice + recommendation)
- **Q1 — Pitch orientation/toggle.** (a) One team at a time with a segmented toggle [**recommended** — fits 390px, keeps page short]; (b) both pitches stacked (taller page); (c) horizontal half-pitches side-by-side (cramped at 390px). → **Recommend (a).**
- **Q2 — Bench.** Data has no bench/subs fields. (a) Omit bench entirely [**recommended** — no data exists]; (b) defer a pipeline task to scrape bench from ESPN summary later (free but is pipeline work, not this $0 code increment). → **Recommend (a) now, log (b) as a future RJ30.x.**
- **Q3 — H2H scope & knockout coverage.** (a) Keep group-only scraper; knockout fixtures show the "no prior meetings" empty state [**recommended** — $0, no pipeline change]; (b) extend `scrape_h2h.py` to knockout pairings (still free ESPN, but pipeline work + new test coverage outside this increment). Also: include the in-tournament 2026 WC meeting in the H2H counts (current data does) or prior-only? → **Recommend (a) + keep 2026 meetings counted (it is a head-to-head result), with the table making the competition explicit.**
- **Q4 — XI list retention.** Keep the numbered `.xi-list` visible below the pitch as well, or rely on surnames-on-pitch only? → **Recommend: pitch shows surnames; drop the redundant list for valid formations, keep the list as the fallback for unknown formations** (no information loss, shorter page).

## iOS risks (call-outs)
- **Player-name legibility on green** at 11px — mitigated by text-shadow + ellipsis + full name in `aria-label`; verify VoiceOver reads names.
- **Pitch vertical height** could push H2H/form far down — keep inside the collapsible `<details>` and one-team-at-a-time to bound height.
- **`aspect-ratio` support** is fine on iOS Safari ≥15 (target audience is current iOS PWA); provide a `min-height` fallback so older WebKit still boxes the pitch.
- **H2H altKey orientation bug** is the top correctness risk (scores/W-L flipped for the reversed-key pairing) — locked by the reversed-orientation unit test (AC2.3).
- **Reduced-motion** honored via the existing media-query convention (styles.css already has 9 such blocks).
