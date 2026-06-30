# RJ30.1 — Item C: Per-match OG share cards + Accessibility / reduced-motion polish

Owner: senior product + QA. Scope: two additive, low-risk enhancements to the
WC26 Tracker PWA (vanilla JS, no build step, Netlify + Netlify Functions).
iOS-first, $0 cost, reuse existing tokens/components, **no UX regressions**.

This document is the implementation + QA plan for two independently-partitionable
work items:

1. **C-1 Per-match OG/Twitter share cards** — rich link unfurls for matchup links.
2. **C-2 Accessibility + reduced-motion polish** — audit + additive fixes.

---

## Context the build must respect (cited from the codebase)

### Sharing / OG infrastructure that already exists
- `netlify/functions/share-card.mjs` — server-rendered OG/Twitter card for shared
  **brackets**. Serves `/s/<token>`, looks up the snapshot via the public
  `get_shared_bracket` Supabase RPC, emits OG/Twitter meta, then `location.replace`
  bounces humans into `#/shared/token/<token>`. Has a local `esc()` HTML-escaper
  (lines 20–23) and points `og:image` at a **static** branded card
  `…/assets/og/share-card.jpg` (line 71).
- `netlify.toml` — the `/s/*` → `share-card?token=:splat` rewrite is declared
  **before** the SPA catch-all `/*` → `/index.html` (lines 12–15 vs 40–43). The
  ordering rule (specific redirects before the catch-all) is load-bearing.
- `scripts/build-og-card.mjs` + `scripts/og-card.html` — the **static** bracket
  card pipeline. Playwright (`@playwright/test`, already a devDependency) renders
  `og-card.html` at 1200×630 and screenshots it to `assets/og/share-card.jpg`
  (JPEG q85, kept < 300 KB). One-off build asset; no runtime dependency.
- `assets/og/share-card.jpg` (88 KB) — the existing branded bracket card.
- `app/share-bracket.js` — `buildShareUrl()` returns `…/s/<token>` for tokenized
  bracket links (real path so the function can serve previews) — fragments never
  reach the server (lines 63–73). `tryShareViaNavigator()` wraps `navigator.share`.
- `index.html` — the SPA shell. Static OG/description meta live here for the app
  root; per-route meta is **not** injected (the SPA only sets `document.title` in
  `app/main.js` line 185, never `og:*`). `<html lang="en">`, skip-link present.
- `tests/feature/r17-og-card.test.mjs` — the regression test that locks the
  bracket card's `og:image`/dimensions/escaping contract. Mirror its style.

### How matchup links work today (the gap)
- Matchup links across the app are **hash routes**:
  `#/matchup/team_a/<A>/team_b/<B>` — emitted in
  `app/components/matchup-card.js:19`, `app/components/search-overlay.js:87`,
  `app/views/home-view.js:535,678`, `app/views/schedule-view.js:151`,
  `app/views/venue-detail.js:57`, `app/views/my-picks.js:98`,
  `app/views/brackets-live-view.js:402`.
- Because the team identity is in the **URL fragment**, crawlers that paste a
  matchup link (iMessage, WhatsApp, Twitter/X, Slack, Discord) only see the bare
  SPA shell + the generic `index.html` OG tags. **Exactly the bracket problem,
  unsolved for matches.** This item closes it.
- `app/views/matchup-detail.js` — `renderMatchupDetail()` + the exported
  `resolveMatch(data, a, b)` helper (lines 394–415) is the canonical team-pair →
  match resolver: scans `groupMatchups` → `knockoutMatchups` → `scheduleFull`.
  The OG function should mirror this precedence (server-side, in plain JS).

### Matchup data available to a server function (committed JSON — no Supabase)
Verified shapes (read directly from `data/`):
- `data/group_matchups.json` — `{ "A": { group, teams, matches:[…], projected_standings }, … }`.
  Each match: `team_a, team_b, win_confidence_pct, predicted_winner, probabilities,
  match_id ("A__vs__B"), composite_a/_b, …`.
- `data/knockout_matchups.json` — **array** (len ~18) of match rows:
  `team_a, team_b, predicted_winner, win_confidence_pct, advance_pct_a, advance_pct_b,
  is_knockout, stage, match_id, kickoff_utc, …`.
- `data/schedule_full.json` — array of fixtures: `match_id, match_number, stage,
  team_a, team_b, kickoff_utc, kickoff_local_et, venue_id, group, broadcast`.
  **Only source of `kickoff_utc`** for group matches (knockouts carry it too).
- `data/teams.json`, `data/venues.json` — names/venue lookups.

> **Key decision input:** matchup model + kickoff data is already in committed,
> publicly-served JSON. A Netlify Function can `fetch()` those files at request
> time with **no new secret and no Supabase round-trip** — unlike the bracket card
> which *must* hit the RPC because snapshots are user-generated.

---

# C-1 — Per-match OG / Twitter share cards

## C-1 Architecture decision (resolve this first)

**Two axes:** (a) where the **OG image** comes from, (b) where the **meta-tag HTML**
comes from.

### Decision A — Meta HTML: **server-rendered Netlify Function per matchup** (RECOMMENDED)
Add a new route `/m/<A>__vs__<B>` (mirroring `/s/<token>`) handled by a new
`netlify/functions/match-card.mjs`. It resolves the pair against the committed
JSON, emits per-match OG/Twitter meta (team names, flags-in-title, kickoff, model
pick / to-advance), then `location.replace`-bounces humans into
`#/matchup/team_a/<A>/team_b/<B>`.

- **Why server function, not prebuilt-per-match HTML:** there are 104 fixtures and
  the pairings/picks change as the model + bracket resolve (knockout teams are
  placeholders until groups finish). Prebuilding 104 static HTML files would go
  stale on every data cron and bloat the repo; a function reads the latest JSON at
  request time. The bracket card already set this precedent.
- **Cost:** Netlify Functions free tier is ample (crawlers hit these rarely). $0.

### Decision B — OG image: **start with a templated static image, upgrade to dynamic only if needed** (RECOMMENDED two-phase)
- **Phase 1 (ship first):** reuse the **existing static branded card**
  `assets/og/share-card.jpg` as `og:image`, but make the **title/description fully
  dynamic** ("Mexico vs Korea Republic — Mexico 55% · Sat Jun 13, kickoff …").
  This is the bracket card's exact pattern and gets rich unfurls immediately with
  zero image-rendering infra. The teams/kickoff/pick live in the text the unfurl
  shows beneath the image.
- **Phase 2 (optional, gated on demand):** generate a **per-match image**. Two
  $0 options, in order of preference:
  1. **Prebuilt at data-build time** — extend `scripts/build-og-card.mjs` into a
     loop that renders one 1200×630 JPEG per fixture from a parametrized
     `scripts/match-og-card.html` template, writing `assets/og/match/<match_id>.jpg`.
     Runs in the existing Playwright devDependency, committed by the same cron that
     refreshes matchups. The function points `og:image` at the per-match file when
     it exists, else falls back to the generic card. **No runtime image render → no
     cold-start cost, fully cacheable by Netlify's CDN.**
  2. **On-the-fly SVG→meta** (rejected): rendering an image inside the function
     needs a headless browser or a canvas dep — neither is $0/zero-infra here.
     Skip.

> **Net recommendation:** Function for meta (Decision A) + **Phase-1 static image
> with dynamic text now**, with the **prebuilt-per-match image loop (B-2-1) as a
> fast-follow** if link-preview imagery matters. The function is written so the
> image URL is a single computed line — Phase 2 flips it on without touching the
> meta logic.

## C-1 User stories + acceptance criteria

### Story C1-S1 — Rich unfurl for a shared matchup link
*As a fan who pastes a matchup link into iMessage/WhatsApp/X/Slack, I want the
preview to show the two teams, the kickoff, and the model's pick, so the link is
compelling without opening it.*

- **AC1 (group match, modeled)**
  - **Given** a request to `/m/Mexico__vs__Korea%20Republic`
  - **When** the function resolves it against `data/group_matchups.json`
  - **Then** the response is `200 text/html` whose `<title>` and `og:title`
    contain both team names and `og:description` contains the kickoff
    (formatted from `schedule_full.kickoff_utc`) and the model pick
    ("Mexico 55%" derived from `predicted_winner` + `win_confidence_pct`).
- **AC2 (knockout match, to-advance)**
  - **Given** a request for a pair present in `data/knockout_matchups.json`
  - **When** resolved
  - **Then** `og:description` leads with the **to-advance** framing using
    `advance_pct_a`/`advance_pct_b` (e.g. "Argentina 63% to advance"), not a
    group W/D/L %, and the round name (Round of 16 / Quarterfinal / …) appears.
- **AC3 (human redirect)**
  - **Given** a real browser (not a crawler) loads `/m/<A>__vs__<B>`
  - **When** the page loads
  - **Then** it `location.replace`s to `#/matchup/team_a/<A>/team_b/<B>` and the
    `<a>` fallback + `<meta http-equiv="refresh">` are present for no-JS clients.
- **AC4 (escaping)**
  - **Given** a team name with an apostrophe/ampersand (e.g. "Côte d'Ivoire")
  - **When** the meta is emitted
  - **Then** every interpolated value is HTML-escaped via the function's `esc()`
    and no raw `<`, `>`, `"`, `'`, `&` appears in any `content="…"`.
- **AC5 (1200×630 contract)**
  - **Then** `og:image:width=1200`, `og:image:height=630`,
    `twitter:card=summary_large_image`, and `og:image` resolves to an existing
    asset (Phase 1: the generic branded card; Phase 2: the per-match file).

### Story C1-S2 — Graceful handling of unresolved / placeholder matchups
*As a user sharing a knockout link before the bracket resolves, I want a sensible
preview rather than a broken or empty one.*

- **AC6 (placeholder teams)**
  - **Given** a knockout pair whose sides are placeholders (e.g. "Winner Group A"
    / "1A", "2B", or a TBD token) and not yet a concrete country
  - **When** resolved
  - **Then** the card still renders with the placeholder labels and a generic
    description ("Knockout matchup · 2026 FIFA World Cup") — **never** a 500, and
    `og:image` falls back to the generic branded card.
- **AC7 (unknown pair)**
  - **Given** a pair that matches no row in any of the three JSON sources
  - **When** resolved
  - **Then** the function returns `200` with a generic WC26 matchup card and still
    bounces humans to the SPA route (the SPA shows "Matchup not found." — existing
    behavior, `matchup-detail.js:40`). No 404/500.
- **AC8 (either orientation)**
  - **Given** `/m/A__vs__B` or `/m/B__vs__A`
  - **Then** both resolve to the same fixture (mirror `resolveMatch`'s both-
    orientation lookup).

### Story C1-S3 — Shareable matchup link surfaced in the UI
*As a user on a matchup page, I want a Share button that copies the rich `/m/` URL.*

- **AC9 (share affordance)**
  - **Given** the matchup detail page is open
  - **When** I tap the Share control
  - **Then** `navigator.share` (or clipboard fallback) is invoked with the
    `/m/<A>__vs__<B>` path URL (NOT the `#/matchup/…` hash), reusing
    `tryShareViaNavigator()` from `app/share-bracket.js`.
  - **Note:** additive — if a share affordance is out of scope for the first cut,
    AC9 may be deferred; AC1–AC8 (the unfurl) stand alone because users already
    paste the address-bar URL. **See OPEN QUESTION 3.**

## C-1 Tasks (exact files / functions)

### New: `netlify/functions/match-card.mjs`
- Export `default async (req) => Response` (Netlify v2 signature, same as
  `share-card.mjs`).
- Copy the `esc()` escaper and `origin_from()`/`origin` derivation from
  `share-card.mjs` verbatim (or factor both into
  `netlify/functions/_lib/og-html.mjs` — see refactor note below).
- `parsePair(req)`: read `?pair=:splat` (from the rewrite) or parse
  `/m/<pair>` from the path; split on `__vs__`; `decodeURIComponent` both sides.
- `resolveMatchServer(pair)`: `fetch('${origin}/data/group_matchups.json')`,
  `…/knockout_matchups.json`, `…/schedule_full.json` (the publish dir serves
  these). Mirror `matchup-detail.js#resolveMatch` precedence:
  group → knockout → schedule; both orientations. Return `{ match, source }`.
  Wrap every fetch/parse in try/catch → on any failure fall through to the
  generic card (never throw).
- `describeMatch(match, source, schedule)`:
  - title: `"${A} vs ${B} — WC26 Tracker"`.
  - desc (group, modeled): `"${kickoffShort} · Model: ${predicted_winner}
    ${win_confidence_pct}%. See the full matchup breakdown."`.
  - desc (knockout): `"${roundName} · ${A} ${advance_pct_a}% to advance vs ${B}
    ${advance_pct_b}%. ${kickoffShort}."` (use `prettyStageName` map copied from
    `matchup-detail.js:359`).
  - desc (placeholder/unknown): generic fallback (AC6/AC7).
  - kickoff formatting: read `kickoff_utc` from the resolved row or look it up in
    `schedule_full` by `match_id`; format to a short human string
    (`new Date(...).toUTCString()`-derived, or a small formatter — keep it a pure
    function for unit testing). **No timezone libs** ($0/no-dep).
- `ogImageFor(match)`: Phase 1 → `${origin}/assets/og/share-card.jpg`.
  Phase 2 → `${origin}/assets/og/match/${match.match_id}.jpg` if that asset is
  expected to exist (gate by a const flag `MATCH_IMAGES_ENABLED` so Phase 2 is a
  one-line flip + the prebuild step).
- Emit the same meta block as `share-card.mjs` (og:type/site_name/title/description/
  image/image:width/height/alt/url, twitter:card/title/description/image/alt,
  canonical, refresh + `location.replace`). `appUrl =
  ${origin}/#/matchup/team_a/${encEnc(A)}/team_b/${encEnc(B)}`.
- Headers: `content-type: text/html; charset=utf-8`,
  `cache-control: public, max-age=300` (short, so previews refresh as the model
  updates — same as the bracket card).

### `netlify.toml`
- Add **before** the `/*` catch-all (and it can sit next to `/s/*`):
  ```toml
  [[redirects]]
    from = "/m/*"
    to = "/.netlify/functions/match-card?pair=:splat"
    status = 200
  ```

### `app/share-bracket.js` (or a tiny new `app/share-match.js`)
- Add `buildMatchShareUrl(teamA, teamB)` returning
  `${location.origin}/m/${encodeURIComponent(`${teamA}__vs__${teamB}`)}`.
  Keep it next to `buildShareUrl` so the "/m/ is a real path for OG" rationale
  lives with its sibling. (New file preferred to keep ownership disjoint from C-2
  and from bracket sharing — see partitioning.)

### `app/views/matchup-detail.js` (AC9, optional first-cut)
- In the header `starRow` (line 79–82), append a Share `<button class="icon-btn"
  type="button" aria-label="Share this matchup">` that calls
  `tryShareViaNavigator(buildMatchShareUrl(match.team_a, match.team_b),
  `${match.team_a} vs ${match.team_b}`)`. **Additive**; reuse existing
  `.icon-btn`/pick-btn token sizing so it is ≥44px (ties into C-2).

### Phase 2 (optional, separate task): `scripts/match-og-card.html` + extend `scripts/build-og-card.mjs`
- New parametrized template (clone `og-card.html`, add team-flag SVG slots + a
  pick line). Extend the build script to iterate every fixture from
  `data/schedule_full.json` (+ model rows for the pick text), rendering
  `assets/og/match/<match_id>.jpg` (q85, < 200 KB each). Add a `data/` cron hook
  to re-run it. **Defer unless OPEN QUESTION 2 → "yes".**

### Refactor note (keep minimal, no opportunistic churn)
The CLAUDE.md rule is "fix only what's scoped." Two functions will now share
`esc()` + the meta-emit skeleton. Acceptable options, least-churn first:
(a) **duplicate** the ~6-line `esc()` into `match-card.mjs` (lowest risk, matches
the repo's current "each function self-contained" style); or
(b) extract `netlify/functions/_lib/og-html.mjs` exporting `esc`, `originFor`,
`ogMetaHtml({title,desc,image,url,appUrl})` and have **both** functions import it.
**Recommendation: (a) for the first ship** (zero blast radius on the existing,
tested bracket card), schedule (b) as a follow-up only if a third consumer appears.

## C-1 Edge cases (checklist for the build)
- Knockout vs group — different desc framing (to-advance vs W/D/L pick). [AC1/AC2]
- Unresolved / placeholder teams ("1A", "Winner Group X", TBD) — generic card,
  no throw. [AC6]
- Unknown pair (no JSON match) — generic card + human bounce, 200 not 404. [AC7]
- Both orientations `A__vs__B` / `B__vs__A`. [AC8]
- `__vs__` appearing inside a team name (none today, but split on the **last**
  `__vs__` defensively, or assert exactly one separator).
- `kickoff_utc` missing/null — desc omits the kickoff clause, no "Invalid Date".
- Escaping every interpolated value (apostrophes, ampersands, `<`). [AC4]
- 1200×630 / `summary_large_image` contract preserved. [AC5]
- `fetch` of committed JSON failing (deploy mid-cron) — try/catch → generic card.
- Cache-control short (300 s) so previews don't pin a stale pick.
- Redirect ordering in `netlify.toml`: `/m/*` MUST precede `/*`.

## C-1 QA — concrete test scripts

### `tests/feature/rj30_1-match-og.test.mjs` (node:test — primary contract)
Imports the function handler directly (like `r17-og-card.test.mjs`) and drives it
with `Request` objects. **No network**: stub `globalThis.fetch` to return the
committed JSON files (`readFileSync('data/group_matchups.json')` etc.) so the test
is hermetic and the resolver logic is exercised against real data shapes.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler from '../../netlify/functions/match-card.mjs';

// Hermetic fetch stub: map /data/<file>.json to the committed file on disk.
const realFetch = globalThis.fetch;
function stubFetch() {
  globalThis.fetch = async (url) => {
    const m = String(url).match(/\/data\/([\w.-]+)$/);
    if (!m) return { ok: false, status: 404, json: async () => ({}) };
    const body = readFileSync(`data/${m[1]}`, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  };
}
test.before(stubFetch);
test.after(() => { globalThis.fetch = realFetch; });

function reqFor(pair) {
  return new Request(
    `https://worldcup2026.j5lagenticstrategy.com/.netlify/functions/match-card?pair=${encodeURIComponent(pair)}`
  );
}

test('group match: dynamic title + model pick + 1200x630 contract', async () => {
  const res = await handler(reqFor('Mexico__vs__Korea Republic'));
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /og:title" content="[^"]*Mexico[^"]*Korea Republic/);
  assert.match(body, /og:description" content="[^"]*Mexico[^"]*%/);   // pick %
  assert.match(body, /og:image:width" content="1200"/);
  assert.match(body, /og:image:height" content="630"/);
  assert.match(body, /twitter:card" content="summary_large_image"/);
  // human bounce target is the hash route
  assert.match(body, /#\/matchup\/team_a\/Mexico\/team_b\/Korea%20Republic/);
});

test('knockout match: to-advance framing + round name', async () => {
  // pick a real pair from data/knockout_matchups.json at test time
  const ko = JSON.parse(readFileSync('data/knockout_matchups.json', 'utf8'));
  const k = ko[0];
  const res = await handler(reqFor(`${k.team_a}__vs__${k.team_b}`));
  const body = await res.text();
  assert.match(body, /to advance/i);
  assert.match(body, /Round of|Quarterfinal|Semifinal|Final/);
});

test('either orientation resolves the same fixture', async () => {
  const a = await (await handler(reqFor('Mexico__vs__Korea Republic'))).text();
  const b = await (await handler(reqFor('Korea Republic__vs__Mexico'))).text();
  // both carry both names + a pick %
  for (const body of [a, b]) {
    assert.match(body, /Mexico/); assert.match(body, /Korea Republic/);
  }
});

test('unknown pair → generic card, 200, still bounces to SPA', async () => {
  const res = await handler(reqFor('Atlantis__vs__El Dorado'));
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /2026 FIFA World Cup|WC26/);
  assert.match(body, /#\/matchup\/team_a\/Atlantis\/team_b\/El%20Dorado/);
});

test('escaping: apostrophe/ampersand team names are escaped', async () => {
  const res = await handler(reqFor("Côte d'Ivoire__vs__Senegal"));
  const body = await res.text();
  // no raw apostrophe inside any content="..."
  const contents = [...body.matchAll(/content="([^"]*)"/g)].map((m) => m[1]);
  for (const c of contents) assert.ok(!/['<>]/.test(c) || c.includes('&#39;') || c.includes('&lt;'));
});

test('placeholder knockout pair does not throw, falls back', async () => {
  const res = await handler(reqFor('1A__vs__2B'));
  assert.equal(res.status, 200);   // never 500
});
```

### `tests/feature/rj30_1-match-og-redirect.test.mjs` (or fold into above)
- Assert `<meta http-equiv="refresh"` present, `location.replace(` script present,
  `<a … href` fallback present (no-JS crawler/human safety). [AC3]
- Assert `cache-control: public, max-age=300` header. [edge]
- Assert `netlify.toml` contains a `/m/*` redirect declared **before** `/*`
  (read the file, find both `from = "/m/*"` and `from = "/*"`, assert the `/m/*`
  index < `/*` index). Locks the ordering invariant.

### `tests/feature/rj30_1-match-share-url.test.mjs` (unit, jsdom-free)
- Import `buildMatchShareUrl` and assert it returns
  `…/m/Mexico__vs__Korea%20Republic` (path, not hash; encoded). [AC9 prerequisite]

### Playwright (optional, AC9 only) — extend an existing matchup spec
- `tests/ux/knockout-matchup.spec.mjs` already loads a matchup; add an assertion
  that a `[aria-label="Share this matchup"]` button exists and (with
  `navigator.share` stubbed via `addInitScript`) is invoked with a `/m/` URL on
  click. Keep ad-hoc/audit specs out of the glob (config `testIgnore` qa-*).

### Smoke / prod verification (manual, post-deploy — Gate 4)
- `curl -s https://worldcup2026.j5lagenticstrategy.com/m/Mexico__vs__Korea%20Republic | grep -E 'og:(title|description|image)'`
  shows the dynamic title + pick + 1200×630 image.
- Paste the URL into the X/Facebook/LinkedIn link-preview debuggers (manual
  handoff — outside Claude's reach) to confirm the unfurl renders.

## C-1 iOS / UX notes
- The unfurl is consumed off-device (the recipient's chat app), so no on-device
  layout risk. The **only** in-app surface is the optional Share button — reuse
  the existing `.icon-btn` token so it is ≥44px and gets the C-2 focus ring.
- `navigator.share` is fully supported in iOS Safari → the native share sheet
  fires; clipboard fallback covers desktop. Already proven by
  `tryShareViaNavigator`.
- No new render path on the home/schedule/matchup views → zero regression surface
  for the visual UI.

## C-1 Files touched / new
- **New:** `netlify/functions/match-card.mjs`.
- **New:** `app/share-match.js` (or extend `app/share-bracket.js`).
- **New (Phase 2, deferred):** `scripts/match-og-card.html`,
  `assets/og/match/*.jpg` (generated), build-loop edit in
  `scripts/build-og-card.mjs`.
- **New (tests):** `tests/feature/rj30_1-match-og.test.mjs`,
  `tests/feature/rj30_1-match-share-url.test.mjs`
  (+ optional `…-redirect.test.mjs`).
- **Edit:** `netlify.toml` (add `/m/*` redirect before `/*`).
- **Edit (AC9, optional):** `app/views/matchup-detail.js` (Share button),
  optional `tests/ux/knockout-matchup.spec.mjs`.
- **Possible refactor (deferred):** `netlify/functions/_lib/og-html.mjs`.

---

# C-2 — Accessibility + reduced-motion polish

## C-2 Current state (audit findings — what already exists vs gaps)

**Already in place (do NOT rebuild — additive only):**
- `index.html`: `<html lang="en">`, skip-link is the first focusable element
  (`<a href="#view" class="skip-link">`), `role="banner"/main/contentinfo`,
  `<main id="view" … role="main" tabindex="-1">`, tab-bar `role="tablist"` +
  `role="tab"`, most icon buttons have `aria-label` (Back, Settings, Account).
- `app/styles.css`: **11** `@media (prefers-reduced-motion: reduce)` blocks
  (lines 2350, 2612, 2771, 2826, 2919, 2930, 2991, 3220, 3366, 3387, 4487),
  including a global `--motion-*: 0ms` token zero-out (2350) and targeted
  `animation: none` for the live status-pill, here-dot, actual-win pulse, etc.
- `:focus-visible` baseline ring on button/a/input/select/textarea/[role=button]
  (3480–3490) + a high-contrast reinforcement (3474). `.skip-link`, `.sr-only`
  utilities (3616–3645). `min-height/min-width: 44px` floors on tab/pick/header
  buttons (lines 132, 211, 293, 497, etc.).
- JS animations already gate on reduced motion:
  - `app/confetti.js` — early-returns when `(prefers-reduced-motion: reduce)` OR
    `.wc-reduce-motion` class (lines 5–8). ✔
  - `app/components/win-probability.js` — `prefersReducedMotion()` sets
    `data-reduced-motion` + kills bar transitions (18–23, 107, 136–138). ✔
  - `app/components/sparkline.js` — static SVG, `aria-hidden="true"`, no animation. ✔

**Gaps to close (the actual work — keep additive, no behavior change):**
1. **Audit coverage is incomplete, not proven.** There is no regression test that
   *asserts* the a11y structure holds. The biggest deliverable is a **structural
   a11y Playwright spec** that locks roles/labels/tabindex/tap-targets so future
   changes can't silently regress them (axe-core is NOT a dep — see note).
2. **Icon-only buttons added since the last audit** may lack `aria-label`. Sweep:
  - `app/views/matchup-detail.js` watchlist star (`watchlistStar`), team-link
    flags (`aria-hidden` correct), any new Share button (C-1).
  - `app/components/watchlist-star.js`, `app/components/status-pill.js`,
    `app/components/tooltip.js` (info "?" affordances), `app/components/parlay.js`,
    `app/views/settings-view.js`, `app/views/home-view.js` chip/close buttons.
  - **Rule:** every `<button>` whose visible content is an emoji/glyph/SVG needs an
    `aria-label`; decorative glyphs inside a labeled control get `aria-hidden`.
3. **A blanket reduced-motion safety net.** The 11 targeted blocks cover known
   animations, but new `transition:`/`animation:` declarations are added
   piecemeal. Add ONE global catch-all (additive, last in the cascade) so any
   *future* animation is also neutralized:
   ```css
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after {
       animation-duration: 0.001ms !important;
       animation-iteration-count: 1 !important;
       transition-duration: 0.001ms !important;
       scroll-behavior: auto !important;
     }
   }
   ```
   (Keep the existing targeted blocks — they encode intent; this is the backstop.)
   Verify it does not break any *functional* transition (e.g. an element that
   relies on `transitionend` — grep `transitionend` first; if found, exempt it).
4. **Focus order + visible ring** — verify the skip-link → header → tab-bar →
   main order, and that the ring is visible on dark surfaces (the accent ring at
   2px may be low-contrast on `--accent` backgrounds; add `outline-offset` /
   a contrasting `box-shadow` ring where the control's own background is the
   accent color — e.g. `.tab.is-active`, `.pick-btn.is-picked`).
5. **Color contrast** — spot-check `.muted` text (the most-used low-emphasis
   token) against its background ≥ 4.5:1 for body / 3:1 for ≥18px. Bump the
   `--muted`/`.muted` token only if it fails (single-token change, global effect,
   low risk). Document the measured ratios.
6. **`html lang` + skip-link target** — confirm `#view` exists and is focusable
   (it is, `tabindex="-1"`); add nothing unless missing.
7. **Tap targets ≥44px** — the structural spec measures every interactive
   element's rendered box on the 390×844 viewport and flags any < 44×44 that is
   not inside an already-large hit area.

## C-2 User stories + acceptance criteria

### Story C2-S1 — Reduced-motion users get a still UI everywhere
*As a user with "Reduce Motion" on (iOS Settings → Accessibility → Motion), I want
no animations, parallax, confetti, sparkline motion, or auto-transitions anywhere.*

- **AC1**
  - **Given** the page is loaded with `prefers-reduced-motion: reduce` emulated
  - **When** any view renders (home, matchup, play, bracket, pools)
  - **Then** every element's computed `animation-duration` and
    `transition-duration` is ≤ 1ms (the catch-all backstop), AND
- **AC2** confetti `showConfetti()` is a no-op (already true — lock with a test).
- **AC3** the live win-prob bar has `data-reduced-motion="true"` and its segments
  have `transition: none` (already true — lock with a test).
- **AC4** no functional regression: the existing targeted reduced-motion blocks
  and any `transitionend`-dependent flow still work (no element stuck hidden).

### Story C2-S2 — Every interactive control is named + reachable
*As a screen-reader / keyboard user, every button/link/tab has an accessible name,
a visible focus ring, and a ≥44px tap target.*

- **AC5 (accessible names)**
  - **Given** any route renders
  - **Then** **no** `<button>`, `<a href>`, `[role=button]`, or `[role=tab]` has an
    empty accessible name (text content OR `aria-label` OR `aria-labelledby` must
    be non-empty), measured by the structural spec across all primary routes.
- **AC6 (visible focus)**
  - **Given** keyboard focus moves to any interactive control
  - **Then** `getComputedStyle(':focus-visible')` yields a non-`none` outline (or a
    box-shadow ring) with ≥2px width, AND on accent-background controls the ring is
    visually distinct (offset ≥2px).
- **AC7 (tap targets)**
  - **Given** the 390×844 iPhone viewport
  - **Then** every visible interactive control's bounding box is ≥44×44px (or its
    parent hit area is), with documented exceptions (inline text links inside a
    sentence).
- **AC8 (focus order + skip-link)**
  - **Given** a fresh load and pressing Tab once
  - **Then** the **first** focused element is the skip-link, and activating it
    moves focus to `#view`.
- **AC9 (lang + landmarks)**
  - **Then** `document.documentElement.lang === 'en'` and exactly one
    `role="main"`, one `role="banner"`, one `role="contentinfo"` exist.

### Story C2-S3 — Contrast meets WCAG AA for body text
- **AC10**
  - **Given** the default (dark) theme
  - **Then** `.muted` body text contrast vs its background ≥ 4.5:1 (or ≥3:1 if its
    used size ≥18.66px bold / 24px regular), measured and documented. Adjust the
    `--muted` token only if it fails.

## C-2 Tasks (exact files / functions)

- **`app/styles.css`** — append (after the existing reduced-motion blocks, near
  line 2350 group or at end of file with a clear comment) the **global
  reduced-motion backstop** from gap #3. Add/adjust accent-background focus rings
  for `.tab.is-active:focus-visible`, `.pick-btn.is-picked:focus-visible`
  (box-shadow ring so the outline isn't lost against the accent fill). If contrast
  audit fails, bump `--muted` (single var). **No structural/visual change beyond
  these — additive.**
- **Icon-button label sweep** (grep-driven, see QA below). Add `aria-label` to any
  glyph-only `<button>` found without one. Likely touch points (verify each):
  `app/components/watchlist-star.js`, `app/components/status-pill.js`,
  `app/components/tooltip.js`, `app/views/home-view.js`,
  `app/views/settings-view.js`, `app/views/matchup-detail.js`,
  `app/components/parlay.js`. Decorative inner glyphs → `aria-hidden="true"`.
- **`index.html`** — already compliant; only edit if the sweep finds the header/
  footer controls regressed (they are not, per the read).
- **No JS behavior change** to confetti/win-prob/sparkline — they already gate;
  the work is to **lock** them with tests.

## C-2 QA — concrete test scripts

> **axe-core limitation (state it explicitly):** axe-core is **not** a project
> dependency and the $0/no-build constraint means we will **not** add it. Instead
> we assert **structural** a11y directly via the DOM in Playwright (roles, accessible
> names, `tabindex`, computed `outline`, bounding-box sizes, computed
> `animation/transition-duration`). This catches the regressions that matter for
> this codebase (missing labels, lost focus rings, ungated motion, under-sized tap
> targets) without a new dependency. True semantic/ARIA-tree validation (e.g.
> name-from-content edge cases) is out of scope and noted as a manual VoiceOver
> pass in the smoke checklist.

### `tests/ux/rj30_1-a11y-structure.spec.mjs` (Playwright — primary, in the maintained glob)
Mirrors the maintained UX specs (390×844, mobile-chromium, NOT a `qa-*` audit file
so it runs in CI). Walks the primary routes and asserts structure.

```js
import { test, expect } from '@playwright/test';

const ROUTES = ['/', '/#/schedule', '/#/play', '/#/bracket', '/#/pools',
  '/#/matchup/team_a/Mexico/team_b/Korea%20Republic'];

test('html lang + single landmarks', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  expect(await page.locator('[role="main"]').count()).toBe(1);
  expect(await page.locator('[role="banner"]').count()).toBe(1);
  expect(await page.locator('[role="contentinfo"]').count()).toBe(1);
});

test('skip-link is the first focusable element and targets #view', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Tab');
  const info = await page.evaluate(() => {
    const a = document.activeElement;
    return { cls: a?.className || '', href: a?.getAttribute?.('href') || '' };
  });
  expect(info.cls).toContain('skip-link');
  expect(info.href).toBe('#view');
  expect(await page.locator('#view').count()).toBe(1);
});

for (const route of ROUTES) {
  test(`every interactive control has an accessible name @ ${route}`, async ({ page }) => {
    await page.goto(route === '/' ? '/' : route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500); // let the view paint
    const unnamed = await page.evaluate(() => {
      const sels = 'button, a[href], [role="button"], [role="tab"], [role="link"], [role="menuitem"]';
      const bad = [];
      for (const el of document.querySelectorAll(sels)) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;        // not rendered
        const name = (el.getAttribute('aria-label')
          || el.getAttribute('aria-labelledby')
          || el.textContent || '').trim();
        if (!name) bad.push(el.tagName + '.' + (el.className || '').toString().slice(0, 40));
      }
      return bad;
    });
    expect(unnamed, `unnamed controls: ${unnamed.join(', ')}`).toEqual([]);
  });

  test(`tap targets >= 44px @ ${route}`, async ({ page }) => {
    await page.goto(route === '/' ? '/' : route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const small = await page.evaluate(() => {
      const sels = 'button, a[href], [role="button"], [role="tab"]';
      const bad = [];
      for (const el of document.querySelectorAll(sels)) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
        // skip inline text links inside a paragraph (documented exception)
        if (el.tagName === 'A' && el.closest('p')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.width < 44 || r.height < 44) bad.push(`${el.getAttribute('aria-label') || el.textContent?.trim()?.slice(0,20)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return bad;
    });
    expect(small, `under-44 controls: ${small.join(' | ')}`).toEqual([]);
  });
}

test('focus-visible yields a non-none outline on a tab', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.querySelector('[role="tab"]')?.focus());
  const outline = await page.evaluate(() => {
    const el = document.querySelector('[role="tab"]:focus') || document.activeElement;
    const cs = getComputedStyle(el);
    return { width: cs.outlineWidth, style: cs.outlineStyle, shadow: cs.boxShadow };
  });
  // either an outline >=2px or a box-shadow ring
  const okOutline = parseFloat(outline.width) >= 2 && outline.style !== 'none';
  expect(okOutline || (outline.shadow && outline.shadow !== 'none')).toBeTruthy();
});
```

> **Note for the build:** if the unnamed/tap-target assertions surface pre-existing
> violations on a route, fix the violation (add the label / bump the size) — that
> is exactly the C-2 work. The spec is the definition of done.

### `tests/ux/rj30_1-reduced-motion.spec.mjs` (Playwright — reduced motion)
Uses Playwright's `prefers-reduced-motion` emulation (no code change to enable).

```js
import { test, expect } from '@playwright/test';
test.use({ reducedMotion: 'reduce' });

test('global backstop: animated elements have ~0 duration', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const offenders = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const ad = parseFloat(cs.animationDuration) || 0;
      const td = parseFloat(cs.transitionDuration) || 0;
      // animationDuration/transitionDuration in seconds; allow <= 0.002s
      if (ad > 0.002 || td > 0.002) bad.push(el.className?.toString().slice(0,40) || el.tagName);
    }
    return [...new Set(bad)].slice(0, 10);
  });
  expect(offenders, `still-animated: ${offenders.join(', ')}`).toEqual([]);
});

test('confetti is a no-op under reduced motion', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const made = await page.evaluate(async () => {
    const { showConfetti } = await import('/app/confetti.js');
    showConfetti();
    return document.querySelectorAll('.wc-confetti').length;
  });
  expect(made).toBe(0);
});
```

### `tests/feature/rj30_1-reduced-motion-unit.test.mjs` (node:test — gate logic, no DOM)
- Lock the confetti guard's contract via source assertion (jsdom-free): read
  `app/confetti.js`, assert it references `prefers-reduced-motion: reduce` and an
  early `return`. Cheap regression tripwire if someone removes the guard.
- Read `app/styles.css`, assert the global backstop block exists
  (`*, *::before, *::after` inside a `prefers-reduced-motion: reduce` media) so the
  CSS safety net can't be deleted silently.

### `tests/feature/rj30_1-a11y-static.test.mjs` (node:test — static markup contract)
- Read `index.html`; assert `lang="en"`, `class="skip-link"` present with
  `href="#view"`, `role="banner"`, `role="main"`, `role="contentinfo"`,
  `id="view"`, and that the icon-only header buttons (`#back-btn`, `#settings-btn`,
  `#auth-toolbar-btn`) each carry a non-empty `aria-label`. Locks the shell.

### Manual smoke (post-build, documented in `tests/smoke.sh` checklist comment)
- VoiceOver pass on iOS Safari: tab through home → matchup, confirm each control
  is announced with a meaningful name (the structural spec can't verify *quality*
  of names, only presence). One-time manual handoff.
- Toggle iOS Reduce Motion ON, open a live match → confirm no confetti / no
  sparkline motion / no bar slide.

## C-2 Edge cases (checklist)
- `transitionend`-dependent flows — grep `transitionend` before adding the
  backstop; if any exist, the `0.001ms` duration still fires the event (chosen over
  `0ms` precisely so listeners don't hang). Document this rationale in the CSS
  comment.
- Controls that are intentionally tiny (e.g. a dense legend swatch) — if any are
  interactive and < 44px by design, wrap the hit area or add the documented
  exception in the spec, don't shrink the assertion blindly.
- Accent-on-accent focus ring (gap #4) — verify the ring on `.tab.is-active` and
  `.pick-btn.is-picked` is visible (box-shadow ring, not just outline).
- The structural spec must wait for async paint (team-color banner, live sections
  import asynchronously in `matchup-detail.js`) — `waitForTimeout(500)` / a
  visible-selector wait before measuring.
- Do not flag `aria-hidden` decorative glyphs as "unnamed buttons" — the selector
  targets the **button**, whose label comes from `aria-label`; the inner glyph
  being `aria-hidden` is correct.

## C-2 iOS / UX notes
- All assertions run at 390×844 (the project's iPhone profile) so tap-target /
  focus findings are iOS-accurate.
- Reduced motion is a real iOS setting (Accessibility → Motion); the backstop +
  existing guards mean Reduce-Motion users get a fully static UI — important for
  vestibular-sensitivity and battery.
- Focus rings must read on the **dark** default theme — the accent ring is fine on
  neutral surfaces but needs offset/box-shadow on accent fills (the one real
  visual tweak; keep it subtle, brand-consistent).
- No layout shift: every change is a label attribute, a CSS backstop, or a
  ring/contrast token — none reflow the page.

## C-2 Files touched / new
- **Edit:** `app/styles.css` (global reduced-motion backstop; accent-bg focus
  rings; optional `--muted` contrast bump).
- **Edit (label sweep, only files with bare-glyph buttons):**
  `app/components/watchlist-star.js`, `app/components/status-pill.js`,
  `app/components/tooltip.js`, `app/views/home-view.js`,
  `app/views/settings-view.js`, `app/views/matchup-detail.js`,
  `app/components/parlay.js` (verify each; touch only those that fail the sweep).
- **Edit (maybe):** `index.html` (only if a shell control regressed — currently OK).
- **New (tests):** `tests/ux/rj30_1-a11y-structure.spec.mjs`,
  `tests/ux/rj30_1-reduced-motion.spec.mjs`,
  `tests/feature/rj30_1-reduced-motion-unit.test.mjs`,
  `tests/feature/rj30_1-a11y-static.test.mjs`.

---

# Partitioning (for the build / concurrency rule)

Two **disjoint** partitions → 2 parallel agents max (CLAUDE.md: concurrency =
independent partitions, not headcount):

| Partition | Owns (write) | Shared/read-only |
|---|---|---|
| **P1 — OG match cards (C-1)** | `netlify/functions/match-card.mjs`, `netlify.toml`, `app/share-match.js`, `tests/feature/rj30_1-match-og*.test.mjs`, `tests/feature/rj30_1-match-share-url.test.mjs` | reads `app/views/matchup-detail.js#resolveMatch`, `data/*.json` |
| **P2 — A11y / reduced-motion (C-2)** | `app/styles.css`, the icon-button label edits, `tests/ux/rj30_1-a11y-*.spec.mjs`, `tests/ux/rj30_1-reduced-motion.spec.mjs`, `tests/feature/rj30_1-a11y-static.test.mjs`, `tests/feature/rj30_1-reduced-motion-unit.test.mjs` | reads `index.html`, components |

**Collision risk:** both want to edit `app/views/matchup-detail.js` — P1 for the
Share button (AC9), P2 for the watchlist-star label sweep. Resolve by: P2 owns the
file's a11y edits; P1's Share button is **deferred to a final integration step**
after both land (or P1 hands its 3-line button diff to P2). Keeps file ownership
disjoint during parallel work.

# Regression gate (run before any deploy — must be 100% green)
```
python3 scripts/validate_data.py
bash tests/smoke.sh
node --test tests/feature/*.mjs tests/competition.test.mjs
npx playwright test --config tests/playwright.config.mjs tests/ux tests/integrated
```
New specs land in `tests/feature/` and `tests/ux/` so they're picked up by the
existing globs (the new UX specs are NOT named `qa-*`, so they run in CI).

# Rollback (state before deploy — Gate 4)
- C-1: revert the `netlify.toml` `/m/*` redirect (one block) — the function becomes
  unreachable, app behavior unchanged; or `git revert` the commit.
- C-2: `git revert` — all changes are additive (one CSS block + label attrs);
  reverting restores prior markup with zero data/behavior impact.
