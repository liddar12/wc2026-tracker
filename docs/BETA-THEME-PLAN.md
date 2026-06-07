# Beta Soccer Theme — plan, parity audit, gap list

**Goal:** Add a 4th selectable theme **"Beta"** (Settings → Theme: Match system /
Light / Dark / **Beta**) that adopts the `design_handoff_wc26_pwa` **"The Goal"**
design language — dark pitch base, lime accent, pitch greens, mono scores — and
its **full-screen "The Goal" navigation**, across the whole app.

**Constraints (standing):** 100% automated. **Preview only** — does NOT go to the
live site until the user smoke-tests from their device. Light/Dark must be
completely unaffected (Beta is purely additive + scoped).

## Architecture — two layers

The current app is **fully token-driven**: every component (~600 selectors, 23
routes, 524 distinct classes) consumes semantic CSS custom properties (`--bg`,
`--surface`, `--surface-2`, `--text`, `--text-muted`, `--border`, `--primary`,
`--primary-ink`, `--accent`, `--shadow`, `--good/--warn/--bad`, radii, spacing,
motion). The active palette is the `[data-redesign="v2"]` layer on `<html>`.

- **Layer 1 — token re-bind (whole-app re-skin).** A `[data-theme='beta']` block
  (compounded with `[data-redesign="v2"]` to win specificity over v2) re-binds the
  semantic tokens to the handoff palette. This restyles **every page and component
  at once** — surfaces, text, borders, primary/accent, shadows — with **zero**
  changes to the ~600 component selectors. This is how Beta reaches 100% coverage
  safely. (The handoff's `--ink #0D1117` already equals the app's dark `--bg`.)
- **Layer 2 — signature components + The Goal nav (Beta-only, scoped).** New CSS
  + JS, all gated under `[data-theme='beta']`:
  1. **The Goal full-screen pitch menu** (`.goalmenu` / `body.menu-open` /
     `.navchip` / ball button) — the headline navigation, ported from the handoff
     and wired to the real router (`setRoute`).
  2. **Goal-FAB** trigger (center, overlapping the tab bar) + Beta tab-bar styling.
  3. **Pitch feature/hero** treatment (grass-stripe gradient) on hero surfaces.
  4. **Lime CTAs**, **mono tabular numbers** for scores/points/odds, lime
     "qualified" markers on tables.

## Theme wiring (4 touch-points)

1. `app/theme.js` — `effective()` returns `'beta'` for the `beta` pref (so it is
   not resolved to light/dark); `apply()` sets `html[data-theme='beta']`.
2. `app/views/settings-view.js` — add `'beta'` to the picker array (`:110`), the
   label (`:113` → "Beta"), and an `applyTheme` branch (`:129`).
3. `app/styles.css` — append the Beta block (Layer 1 tokens + Layer 2 components +
   The Goal menu CSS).
4. `app/beta-nav.js` (new) + `app/main.js` — inject/activate The Goal menu + goal-FAB
   when `data-theme='beta'`; remove them otherwise.

## Parity audit (completed against source) + coverage

Handoff designed 7 screens: Home, Matches, Bracket, My Picks, Leaderboard,
Profile(≈Settings), Goal-menu(nav). The live app has **23 routes**. Because the
app is token-driven, **Layer 1 covers the color/surface theming of all 23
routes + all 524 classes automatically.** Layer 2 adds the signature character.

| Live route | Handoff design | Beta coverage |
|---|---|---|
| `#/` home | ✅ | L1 tokens + L2 pitch hero, lime CTAs, mono countdown |
| `#/matches` matchup-list | ✅ | L1 tokens + L2 matchrow/pill styling |
| `#/bracket` `#/brackets` | ✅ | L1 tokens + L2 bracket tie/slot lime-winner |
| `#/my-picks` `#/picks` | ✅ | L1 tokens + L2 stat cards, mono numbers |
| `#/leaderboard` | ✅ | L1 tokens + L2 leadrow "me"/top lime |
| `#/settings` | 🟡 (profile) | L1 tokens + L2 setrow + **Beta picker lives here** |
| `#/play` (pw-* funnel) | ❌ gap | L1 tokens + L2 chip/tile lime-ranked |
| `#/pools` | ❌ gap | L1 tokens + L2 pool-card/badge |
| `#/standings/id/<id>` | ❌ gap | L1 tokens + L2 standings rows, mono pts |
| `#/golden-boot` | ❌ gap | L1 tokens + L2 standings + factor cards |
| `#/my-brackets` | ❌ gap | L1 tokens + L2 bracket styling |
| `#/schedule` | ❌ gap | L1 tokens + L2 day-pill/schedule-card |
| `#/venues` `#/venue/...` | ❌ gap | L1 tokens + L2 venue-card/map |
| `#/team/...` | ❌ gap | L1 tokens + L2 pos-bars/roster |
| `#/group` `#/groups` | ❌ gap | L1 tokens + L2 standings table |
| `#/matchup/...` detail | ❌ gap | L1 tokens + L2 lcard/confidence bars |
| `#/create-group` | ❌ gap | L1 tokens + L2 wizard cards |
| `#/injuries` | ❌ gap | L1 tokens |
| `#/shared` | ❌ gap | L1 tokens |
| `#/hot-picks` | ❌ gap | L1 tokens + L2 mover chips |
| `#/backtest` | ❌ gap | L1 tokens + L2 bars |
| `#/winner` | ❌ gap | L1 tokens + L2 winner ladder |
| modals/overlays (auth, search, sheets, toast) | partial | L1 tokens + L2 surfaces |

**Gap-closure principle:** "design for each piece" is satisfied because every
class in the 524-class master list consumes semantic tokens; the Beta token layer
+ the documented component conventions (see `BETA-DESIGN-SYSTEM.md`) give each gap
page a Beta-consistent look without bespoke per-page design files. Pages with a
*hero/feature/score/table/chip* get the matching signature treatment; the rest
inherit the palette.

**Known caveat (logged, not silently dropped):** ~120 inline `style=` attributes
across views (heaviest: settings 30, my-picks 22, play 17) set layout one-offs
(margins, bar widths, `display:none`). These are layout, not color, so they do
**not** fight the token re-skin. Any that set a literal color would not re-theme;
the QA pass scans for inline color literals and the list is recorded in QA notes.

## Build phases

1. Docs (this + design system). ✅
2. Theme wiring (theme.js, settings-view.js).
3. Layer 1 token block in styles.css.
4. Layer 2 signature CSS + The Goal menu CSS.
5. `beta-nav.js` (The Goal menu + goal-FAB) + main.js init.
6. QA: feature guards + Playwright (select Beta → re-skin applies, nav works,
   Light/Dark unaffected, no console errors, a11y contrast). Iterate to green.
7. Push `beta-theme` branch → **deploy-preview** (NOT main).

## QA / test plan

- **Feature guards** (`tests/feature/beta-theme.test.mjs`): settings picker
  includes `beta`; `applyTheme` has a beta branch; `theme.js` handles beta;
  `styles.css` defines `[data-theme="beta"]` tokens + `.goalmenu`; `beta-nav.js`
  wires `setRoute` + toggles `menu-open`.
- **Playwright** (`tests/ux/beta-theme.spec.mjs`): in Settings, choose Beta →
  `html[data-theme="beta"]`; goal-FAB visible; open The Goal menu → a navchip
  click routes + closes the menu; switch back to Light → attribute cleared, nav
  removed; no console errors throughout.
- **Regression:** full existing suite stays green (Beta is additive/scoped).

## Deploy

`beta-theme` branch → Netlify deploy-preview. The user smoke-tests on device.
Promotion to `main`/live happens **only** on explicit user approval.
