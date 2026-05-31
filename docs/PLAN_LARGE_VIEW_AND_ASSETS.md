# Plan: Apple Sports-Inspired Large-View Cards + Assets + Kits

Source: user request 2026-05-31. Supplements PLAN_UI_REFRESH.md.

## What "large view" means in Apple Sports

The thing that impresses about the Apple Sports app, distilled:

| Apple Sports element | What we'd borrow |
|---|---|
| Massive scoreboard numbers (~60pt) | `--t-score: 3.5rem` token (Barlow Condensed 800) on match-detail and home "next match" hero |
| Pinned favorite team appears on top in 60% of viewport | Home "Your Team Next" hero card — 280px tall, prominent before any other content |
| One match = one card, full width, scroll-snap vertical | Today's-matches and live-matches sections become `scroll-snap-type: y mandatory` with cards 220–280px tall |
| Stadium imagery + team color block at top of detail | Match detail gets a 140px-tall banner: team-primary-color gradient + venue photo washed out |
| Live indicator (red dot pulse) + minute counter "78'" big | Add `<span class="live-indicator">LIVE 78'</span>` w/ pulse animation |
| Touch-friendly with deliberate negative space | All cards padding 20–24px, gaps 16px, never feel cramped |
| iOS native blur for sticky header | `backdrop-filter: saturate(180%) blur(20px)` on `.app-header` (already in v2 spec) |

**Concrete recommended pattern: "expandable hero card"**

```
┌────────────────────────────────────────────┐
│  TODAY · GROUP A · KICKOFF IN 03:42       │  ← eyebrow
│                                            │
│   🇲🇽  MEXICO         vs       SOUTH 🇿🇦  │  ← team row (24pt names)
│                                  AFRICA   │
│                                            │
│      2  -  1   FINAL                       │  ← BIG score (56pt) when played
│                                            │
│   Estadio Azteca · Mexico City             │  ← venue line (13pt muted)
│   ─────────────────────                    │
│   [Pick] [Stats] [Lineups]                 │  ← inline actions
└────────────────────────────────────────────┘
```

Numbers (score, kickoff, minute) use `var(--font-display)` at large sizes; team names use Barlow regular at h2; venue/meta use body-sm. The contrast between giant numbers and tight meta is what makes Apple Sports feel premium.

## Build plan

### Phase L1 — Large match card (shared component)
File: `app/components/large-match-card.js` (new)

```js
export function largeMatchCard(match, { mode = 'upcoming', actual = null, accentColor = null }) {
  // mode: 'upcoming' | 'live' | 'final'
  // accentColor: optional hex string from favorite team's home jersey for the banner gradient
}
```

Renders the 280px-tall card. Used on:
- Home "Today's matches" (replaces current `.home-match-row` strip with stacked large cards)
- My Picks "next match" header
- Match detail page hero

CSS lives in v2 layer:
```css
[data-redesign="v2"] .lcard {
  background: linear-gradient(135deg, var(--accent) 0%, var(--surface) 60%);
  border-radius: var(--radius-lg);
  padding: 24px;
  min-height: 240px;
  box-shadow: var(--depth-md);
  display: grid;
  gap: 12px;
}
[data-redesign="v2"] .lcard-score {
  font-family: var(--font-display);
  font-size: 3.5rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 0.9;
}
[data-redesign="v2"] .lcard-team-name {
  font-family: var(--font-display);
  font-size: 1.5rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: -0.01em;
}
[data-redesign="v2"] .lcard-eyebrow {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--text-muted);
}
[data-redesign="v2"] .live-indicator {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--bad); color: white;
  padding: 4px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
}
[data-redesign="v2"] .live-indicator::before {
  content: ''; width: 6px; height: 6px; border-radius: 50%;
  background: white; animation: pulse-live 1.4s ease-in-out infinite;
}
@keyframes pulse-live { 0%,100%{opacity:1} 50%{opacity:0.3} }
```

Mobile-first scroll snap (Q20 mobile-first):
```css
[data-redesign="v2"] .lcard-stack {
  display: flex; flex-direction: column; gap: 16px;
  scroll-snap-type: y proximity;
}
[data-redesign="v2"] .lcard { scroll-snap-align: start; }
```

### Phase L2 — Match detail "stadium banner"
At top of `/#/matchup/...`, a 160px hero with:
- Team-A primary color gradient (left 50%) blending into Team-B primary color (right 50%)
- Trionda ball SVG centered, opacity 0.15, decorative
- Team flags 56px on each side, names beneath in display font

Uses team colors from `data/team_colors.json` (see Phase L4).

### Phase L3 — Asset integration (logo + Trionda)
**Assets downloaded this session:**
- `assets/wc26/fifa-wc26-logo.jpg` (2000×1000 JPEG, 80 KB)
- `assets/wc26/trionda-ball.webp` (1100×1100 WebP, 151 KB)

**Convert to multiple sizes** (next session, requires ImageMagick or similar):
```bash
# Logo: 3 sizes (mark, banner, hero)
convert assets/wc26/fifa-wc26-logo.jpg -resize 64x64 assets/wc26/logo-32.webp
convert assets/wc26/fifa-wc26-logo.jpg -resize 200x assets/wc26/logo-100.webp
convert assets/wc26/fifa-wc26-logo.jpg -resize 600x assets/wc26/logo-300.webp

# Trionda: 2 sizes (small inline ball, large hero decoration)
convert assets/wc26/trionda-ball.webp -resize 64x64 assets/wc26/trionda-32.webp
convert assets/wc26/trionda-ball.webp -resize 256x256 assets/wc26/trionda-128.webp
```

**Where they get used:**
- App header (replace text "WC26" with `logo-32.webp`, alt="WC26")
- Splash card on Home hero (decorative `logo-300.webp` at 30% opacity, top-right)
- Match detail stadium banner (centered `trionda-128.webp` at 15% opacity)
- Live-match indicator (small `trionda-32.webp` instead of generic dot)
- PWA splash screen (already-existing `icons/` set, augment later)

**Legal note**: User accepted the grey-area risk for FIFA assets. File-naming convention isolates them (`assets/wc26/`) so a swap to commission-free abstracts is one folder move.

### Phase L4 — Team home-jersey colors (replaces blocked soccer.com scrape)
**Problem**: `soccer.com/shop/fan/teams` returns 403 to WebFetch and to curl with browser headers (Cloudflare bot wall). Headless browser would work but isn't viable from this environment without adding Playwright/Selenium to the cron.

**Alternative sources, ranked:**

1. **Wikipedia team articles** (recommended — open, parseable, cited)
   - Each national team article (e.g., `https://en.wikipedia.org/wiki/Mexico_national_football_team`) has a `colors` field in the infobox with the home/away color swatches.
   - Parseable via the MediaWiki API: `https://en.wikipedia.org/w/api.php?action=parse&page=Mexico_national_football_team&prop=wikitext&format=json` then regex `\|color1\s*=\s*([0-9A-F]+)`.
   - 48 teams × 1 query = ~48 API calls, well within Wikipedia's rate limits.
   - Output: `data/team_colors.json` shape:
     ```json
     {
       "Mexico":   { "primary": "#006847", "secondary": "#FFFFFF", "tertiary": "#C8102E" },
       ...
     }
     ```

2. **Hand-curated JSON** (fallback, 30 min of work)
   - I write a one-time `data/team_colors.json` from publicly available kit photos (no scraping).
   - Use mainstream sources (team Wikipedia infoboxes, official federation pages) cited inline.

3. **Apple Sports manifest** (interesting, partial)
   - Apple's manifest (`api-sports.cdn-apple.com/v3/en_US/manifest/3.0.0`) includes team color fields (e.g., `"color": "#CE2228"` for PSG).
   - But coverage of WC26 national teams is incomplete; I'd need to map UMC IDs to country names.

**Recommendation**: Phase L4a = MediaWiki parser (`scripts/scrape_team_colors.py`), runs daily, produces `data/team_colors.json`. Phase L4b = hand-fix any team whose Wikipedia infobox doesn't parse cleanly.

### Phase L5 — Wire team skin to the new large-view
Once `team_colors.json` exists:
- `app/team-skin.js`: on `favorite:change`, read team's `primary` hex, set `--skin-accent` on `:root`.
- Large match card uses `var(--skin-accent)` on the banner gradient when one of the teams is the favorite.
- Apple HIG: skin recolors **accent strokes only** (Q18) — banners, active tab pill, primary CTA — not the entire chrome.

## Acceptance criteria

- ✓ Home shows the favorite team's NEXT match as the top hero card (280px tall, big numbers).
- ✓ Match detail has the stadium-banner header with team-color gradient + Trionda decoration.
- ✓ Live matches show `LIVE 78'` indicator with pulse animation; respects `prefers-reduced-motion`.
- ✓ FIFA logo replaces "WC26" text in the header.
- ✓ Team skin only affects accent strokes; chrome remains stable.
- ✓ All large numbers use tabular figures (no width jitter when score updates).
- ✓ Cards meet 44pt minimum tap targets; scroll-snap is `proximity` not `mandatory` (HIG: don't fight the user).
- ✓ Dark mode parity for every element.

## Out of scope (next round)

- Stadium photography per venue (need licensed sources)
- Player headshots
- Match-ball animations on score updates
- Bracket card animations on advancement
