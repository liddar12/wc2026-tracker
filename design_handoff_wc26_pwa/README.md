# Handoff: WC26 Tracker — "The Goal" Navigation & PWA Shell

## Overview
WC26 Tracker is a Progressive Web App for the 2026 World Cup: matchup-level predictions, a knockout
bracket, prediction pools, and a leaderboard, installable to the iOS Home Screen and used on desktop.
This package documents the **"The Goal"** navigation system and app shell: the menu button is a goal
frame; tapping it turns the screen into a pitch where navigation lines up in front of the net.

This handoff covers two things:
1. **The design** — every screen, component, token, interaction, and state in the prototype.
2. **A parity audit** vs. the current live site (`worldcup2026.j5lagenticstrategy.com`, build `v5-kalshi`),
   mapping live features to the design, flagging gaps, and recommending what to add. See
   **`PARITY_AUDIT.md`**.

## About the design files
The files in `design_files/` are **design references built in HTML/CSS/vanilla JS** — a working
prototype showing intended look and behavior. They are **not** production code to ship verbatim.
The task is to **recreate these designs in the target codebase (`liddar12`)** using its established
framework, component library, routing, and data layer. If a given screen/state already exists in
`liddar12`, restyle it to match these tokens and the "The Goal" nav rather than rebuilding it.

The prototype is framework-agnostic on purpose: the entire nav is driven by a `body.menu-open`
class and `data-go="<route>"` attributes, so it ports cleanly to React/Vue/Svelte/etc.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii, motion, and interaction behavior are
all specified below and exact in the files. Recreate pixel-for-pixel using the codebase's primitives.

---

## Design tokens

### Color
| Token | Hex / value | Use |
|---|---|---|
| `--ink` | `#0D1117` | App base, theme-color, status bar |
| `--ink2` | `#11161E` | Card surfaces |
| `--ink3` | `#161C26` | Inset chips / avatars |
| `--ink4` | `#1C2430` | Deepest inset |
| `--pitch-deep` | `#0A5C32` | Pitch shadow / gradient end, ball panels |
| `--pitch` | `#108A4A` | Grass base / feature gradient |
| `--pitch-lt` | `#16A35A` | Grass highlight / gradient start |
| `--lime` | `#39D479` | **Accent**: active nav, CTAs, highlights |
| `--lime-2` | `#2BD46B` | Alt accent |
| `--lime-soft` | `rgba(57,212,121,.14)` | Active row tint, pick pills |
| `--lime-ink` | `#06351C` | Text/icon ON lime fills |
| `--chalk` | `#FFFFFF` | Pitch line markings, ball disc |
| `--line` | `rgba(255,255,255,.08)` | Hairline borders |
| `--line2` | `rgba(255,255,255,.14)` | Stronger dividers |
| `--tx` | `#E8EDF4` | Primary text |
| `--tx-dim` | `#9AA7B8` | Secondary text |
| `--tx-faint` | `#5B6573` | Tertiary / meta |
| `--red` | `#FF5A5A` | Live indicator, badges, destructive |

### Type
System stack only, **two weights — 400 & 700** (no web fonts):
`-apple-system, BlinkMacSystemFont, 'SF Pro Text','SF Pro Display','Segoe UI', system-ui, Roboto, sans-serif`
Monospace (scores/meta/labels): `'SF Mono', ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace`

Scale (px / weight / line-height / tracking):
- Page H1 `30/700/1.05/-1` (mobile) → `38` (desktop)
- Section H2 `19/700/1/-0.3`
- Card title / nav item `17/700`
- Body `14/400/1.5`
- Eyebrow & mono labels `10–12/700`, letter-spacing `1–3px`, uppercase
- Score (feature) `34/700`, tracking `1`

### Spacing, radius, shadow, layout
- Radii: cards `16px` (`--r`), feature/large `22px` (`--r-lg`), buttons `11–12px`, chips `30px`, FAB/goal button `16px`.
- Page gutter: `16px` mobile / `28px` desktop. Content max-width: `760px` (reading) / `1080px` (home grid).
- Bars: top bar `56px` mobile / `64px` desktop; bottom tab bar `64px`. Both add `env(safe-area-inset-*)`.
- Breakpoint: **`900px`** (below = mobile w/ tab bar; above = desktop w/ inline nav, no tab bar).
- Elevation is mostly flat; only the bottom-bar goal FAB and overlays use shadow
  (`0 8px 22px rgba(57,212,121,.4)` for the lime FAB; `0 14px 40px rgba(0,0,0,.5)` for sheets/toasts).

---

## Screenshots
Reference captures (desktop width) live in `screenshots/`:
`01-home.png · 02-matches.png · 03-bracket.png · 04-my-picks.png · 05-leaderboard.png ·
06-profile.png · 07-goal-menu.png` (the full-screen "The Goal" navigation overlay).

## Screens / Views

> Routes in the prototype: `home, matches, bracket, picks, leaderboard, profile`.
> **Note:** the live site has more destinations — see `PARITY_AUDIT.md` for the full target map.

### 1. Home (`#home`)
- **Purpose:** glanceable "today" hub — live match, your picks due, group standing.
- **Layout:** page header (eyebrow + H1 greeting + status line). Desktop: two-column grid
  `1.4fr / 1fr` (left = live + picks, right = standings + leaderboard CTA), `18px` gap. Mobile: stacked.
- **Components:**
  - **Feature card** — `--r-lg`, gradient `135deg, --pitch → --pitch-deep`, faint vertical "mowed
    stripes" overlay (`repeating-linear-gradient 30px`). Contains: `LIVE · Group A` tag (red blinking
    dot), score line (two `team` columns w/ 48px crest tiles + score `34/700` + venue meta), and a
    full-width lime CTA "Watch & predict next goal".
  - **Picks list** (`card`): up to 4 `matchrow`s.
  - **Standings** (`card`): `standtbl` — qualifying rows get a lime left-edge marker and white text.
  - Ghost CTA "Open leaderboard".

### 2. Matches (`#matches`)
- **Purpose:** browse all fixtures, filter, tap to predict.
- **Layout:** page header + horizontal scroll **chips** (`All · Live · Today · Group stage · Knockout`,
  active = lime) + a `card` of `matchrow`s.
- **`matchrow` anatomy:** 26px code tile · "TEAM v TEAM" names · optional pick pill · right meta
  (kickoff time `mono` + day) OR live pill (`● 67'`, red). Hover tint `rgba(255,255,255,.025)`.

### 3. Bracket (`#bracket`)
- **Purpose:** view/predict the knockout stage.
- **Layout:** page header + horizontal-scroll **bracket**: 4 columns (`Round of 16 · QF · SF · Final`),
  each `150px`, ties vertically distributed. **`btie`**: two `bteam` rows; winner white + lime score,
  loser faint. Tapping a tie sets a prediction.

### 4. My Picks (`#picks`)
- **Purpose:** your predictions + points.
- **Layout:** page header + 3-up **stat grid** (Points / Correct / Rank) + section + `card` of pick rows
  (match + "Pick: X" pill + points earned).

### 5. Leaderboard (`#leaderboard`)
- **Purpose:** ranking within a pool.
- **Layout:** page header + scope chips (`My group · Friends · Global`) + `card` of `leadrow`s
  (rank · avatar · name/group · points). Top-3 ranks lime; the current user row tinted `--lime-soft`.

### 6. Profile (`#profile`)
- **Purpose:** account, groups, settings.
- **Layout:** page header + identity row (60px gradient avatar) + 3-up stat grid + `setlist` `card`
  of `setrow`s (icon tile · label · chevron).

### Chrome (present on every screen)
- **Top bar** — fixed, blurred `rgba(13,17,23,.86)`, hairline bottom, faint stripe overlay. Left:
  brand (ball logo + WC26/TRACKER). Desktop adds inline nav + bell + "Make picks" pill. Right: bell
  (red dot) + **goal icon** button (opens menu).
- **Bottom tab bar** (mobile only) — `Home · Matches · [Goal] · Bracket · Picks`. Center is a raised
  lime goal FAB ("Menu"). Dashed chalk line across the top edge (the goal line).
- **The Goal menu** (overlay) — see Interactions.
- **Install toast** + **iOS install sheet** — see Interactions.

---

## Interactions & behavior

- **The Goal menu (hero interaction).** Triggered by the top-bar goal icon (`#openMenu`) or the
  center tab FAB (`#openMenuTab`). Adds `body.menu-open`. Overlay: full-bleed pitch gradient +
  stripe overlay; a goal+net SVG at top; `LINE-UP` label + circular close button; a vertical list of
  **nav chips** (icon tile · title · subtitle · chevron) that stagger in (`translateY(16px)→0`,
  `transition-delay 0.06 + i*0.05s`); a soccer-ball button at the bottom ("TAP THE BALL TO CLOSE").
  Active route chip = lime. Selecting a chip routes then closes after ~220ms. Esc closes. Opening
  locks body scroll. Reduced-motion: items appear without travel.
  - Timings: overlay fade `.34s`; chips `.42s cubic-bezier(.2,.8,.2,1)`; ball pop
    `.5s cubic-bezier(.2,1.4,.4,1)`; close button rotates 90° on press.
- **Routing.** `go(route)` toggles `.screen.active`, lazy-builds the screen on first visit, syncs the
  active state across tab bar / desktop nav / menu chips, writes `#route` to the URL, persists to
  `localStorage('wc26.screen')`, and resets scroll. `popstate` (back/forward) is handled. Entrance:
  `fade .26s` (from `opacity:0; translateY(6px)`).
- **Desktop nav & tab bar** route via the same `data-go` delegation.
- **Install flow.** Captures `beforeinstallprompt` (Android/Chrome) → shows install toast after
  ~1.6s (unless dismissed/standalone). "Install" calls the native prompt. iOS (no event) → toast
  routes to a guided **"Add to Home Screen"** bottom sheet (Share → Add to Home Screen → Add).
  "Later" persists `localStorage('wc26.install'='no')`.
- **Service worker.** Network-first for navigations (offline → cached `index.html`), cache-first for
  assets. Bump `CACHE` to invalidate.

---

## States, failover & graceful errors

> The prototype renders the **happy path** with sample data. Production must implement these states
> for every data-backed screen. This is the contract Claude Code should build to.

| State | Pattern to implement |
|---|---|
| **Loading** | Skeleton placeholders matching final layout: shimmering `matchrow`/`leadrow`/`standtbl` rows and a feature-card skeleton. No layout shift on resolve. The live shell currently shows a bare "Loading data…" — replace with skeletons. |
| **Empty** | Friendly zero-states per screen: *Matches* "No fixtures for this filter"; *My Picks* "You haven't made any picks yet → Make picks"; *Leaderboard* "Join or create a pool"; *Bracket* "Knockouts unlock after the group stage". Each with a single primary action. |
| **Error** | Inline error card with cause + **Retry** for screen-level fetch failures; non-blocking **toast** for action failures (pick didn't save, etc.) with Retry. Never a blank screen. |
| **Offline** | SW serves the cached shell; show a persistent offline banner ("Showing last synced data"); disable/queue write actions (pick submission) and flush on reconnect. |
| **Auth-gated** | `My Picks`, `My Brackets`, `Pools`, `Play` require sign-in → show a sign-in prompt screen (not a redirect dead-end). Signed-out top bar shows "Sign in". |
| **Live data** | Scores/standings poll or stream; reconnect with backoff; show a subtle "updated" pulse; degrade to last-known value with a timestamp on failure. |
| **Form/pick validation** | Disable submit until valid; show inline rules (e.g., lock picks at kickoff); optimistic update with rollback on error. |
| **Lightboxes/modals** | Match detail, pick entry, bracket-tie editor, share-bracket, auth, settings, venue detail — each needs open/close, focus trap, Esc/scrim dismiss, and a loading/error state of its own. (Exact inventory pending source audit — see `PARITY_AUDIT.md`.) |

---

## State management
- `currentRoute` (string) — drives `.screen.active` and all active indicators; mirrored to URL hash + `localStorage`.
- `menuOpen` (bool) — `body.menu-open`.
- `installDeferred` / `installDismissed` — install flow.
- Per-screen data + `status: idle|loading|success|empty|error` + `lastUpdated` — wire to `liddar12`'s data layer.
- Auth/session — gates the protected routes above.

## Assets
- **Logo:** soccer-ball mark (white disc, `--pitch-deep` panels) — generated geometrically (`ui.js → ball()`); no external image. Pairs with "WC26 / TRACKER" wordmark.
- **Goal icon:** geometric (`ui.js → goalIcon()`), doubles as the menu/hamburger.
- **Nav/UI icons:** inline stroke SVGs in `ui.js` (`home, field, bracket, picks, trophy, user, bell, search, chev, close, share, plus, flag, clock`). `currentColor`, 2px stroke.
- **App icons (PNG, in `design_files/icons/`):** `icon-512`, `icon-192`, `maskable-512` (extra safe-zone), `apple-touch-icon` (180), `favicon-32/16`.
- **iOS splash (`design_files/splash/`):** `1290x2796`, `1179x2556` (add more device sizes for full coverage).
- All marks are **original & geometric** — no FIFA IP, no real crests. Keep it that way.

## Files
```
design_files/
├── index.html            # entry + all PWA / iOS meta
├── styles.css            # design system + app shell + The Goal menu (source of truth for tokens)
├── ui.js                 # SVG marks + icon set
├── screens.js            # the 6 screens (sample data — replace with liddar12 data layer)
├── app.js                # routing, menu, tab bar, install flow, SW registration
├── manifest.webmanifest
├── sw.js                 # offline app-shell cache
├── icons/ , splash/
└── README.md             # run/deploy + adoption notes
PARITY_AUDIT.md           # live-site → design mapping, gaps, recommendations, 1:1 checklist
```
```
```
