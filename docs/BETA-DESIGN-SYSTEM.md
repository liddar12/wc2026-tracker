# Beta Soccer Theme — design system

Ported from `design_handoff_wc26_pwa` ("The Goal"). Beta is a **dark pitch**
aesthetic with a **lime** accent. All values below are applied scoped to
`html[data-theme='beta']` so Light/Dark are untouched.

## Palette (handoff → Beta tokens)

| Handoff token | Value | Role |
|---|---|---|
| `--ink` | `#0D1117` | app background (== app's existing dark `--bg`) |
| `--ink2` | `#11161e` | surface / cards |
| `--ink3` | `#161c26` | surface-2 / insets |
| `--ink4` | `#1c2430` | raised insets |
| `--pitch-deep` | `#0A5C32` | feature gradient end |
| `--pitch` | `#108A4A` | feature gradient mid |
| `--pitch-lt` | `#16A35A` | feature gradient start / avatar |
| `--lime` | `#39D479` | **primary + accent** (CTAs, active nav, links) |
| `--lime-ink` | `#06351c` | ink-on-lime (button text) |
| `--lime-soft` | `rgba(57,212,121,.14)` | tinted "me"/active backgrounds |
| `--tx` | `#E8EDF4` | text |
| `--tx-dim` | `#9AA7B8` | muted text |
| `--tx-faint` | `#5B6573` | faint text |
| `--line` | `rgba(255,255,255,.08)` | borders |
| `--red` | `#FF5A5A` | live/bad |

### Semantic token re-bind (the whole-app re-skin)

```
--bg            → var(--ink)
--surface       → var(--ink2)
--surface-2     → var(--ink3)
--text          → var(--tx)
--text-muted    → var(--tx-dim)
--border        → var(--line)
--primary       → var(--lime)
--primary-ink   → var(--lime-ink)
--accent        → var(--lime)
--accent-strong → var(--lime-2)
--good          → var(--lime)
--warn          → #E0B75D
--bad           → var(--red)
--picked        → var(--lime)
--picked-ink    → var(--lime-ink)
--shadow        → 0 10px 30px rgba(0,0,0,.5)
```

These re-bind both the base `:root` and the active `[data-redesign="v2"]` wc-*
tokens (`--wc-bg`, `--wc-surface`, `--wc-ink`, `--wc-teal-700`→lime, etc.) so v2
component rules pick up Beta automatically.

## Typography

- Body/headings: system sans (`-apple-system, 'SF Pro', system-ui …`) — matches
  the handoff; the app's Barlow stays unless overridden. Beta keeps the app's
  display/body fonts but applies the handoff **weights** (700 bold, 800 display).
- **Numbers** (scores, points, odds, ranks, countdown): mono tabular —
  `--mono: 'SF Mono', ui-monospace, Menlo, monospace`, `font-variant-numeric:
  tabular-nums`. Prevents layout shift, matches the handoff's scoreboard feel.

## Signature components (Layer 2, scoped to `[data-theme='beta']`)

1. **The Goal menu** (`.goalmenu`, `body.menu-open`, `.navchip`, ball button):
   full-screen pitch overlay; nav chips animate up in sequence; active chip is
   lime. Ported verbatim CSS; markup + routing in `beta-nav.js`.
2. **Goal-FAB** (`.beta-goal-fab`): fixed center, overlaps the tab bar, lime
   rounded-square with the goal-frame SVG; opens The Goal menu. Tab-bar gets the
   Beta blur + dotted goal-line motif.
3. **Pitch hero/feature**: `.home-hero`, `.lcard-banner`, `.feature` get the
   `linear-gradient(135deg,var(--pitch),var(--pitch-deep))` + repeating
   grass-stripe overlay; eyebrow + links in lime mono.
4. **Lime CTAs**: `.pick-btn`, `.home-card-cta`, `.cta`, `.link-btn`,
   `.pw-submit-btn` → lime bg, `--lime-ink` text, press-scale.
5. **Tables/standings**: qualified rows get a lime left-marker; numbers mono;
   "me"/top rows tinted `--lime-soft`.
6. **Chips/pills**: active/on chips lime; live pills red; default chips inked.

## The Goal navigation — spec

- Trigger: goal-FAB (bottom-center) + optional header goal icon.
- Overlay: `.goalmenu` with pitch field gradient + stripe overlay; top label
  "THE GOAL"; close (×) button; vertical scrolling `.navlist` of `.navchip`s;
  footer ball button (also closes).
- Nav chips (route → label → sublabel), active chip reflects current route:
  - Home `home` · "Today's matches & your standings"
  - Matches `matches` · "Fixtures, predictions, live"
  - Play `play` · "Make your picks"
  - Bracket `bracket` · "Knockout projections"
  - My Picks `my-picks` · "Your predictions & points"
  - Pools `pools` · "Leagues with friends"
  - My Brackets `my-brackets` · "Your knockout bracket"
  - Golden Boot `golden-boot` · "Top-scorer race & odds"
  - Schedule `schedule` · "Full match calendar"
  - Leaderboard `leaderboard` · "Global accuracy board"
  - Venues `venues` · "Stadiums & host cities"
  - Settings `settings` · "Account, theme & prefs"
- Behavior: open → `body.menu-open` (+ scroll lock); chip click → `setRoute(route)`
  + close; close via ×, ball, or Escape. Active only when `data-theme='beta'`;
  fully removed when the theme changes away from Beta.
- A11y: overlay `role="dialog" aria-modal="true"`; FAB `aria-label="Open The Goal
  menu"`; chips are real `<button>`s; Escape closes; focus moves into the menu on
  open and back to the FAB on close; respects `prefers-reduced-motion`.
