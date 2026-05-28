# Master Prompt: WC2026 Matchup Tracker PWA

> Paste this entire file into Claude Code (`claude` CLI) or Cursor + Claude. Both work identically. The starter data is in `wc2026_starter_data.zip` — unzip it into `/data/` at the start.

---

## Project Goal

Build a privacy-first, iOS-Safari-optimized Progressive Web App that visualizes the 2026 FIFA World Cup at the matchup level. Users browse matchups by country/group, see predicted winners with composite-score confidence and upset indicators, make their own picks, and watch the bracket update live as real results come in. Deploys to GitHub Pages with a daily GitHub Actions cron that scrapes external data sources to keep everything fresh. GitLab Pages is acceptable as an alternative. Netlify drag-drop is the manual fallback for when CI is broken.

## Hard Constraints

- **Vanilla JS only** — no React, Vue, Svelte, or build step. The app must be a static site that runs anywhere with zero compilation.
- **Single-page app** in `index.html` plus modular JS files loaded as ES modules.
- **No backend, no analytics, no telemetry.** All user data lives in `localStorage`. Zero network calls except to fetch the static JSON data files served alongside the app.
- **iOS Safari is the primary target.** Use `viewport-fit=cover`, respect `safe-area-inset-*`, minimum 44px tap targets, no `:hover`-only states, no `position: fixed` jank during scroll, momentum scrolling enabled.
- **PWA-installable.** Valid `manifest.json`, service worker for offline + asset caching, Add-to-Home-Screen works on iOS 16+.
- **Responsive but mobile-first.** Desktop is acceptable but not the priority.
- **Default view on launch: Group D (USA's group).** Always.

## File Structure (create exactly this)

```
wc2026-tracker/
├── index.html                  # App shell, includes <link rel="manifest">, theme meta
├── manifest.json               # PWA manifest, name "WC26 Tracker"
├── sw.js                       # Service worker; cache-first for static assets, network-first for /data/*.json
├── robots.txt                  # Disallow nothing; this is a public app
├── README.md                   # User-facing setup instructions
├── icons/
│   ├── icon-192.png            # Generate from a soccer ball SVG
│   ├── icon-512.png
│   └── icon-maskable.png       # For Android adaptive icons
├── app/
│   ├── main.js                 # Entry point; routes, state, initial render
│   ├── data-loader.js          # Fetches /data/*.json with localStorage caching + freshness check
│   ├── views/
│   │   ├── matchup-list.js     # List view: all matchups, filterable by country/group
│   │   ├── matchup-detail.js   # Detail view: one matchup, composite breakdown, upset indicators
│   │   ├── group-view.js       # Group standings + 6 matches
│   │   ├── bracket-view.js     # Knockout bracket SVG (group stage → final)
│   │   ├── my-picks.js         # User's predictions vs actual outcomes
│   │   └── team-detail.js      # Single team: roster, stats, all upcoming matches
│   ├── components/
│   │   ├── matchup-card.js     # Reusable matchup card
│   │   ├── confidence-bar.js   # Visual confidence display
│   │   ├── upset-badge.js      # Upset indicator badges
│   │   └── team-flag.js        # Country flag (use Twemoji or ISO emoji)
│   ├── state.js                # Central state store; localStorage persistence
│   ├── predictions.js          # User pick CRUD + accuracy calc
│   ├── styles.css              # iOS-optimized CSS with CSS variables for themes
│   └── theme.js                # Light/dark + system preference
├── data/                       # UNZIP wc2026_starter_data.zip HERE
│   ├── meta.json
│   ├── teams.json
│   ├── players.json
│   ├── group_matchups.json
│   ├── schedule.json
│   └── actual_results.json
├── scripts/
│   ├── update_elo.py           # Scrape eloratings.net
│   ├── update_espn.py          # Scrape ESPN rankings
│   ├── update_tmv.py           # Update Transfermarkt squad values (rate-limit aware)
│   ├── update_squads.py        # FIFA squad announcements + injury news
│   ├── update_results.py       # Live results during tournament from public ESPN/FIFA APIs
│   ├── rebuild_composite.py    # Recompute composite ratings from latest data
│   └── requirements.txt        # requests, beautifulsoup4, lxml
└── .github/workflows/
    ├── daily_update.yml        # Cron 06:00 UTC daily, all year
    ├── live_update.yml         # Cron every 2 hours, only during tournament window (11 Jun – 19 Jul 2026)
    └── deploy.yml              # Auto-deploy to GitHub Pages on push to main
```

## Data Model

The starter data has six JSON files. Treat them as the canonical schema. Key shapes:

**`teams.json`** — keyed by team name:
```json
"USA": {
  "name": "USA",
  "group": "D",
  "fifa_rank": 16,
  "espn_rank": 22,
  "elo_raw": 1800,
  "tmv_musd": 380,
  "composite": 76.1,
  "power_rank": 16,
  "sub_ratings": { "mine": 74.5, "elo_scaled": 68.3, "tmv_scaled": 81.1, "qual_scaled": 65.3 },
  "boosts": { "continental": 0.75, "host": 1.25 },
  "position_ratings": { "gk": 61.2, "def": 68.0, "mid": 78.9, "fwd": 76.0 },
  "coach": { "name": "Mauricio Pochettino", "nationality": "Argentina", "experience": 75 },
  "is_host": true,
  "continental_champion": true
}
```

**`group_matchups.json`** — keyed by group letter (A–L). Each contains all 6 matches with full win/draw/loss probabilities, expected points, predicted winner, win confidence %, and an `upset_risk` block with structured indicators.

**Upset indicator types** (already encoded):
- `close_gap` — composite gap < 5 (high severity) or 5–8 (medium)
- `continental_momentum` — underdog is recent continental champ
- `qualifying_form_edge` — underdog had higher pts/game in qualifying
- `host_advantage` — underdog is USA/Mexico/Canada
- `favorite_talent_form_divergence` — favorite has talent rating much higher than form rating (the 2022 Belgium/Germany pattern)

Display these as colored badges in the matchup detail view with the `detail` field as a tooltip.

## Required Views

### 1. Matchup List (default landing, scoped to Group D)
- Top filter bar: **Group** (default D) / **Country** dropdowns
- Each match row: flag, team A name, vs, team B name, flag, predicted winner badge, confidence %
- Tap a match → Matchup Detail
- Sticky header on iOS Safari (respect safe area)

### 2. Matchup Detail
- Big confidence bar showing win/draw/loss percentages
- Composite breakdown: Mine / Elo / TMV / Qual sub-ratings side by side for both teams
- "Why this prediction" section: 2–3 sentence explanation generated from the data
- "Upset indicators" section: render badges from `upset_risk.indicators` array
- **User pick** button: "I think [team A] wins" / "Draw" / "[team B] wins"
- After pick: show pick locked in, plus actual result if available

### 3. Group View
- All 4 teams in projected standings table with expected points
- All 6 matches as cards
- "Advancement probability" gauge for each team

### 4. Bracket View
- SVG bracket showing Group stage → Round of 32 → Round of 16 → QF → SF → Final
- During tournament: update nodes with actual results as `actual_results.json` is refreshed by cron
- Show user's prediction overlay (correct picks green, wrong red, pending grey)
- Click any future node to see model prediction for that pairing (regenerate on demand from teams.json)

### 5. My Picks
- List of all user predictions with locked-in confidence
- Running accuracy: "You're [X]/[Y] correct so far"
- Compare-to-model: "Your accuracy: X%. Model accuracy: Y%."
- Export picks as JSON (in case user wants to share)

### 6. Team Detail
- Team header: composite, ESPN rank, FIFA rank, coach
- Position-level breakdown (GK/DEF/MID/FWD ratings as bars)
- Full roster from `players.json` filtered by team
- Upcoming matches in tournament

## Data Refresh Logic

`app/data-loader.js`:
1. On app load, fetch `meta.json` to check `data_version` timestamp
2. Compare to `localStorage.last_data_version`
3. If newer, fetch all data files and update localStorage cache
4. If same, use localStorage (offline-first)
5. Service worker also caches `/data/*.json` with stale-while-revalidate

Show a small "Last updated: X ago" timestamp in the footer.

## GitHub Actions Workflows

**`daily_update.yml`**:
```yaml
name: Daily Data Update
on:
  schedule:
    - cron: '0 6 * * *'  # 06:00 UTC daily
  workflow_dispatch:      # Allow manual trigger

jobs:
  update-data:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install -r scripts/requirements.txt
      - run: python scripts/update_elo.py
      - run: python scripts/update_espn.py
      - run: python scripts/update_tmv.py
      - run: python scripts/update_squads.py
      - run: python scripts/rebuild_composite.py
      - name: Commit and push
        run: |
          git config user.name "wc26-bot"
          git config user.email "bot@users.noreply.github.com"
          git add data/
          git diff --cached --quiet || git commit -m "chore: daily data refresh"
          git push
```

**`live_update.yml`** (active only during tournament):
```yaml
name: Live Tournament Update
on:
  schedule:
    - cron: '0 */2 * * *'  # Every 2 hours
  workflow_dispatch:

jobs:
  update-results:
    runs-on: ubuntu-latest
    if: github.event.schedule == '0 */2 * * *'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install -r scripts/requirements.txt
      - run: python scripts/update_results.py
      - run: python scripts/rebuild_composite.py
      - name: Commit and push
        run: |
          git config user.name "wc26-bot"
          git config user.email "bot@users.noreply.github.com"
          git add data/
          git diff --cached --quiet || git commit -m "chore: live results update"
          git push
```

**`deploy.yml`**: standard GitHub Pages deploy workflow on push to main.

## Scraping Constraints — IMPORTANT

- **Respect `robots.txt`** for every source.
- **Rate limit**: 1 request per 5 seconds minimum to any single domain.
- **User-Agent header**: identify the bot as `wc26-tracker/1.0 (personal-project)`.
- **Transfermarkt**: aggressively anti-scrape. Fall back to weekly updates (cron Mondays only) and cache aggressively. Prefer Wikipedia squad-value pages where available.
- **ESPN / FIFA results endpoints**: use the public JSON endpoints that power their public scoreboards. These are not formally documented but are public and stable. Do NOT scrape rendered HTML.
- **eloratings.net**: structured HTML, OK to parse with BeautifulSoup at a slow rate.
- **Squad announcements**: scrape federation news pages + ESPN squad-tracker articles. Mark each player's `injury_status` field if news is found.
- All scrapers must be **idempotent and safe to re-run**. Failing source = skip silently, log the failure, do not break the build.

## iOS Safari CSS Essentials

```css
:root {
  --safe-top: env(safe-area-inset-top);
  --safe-bottom: env(safe-area-inset-bottom);
}
html, body { -webkit-text-size-adjust: 100%; }
body { padding-top: var(--safe-top); padding-bottom: var(--safe-bottom); }
button { min-height: 44px; min-width: 44px; -webkit-tap-highlight-color: transparent; }
.scroll-area { -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; }
@supports (padding: max(0px)) {
  .sticky-header { padding-top: max(12px, var(--safe-top)); }
}
```

## Required Meta Tags

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="WC26">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#1F4E78" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0D1117" media="(prefers-color-scheme: dark)">
```

## Build & Validation Checklist

After scaffolding, verify in this exact order:
1. `python -m http.server 8000` serves `index.html` cleanly
2. Open `http://localhost:8000` in desktop Safari, then in iOS Simulator or real device
3. Group D (USA) is the default view
4. All 12 groups load from `group_matchups.json`
5. Tapping a matchup loads the detail view with confidence bar
6. Upset indicators render correctly with appropriate severity colors
7. Service worker registers (check DevTools → Application → Service Workers)
8. Add to Home Screen on iOS shows the correct icon + name
9. `localStorage` persists picks across reloads
10. Lighthouse PWA score ≥ 90

## Deployment Steps (in order)

1. **GitHub** (primary path):
   - Create repo `wc2026-tracker` on github.com or gitlab.com
   - Push code
   - Enable GitHub Pages: Settings → Pages → Source: GitHub Actions
   - Enable Actions: Settings → Actions → Allow all actions
   - The `deploy.yml` workflow handles the rest
   - Daily cron runs automatically
   - Final URL: `https://<user>.github.io/wc2026-tracker/`

2. **Netlify Drop fallback** (no auto-update):
   - Zip the entire project folder
   - Drag to https://app.netlify.com/drop
   - Get URL in seconds
   - Use this only when GH Actions is broken

3. **Custom domain** (optional): add a `CNAME` file with your domain, configure DNS A records to GitHub Pages IPs.

## Order of Implementation

Build in this order, validating at each step:

1. Project scaffold + `index.html` + `manifest.json` + service worker
2. `data-loader.js` reading the starter JSON files
3. Matchup list view (default Group D)
4. Matchup detail view with confidence + upset indicators
5. Group view
6. Picks system (localStorage)
7. Bracket view (start static, then make dynamic)
8. Scrapers (in `scripts/`)
9. GitHub Actions cron
10. Deploy to GitHub Pages
11. Test on real iOS device

Push to main every 1–2 completed steps. Commits should be conventional commits style.

## Acceptance Criteria

- iOS Safari user opens the URL on iPhone
- Sees Group D immediately with USA, Türkiye, Australia, Paraguay
- Taps the USA vs Türkiye match → sees 47% USA win, 25% draw, 28% Türkiye win, upset indicators rendered
- Taps "I pick USA" → pick stored in localStorage, persists on reload
- Adds to Home Screen → app icon appears, opens full-screen without Safari chrome
- Next day at 06:01 UTC, opens the app → sees updated data automatically
- During the tournament, sees their pick result graded against actual outcomes

---

**End of master prompt.** When done, the user should be able to share one URL and have a working WC2026 companion that auto-updates and tracks their picks privately on each device.
