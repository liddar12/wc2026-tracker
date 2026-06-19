# API-Football integration (Track 2 data source)

Adds two feeds from **API-Football** (api-sports.io) to improve odds quality and
fill the dead injuries page. **Key-gated and safe by default**: with no key the
app behaves exactly as before; everything ships green and starts populating the
moment the `APIFOOTBALL_KEY` GitHub secret is added.

## What it adds
| Feed | Script | Output | Why |
|---|---|---|---|
| **Consensus odds** | `scripts/scrape_apifootball_odds.py` | `data/consensus_odds.json` | Multi-book de-vigged 1X2 + Over/Under 2.5 (incl. sharps like Pinnacle) → sharper market term in the Parlay of the Day than any single book |
| **Injuries / suspensions** | `scripts/scrape_injuries.py` (augmented) | `data/injuries.json` `by_team` | ESPN exposes **no** WC injury data (post-mortem); API-Football does → revives the Injuries page |

## Parlay precedence (after this change)
Market term for each leg: **live ESPN/DraftKings** (near-real-time) → **API-Football consensus** (multi-book) → **Kalshi** (hourly) → model only. Each tier degrades gracefully to the next.

## API specifics
- Base: `https://v3.football.api-sports.io` · Auth header: `x-apisports-key: <KEY>`
- World Cup: `league=1`, `season=2026`
- Endpoints used: `/injuries?league=1&season=2026` (1 call covers the tournament), `/fixtures?league=1&season=2026&date=YYYY-MM-DD`, `/odds?fixture=<id>`

## Request budget (free tier = 100 req/day)
- **Injuries**: hourly cron, but the scraper **self-throttles to ≤1 fetch / 6h** → ~4 req/day. Carries previous entries forward between fetches.
- **Consensus odds**: only in `pre_kickoff_update` (fires near kickoffs) → 1 fixtures call + 1 odds call per fixture. A WC match-day is a handful of fixtures → well under 10 req/day.
- Worst case well under 100/day.

## Self-tests (no key/network)
```
python3 scripts/scrape_apifootball_odds.py --selftest   # de-vig + parse + orientation
python3 scripts/scrape_injuries.py --selftest           # injury parse + throttle + merge
```

## Manual step (owner) — add the secret, then it's automatic
1. Create a free account at **dashboard.api-football.com** (api-sports.io direct, not RapidAPI).
2. Copy the API key from the dashboard.
3. Add it as a GitHub Actions secret named **`APIFOOTBALL_KEY`** in `liddar12/wc2026-tracker` → Settings → Secrets and variables → Actions → New repository secret.
4. (Optional) trigger `frequent_update` + `pre_kickoff_update` manually (workflow_dispatch) to populate immediately; otherwise the next scheduled runs do it.

No client-side key exposure: the key only ever lives in the GitHub Actions runner. ESPN stays client-side (no key).
