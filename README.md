# WC26 Tracker

Privacy-first, iOS-Safari-optimized PWA for the 2026 FIFA World Cup. Browse matchups, see model predictions with composite-score confidence and upset indicators, make your own picks, and watch the bracket update as results come in. Vanilla JS, no build step, no backend, no analytics. All picks stay in your browser's `localStorage`.

## Quick start (local)

```bash
git clone https://github.com/jliddar-omilia/wc2026-tracker.git
cd wc2026-tracker
python3 -m http.server 8000
# open http://localhost:8000
```

The page should land on Group D (USA's group) by default.

## Project layout

```
index.html         # app shell
manifest.json      # PWA manifest
sw.js              # service worker (cache-first shell, SWR for data)
app/               # ES-module JS + iOS-optimized CSS
data/              # six JSON files; treat as canonical schema
scripts/           # Python scrapers + composite rebuild
icons/             # generated soccer-ball PNGs (192, 512, maskable)
.github/workflows/ # daily cron, live cron, GH Pages deploy
```

## Deploy

### GitHub Pages (primary)

1. Push to `main`.
2. In **Settings → Pages**, set Source to **GitHub Actions**.
3. In **Settings → Actions**, allow workflows to run.
4. The `deploy.yml` workflow publishes the site to `https://<user>.github.io/wc2026-tracker/`.
5. `daily_update.yml` runs at 06:00 UTC daily; `live_update.yml` runs every 2 hours during the tournament window (11 Jun – 19 Jul 2026).

### Netlify Drop (manual fallback)

Zip the repo and drop it onto https://app.netlify.com/drop. No CI, no auto-update.

## Data refresh

`app/data-loader.js` fetches `data/meta.json`, compares its `data_version` to `localStorage.wc26.last_data_version`, and re-fetches the rest only when newer. The service worker layers stale-while-revalidate on top of that for offline use.

## Scrapers

All scrapers in `scripts/`:

- Respect `robots.txt` for the target host.
- Rate-limit to ≥ 5s between requests to any single host.
- Identify as `wc26-tracker/1.0 (personal-project)`.
- Are idempotent and safe to re-run.
- Log + exit 0 on source failure so the daily build never breaks.

`rebuild_composite.py` is intentionally conservative — it preserves curated `sub_ratings` and only recomputes the weighted `composite` + the group_matchups probabilities.

## Hard constraints (enforced)

- Vanilla JS, ES modules, zero build step.
- No backend, no analytics, no telemetry. Network calls go only to the colocated static JSON.
- iOS Safari first: `viewport-fit=cover`, safe-area insets, 44px tap targets, `-webkit-overflow-scrolling: touch`, no hover-only states.
- PWA-installable with valid manifest + service worker.

## Acceptance checklist

- [x] Group D loads as default with USA, Australia, Paraguay, Türkiye
- [x] USA vs Türkiye detail shows 47% / 25.2% / 27.8% with upset indicators
- [x] Tap a pick → stored in `localStorage`, persists on reload
- [x] Add-to-Home-Screen works on iOS 16+ via valid manifest + apple-touch-icon
- [x] Daily cron (06:00 UTC) updates data via scrapers

## Phase 2 surface

- Schedule view (`#/schedule[/date/YYYY-MM-DD]`) — browse all 104 matches by
  the date they kick off in the user's local timezone.
- Venues view (`#/venues`) — inline SVG basemap of USA/Canada/Mexico with one
  tappable pin per host city; list of all 16 venues sorted by match count.
- Venue detail (`#/venue/id/<id>`) — header + list of matches at that venue.
- Matchup detail adds nine new sections, each rendering gracefully when its
  data isn't populated yet: when/where/how-to-watch, lineups, referee + bias,
  head-to-head, recent form, top scorers, weather, travel + rest, xG.
- New scrapers + workflows: `scrape_schedule`, `scrape_lineups`, `scrape_referees`,
  `scrape_h2h`, `scrape_form`, `scrape_scorers`, `scrape_weather`. Compute
  scripts (`compute_fatigue.py`, `compute_xg.py`) are pure-stdlib and always
  succeed. A new `pre_kickoff_update.yml` workflow runs every 10 min and
  gates to "is there a match starting in the next 90 min".
