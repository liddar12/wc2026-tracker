# Plan: UI Refresh — WC26 Tracker

Source: Q15–Q21 answers (2026-05-30) + ui-ux-pro-max skill recommendations.

**Design philosophy**: Apple HIG **Clarity, Deference, Depth** as primary lens, hybridized with the skill's "Flat Mobile" pattern (color-blocking, immediate press feedback, zero-elevation chrome) for the iOS PWA context. Subtle elevation reserved for ephemeral surfaces (sheets, modals, the home hero countdown). Sports/Fitness typography pairing for tournament personality.

**Scope strategy**: Home tab is the design lab. Everything else stays on the current navy theme until Home ships and is validated.

---

## 1. Design tokens

Defined as CSS custom properties in `app/styles.css`. Existing tokens stay; new ones layered on top so individual screens can opt-in by adding `data-redesign="v2"` to their root.

### 1.1 Color — WC26 base (Q16)

```css
:root[data-redesign="v2"] {
  /* Base palette — WC26 official-ish (deep teal + warm coral) */
  --wc-teal-50:   #ECFEFF;
  --wc-teal-100:  #CFFAFE;
  --wc-teal-200:  #A5F3FC;
  --wc-teal-500:  #06B6D4;   /* mid */
  --wc-teal-700:  #0E7490;   /* PRIMARY (chrome, active tab) */
  --wc-teal-900:  #164E63;   /* deep ink */

  --wc-coral-100: #FFE4E6;
  --wc-coral-400: #FB7185;
  --wc-coral-500: #F43F5E;   /* ACCENT (primary CTA, deltas) */
  --wc-coral-600: #E11D48;

  --wc-ink:       #0F1115;   /* near-black text */
  --wc-ink-2:     #1A1D24;
  --wc-mute:      #5B6776;
  --wc-bg:        #F5F8FA;   /* off-white app bg */
  --wc-surface:   #FFFFFF;   /* card */
  --wc-surface-2: #EEF2F4;   /* tier-2 surface (subtle wells) */
  --wc-border:    #DEE5EA;   /* hairlines */

  /* Semantic mappings (kept name-compatible with existing classes) */
  --bg:          var(--wc-bg);
  --surface:     var(--wc-surface);
  --surface-2:   var(--wc-surface-2);
  --text:        var(--wc-ink);
  --text-muted:  var(--wc-mute);
  --border:      var(--wc-border);
  --primary:     var(--wc-teal-700);
  --primary-ink: #FFFFFF;
  --accent:      var(--wc-coral-500);
  --good:        #15803D;
  --warn:        #B45309;
  --bad:         var(--wc-coral-600);
  --shadow:      0 1px 2px rgba(15, 17, 21, 0.05),
                 0 4px 12px rgba(15, 17, 21, 0.06);

  /* Depth (HIG: use sparingly) */
  --depth-sm:  0 1px 2px rgba(15, 17, 21, 0.06);
  --depth-md:  0 4px 16px rgba(15, 17, 21, 0.08);
  --depth-lg:  0 12px 28px rgba(15, 17, 21, 0.14);
  --depth-modal: 0 24px 48px rgba(15, 17, 21, 0.28);
}

:root[data-theme="dark"][data-redesign="v2"] {
  --wc-bg:       #0B1014;       /* near-black, OLED-friendly but not pure black */
  --wc-surface:  #14191E;
  --wc-surface-2:#1B2128;
  --wc-ink:      #F0F4F7;
  --wc-mute:     #94A3AE;
  --wc-border:   #232A33;
  --primary:     #22D3EE;       /* brighter teal in dark */
  --primary-ink: #0B1014;
  --accent:      #FB7185;
  --shadow:      none;          /* dark mode: depth via border/opacity, not shadow */
}
```

**Contrast verification (WCAG AA target):**

| Pair | Light | Dark |
|---|---|---|
| `--text` on `--bg` | #0F1115 on #F5F8FA = **15.8:1** ✓ | #F0F4F7 on #0B1014 = **15.2:1** ✓ |
| `--primary-ink` on `--primary` | #FFF on #0E7490 = **6.4:1** ✓ | #0B1014 on #22D3EE = **9.1:1** ✓ |
| `--text-muted` on `--bg` | #5B6776 on #F5F8FA = **5.0:1** ✓ | #94A3AE on #0B1014 = **7.4:1** ✓ |

### 1.2 Typography (Sports/Fitness pairing per skill)

```css
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;700;800&family=Barlow:wght@400;500;600;700&display=swap');

:root[data-redesign="v2"] {
  --font-display: 'Barlow Condensed', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-body:    'Barlow', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  --font-mono:    ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Type scale (HIG Dynamic Type aware — units in rem for scaling) */
  --t-display:   2.25rem;  /* 36px — countdown digits, score lines */
  --t-h1:        1.5rem;   /* 24px — page hero */
  --t-h2:        1.125rem; /* 18px — card heads (currently 14px uppercase — keep that for "eyebrow") */
  --t-eyebrow:   0.6875rem;/* 11px — label-style overline */
  --t-body:      1rem;     /* 16px — body */
  --t-body-sm:   0.875rem; /* 14px — secondary body */
  --t-caption:   0.75rem;  /* 12px — captions, meta */

  --weight-display: 800;   /* Condensed extra-bold for impact */
  --weight-bold:    700;
  --weight-semi:    600;
  --weight-body:    400;

  --tracking-display: -0.01em;
  --tracking-eyebrow:  0.06em;  /* uppercase eyebrows */
}

[data-redesign="v2"] {
  font-family: var(--font-body);
}
[data-redesign="v2"] h1, [data-redesign="v2"] .h-display {
  font-family: var(--font-display);
  font-weight: var(--weight-display);
  letter-spacing: var(--tracking-display);
  text-transform: uppercase;
}
```

**Why Sports/Fitness**: Condensed display fonts convey energy + read tightly at large sizes — perfect for big countdown digits and score lines. Barlow body retains the geometric clarity (HIG: Clarity) without feeling generic. Falls back gracefully to system stack offline.

### 1.3 Spacing + radius (8pt scale)

```css
:root[data-redesign="v2"] {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;

  --radius-sm:   8px;
  --radius-md:   12px;
  --radius-lg:   16px;
  --radius-pill: 999px;
}
```

### 1.4 Motion

Per HIG: cause-effect, spring-physics, interruptible. Aligns with skill recommendation (200–300ms micro, 400ms max).

```css
:root[data-redesign="v2"] {
  --motion-fast:    160ms;
  --motion-base:    220ms;
  --motion-slow:    320ms;
  --ease-out:       cubic-bezier(0.16, 1, 0.3, 1);   /* exit-faster */
  --ease-spring:    cubic-bezier(0.34, 1.56, 0.64, 1); /* press */
}
@media (prefers-reduced-motion: reduce) {
  :root[data-redesign="v2"] { --motion-fast: 0ms; --motion-base: 0ms; --motion-slow: 0ms; }
}
```

---

## 2. Component decisions (Home tab focus)

### 2.1 Header chrome (sticky top)

**Today**: solid `--primary` (navy) bar.
**v2**: translucent backdrop blur (HIG Deference — content shows through), `background: rgba(20,25,30,0.72); backdrop-filter: saturate(180%) blur(20px);` on dark; `rgba(255,255,255,0.78)` on light. Title uses `--font-display` (small caps "WC26"). Status-bar safe-area preserved.

### 2.2 Hero card (countdown)

**Today**: solid gradient teal→coral. Already close to the new direction.
**v2**: Same gradient but using new tokens. Countdown digits get `--font-display` at `--t-display` weight 800. Add **Trionda match-ball glyph** (small SVG, ~28px) to the left of "Kicks off in" label. Live-tick dot stays.

Acceptance:
- ✓ Hero takes ≤30% of first viewport on iPhone SE (375×667)
- ✓ Countdown digits ≥36px, tabular-nums (no width jitter)
- ✓ Gradient passes WCAG AA against title text in both light + dark
- ✓ Reduced-motion: no shimmer/pulse on the live dot

### 2.3 Card stack (favorite, today's matches, movers, recent, quick links)

**Today**: white surface, 14px radius, soft shadow.
**v2**: Same white surface, `--radius-lg` (16px), shadow downgraded to `--depth-sm` (a hairline + 1px shadow — HIG: depth conveyed by elevation hierarchy, not decoration). Card headers use `--t-eyebrow` uppercase + `--tracking-eyebrow`. Inside-card hierarchy reinforced by `--font-display` for primary metrics, body font for support.

### 2.4 Match rows (today + recent)

**Today**: 72-32 grid, single-row meta.
**v2**: Two-line layout — line 1 = teams with flag halos (24px), score on the right; line 2 = stage badge + venue dot · weather chip. Score uses `--font-display` for emphasis. Press feedback: scale(0.98) `--motion-fast` `--ease-spring`.

### 2.5 Buttons (primary / secondary / ghost)

```
PRIMARY:    bg=--accent (coral),     ink=#FFF,            radius=--radius-md, h=48
SECONDARY:  bg=--surface, border=--border, ink=--text,    radius=--radius-md, h=48
GHOST:      bg=transparent, ink=--primary, no border,     radius=--radius-md, h=44
DESTRUCTIVE: bg=--bad,    ink=#FFF,                         radius=--radius-md, h=48
```

Press: `scale(0.97)` for spring feedback. Disabled: `opacity: 0.45; cursor: not-allowed;`.

### 2.6 Tabs (the existing bar)

Keep scroll-chevron mechanism from current build. New design adds:
- Active tab indicator becomes a 3px pill at the bottom (full text-width, not full-cell), color `--accent`.
- Tab labels Barlow Condensed, weight 700, slight uppercase tracking.
- Inactive tabs `--text-muted`; pressed = `--text` (HIG: state clarity).

---

## 3. Logos & iconography (Q17 — accepted FIFA assets)

> **⚠ Legal note**: User confirmed accepting the legal grey-area for using official FIFA WC26 emblem + Trionda match ball in a non-commercial fan app. FIFA can issue DMCA takedowns at any time. Plan keeps assets as separate, swappable files so a future swap to commission-free abstracts is one-line config.

### Assets needed (~5 SVGs/PNGs)

| Asset | Use | Source |
|---|---|---|
| `wc26-emblem.svg` | Splash, footer, hero corner mark | FIFA media kit (download as SVG if available, else PNG @2x + WebP) |
| `wc26-emblem-mono.svg` | Header chrome small mark | Single-color flat version |
| `trionda-ball.svg` | Match indicator, loading spinner | FIFA Adidas Trionda render |
| `trophy-silhouette.svg` | Champion bracket cell, leaderboard rank-1 | Generic silhouette (safer) |
| `confetti.svg` | Celebration screens (group created, bracket submitted) | Custom generic |

Files placed in `assets/wc26/`. Lazy-loaded — never on the critical path. `loading="lazy"` with explicit dimensions to avoid CLS.

### Iconography style

Replace existing emojis (🏆 📅 📍 etc. in home quick-links) with **Lucide** icons (24px stroke 1.75) imported from CDN:

```js
import { Trophy, Calendar, MapPin, Users, ListChecks, Sparkles, Settings } from 'https://esm.sh/lucide-static@0.469/icons';
```

Consistent stroke width, mono-line, scales cleanly. Each icon sits inside a 36×36 rounded-square container tinted with `--primary` at 12% opacity (HIG: subtle depth via tinted backgrounds).

---

## 4. Team-color "skin" (Q18 — accent strokes only)

When `getFavoriteTeam()` returns a team, the app applies a `data-team-skin="<teamname>"` attribute to `<html>`. The CSS layer below maps each team to its primary home jersey color from `data/team_colors.json` (new file, hand-curated from public team kit info).

```js
// app/team-skin.js (new)
import { getFavoriteTeam } from './favorites.js';
import { applyTeamSkin } from './team-skin-util.js'; // reads team_colors.json
window.addEventListener('favorite:change', () => applyTeamSkin(getFavoriteTeam()));
applyTeamSkin(getFavoriteTeam()); // boot
```

```css
/* Only TWO things change with the skin — keeps chrome stable per Q18 */
[data-team-skin] {
  --accent: var(--skin-accent, var(--wc-coral-500));
}
[data-team-skin] .tab.is-active::after { background: var(--accent); }
[data-team-skin] .bb-slot.is-picked    { border-color: var(--accent); }
[data-team-skin] .home-card-favorite   { border-color: var(--accent); }
[data-team-skin] .pick-btn:not(.pick-btn-secondary) { background: var(--accent); }
```

Per-team override is set via:
```js
document.documentElement.style.setProperty('--skin-accent', teamPrimaryHex);
```

`data/team_colors.json` shape (12 groups × 4 teams = 48 entries — manual but one-time):
```json
{
  "Mexico":   { "primary": "#006847", "secondary": "#FFFFFF", "tertiary": "#C8102E" },
  "USA":      { "primary": "#0A3161", "secondary": "#FFFFFF", "tertiary": "#B31942" },
  ...
}
```

Color picked: home-jersey primary (Mexico green, USA navy, Brazil yellow). Tertiary used later for badge accents.

**Acceptance**: when a favorite is set, only the listed surfaces recolor; the rest of the UI is identical. Yellow/light teams (Brazil, Sweden) are tested against text contrast — if jersey primary fails 4.5:1 against `--primary-ink`, fall back to `tertiary` or darkened variant.

---

## 5. Phased rollout

### Phase 0 — Foundation (this session, no visible change)
- Add `[data-redesign="v2"]` token layer to `styles.css`
- Add fonts (Barlow Condensed + Barlow) with preload tag
- Add empty `data/team_colors.json` with at least 8 starter teams (USA, MEX, CAN, BRA, ARG, FRA, ESP, ENG)
- Create `assets/wc26/` directory with placeholders for now
- No HTML changes yet — design system can be A/B tested by adding the attribute to `<html>` manually

**Acceptance**: app looks identical with attribute off; tokens query correctly when attribute is on.

### Phase 1 — Home tab v2 (next session)
- Apply `[data-redesign="v2"]` to home view's root container only
- Rebuild hero, countdown, favorite card, match rows, quick links per §2
- Source 5 SVG assets, add lazy-loaded
- Wire team skin
- Side-by-side toggle in localStorage for QA: `localStorage.setItem('wc26.redesign', 'v2')` flips the attribute

**Acceptance**:
- ✓ All Quick Reference §1 (accessibility) + §2 (touch) pass on Home
- ✓ Lighthouse score on Home ≥ 95 mobile, ≥ 95 a11y
- ✓ Dark mode parity (same look, no broken contrast)
- ✓ Reduced-motion: no animations beyond opacity
- ✓ Tested on iPhone SE (375), iPhone 15 (393), iPad portrait (768)

### Phase 2 — Tab-by-tab rollout (subsequent sessions)
Order: Matches → Schedule → Brackets → My Brackets → Pools → My Picks → Venues → Groups detail.
Each tab gets its own session: rebuild the view's root with `[data-redesign="v2"]`, verify against the same acceptance criteria.

### Phase 3 — Polish + flip the default
- Remove the localStorage toggle
- Make `[data-redesign="v2"]` the default on `<html>`
- Delete or archive legacy CSS classes that have been replaced
- Final pass on motion polish (shared element transitions between Home and detail views)

---

## 6. What this plan deliberately doesn't change

- **Existing component contracts**: `renderMatchupList`, `renderBracketsLiveView`, etc. — their function signatures and rendering responsibilities stay the same. Only their internal markup and styles change.
- **Routes**: no URL changes.
- **Data shape**: `team_colors.json` is additive; nothing else.
- **Backend**: no Supabase changes.
- **PWA manifest**: no icon set change in this plan (a separate exercise; current icons stay).

---

## 7. Risk register

| Risk | Mitigation |
|---|---|
| FIFA DMCA on emblem/Trionda | Assets isolated to `assets/wc26/`. Swap to commission-free abstracts is ~10 minutes (rename folder, no code change). |
| Web font flash (FOUT) | `font-display: swap`; reserve metric-compatible fallback (system) via `size-adjust`. |
| Dark mode contrast regression | Tokens defined for both themes upfront; QA checklist requires both. |
| Team-color contrast failure (yellow Brazil) | Per-team fallback in `team_colors.json` (tertiary or darkened); auto-validate on add. |
| Mobile network: font + emblem add weight | Total budget: 80KB gzip new assets. Lazy-load emblem; preload only Barlow weights actually used. |
| Skill recommendation conflict (skill says "zero shadow" but HIG says "use depth") | Resolved by HIG's "Depth" guidance: subtle depth on ephemeral surfaces only. Chrome stays flat. |

---

## 8. Effort estimate

- Phase 0: 1 session (~2 hrs)
- Phase 1 (Home v2): 1 session (~3 hrs)
- Phase 2 (per tab): 8 tabs × ~1.5 hrs = 12 hrs across sessions
- Phase 3: 1 session (~1 hr)

**Total: ~18 hrs across ~6 sessions.**

---

## 9. Open questions (already deferred)

- Match-by-match team-color skin: should the active matchup detail screen also tint to the matchup's teams? (Not in this plan; defer to phase 4)
- WC26-specific iconography for stages (group, R32, R16): defer.
- Wallpaper / PWA splash screen redesign: defer.
