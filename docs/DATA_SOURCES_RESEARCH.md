# Odds / Data Sources — Research & Recommendations (2026-06-19)

Goal: make the Parlay of the Day (and the model) sharper and more real-time.
Two parts: (1) what we just shipped for near-real-time, (2) options to improve
the odds further.

## Shipped now — near-real-time, $0, no new vendor
**ESPN summary odds (DraftKings).** ESPN's per-match summary carries live
sportsbook lines — 3-way **moneyline** + **Over/Under total** — and ESPN is
open-CORS (we already poll it for live scores). `app/live-odds.js` pulls + de-vigs
them for today's matches on the poller's slow tick (~2.5 min); the parlay blends
them in and shows a "🟢 Live odds" badge. This replaces waiting on the hourly
Kalshi cron for the market view.
- Limits: single book (DraftKings); no props (BTTS/scorer) market lines; no
  injuries. Lines refresh on our poll cadence (near-real-time, not tick-by-tick).

## Why not poll the others client-side
- **Kalshi** — API returns **403 to the browser** (no CORS). Server-side only
  (already in our crons, ~hourly).
- Paid odds APIs require an **API key** → must live **server-side** (cron +
  repo secret), never in client JS.

## Options to improve the odds (evaluated)

| Source | Adds | Real-time | Cost | Notes |
|---|---|---|---|---|
| **ESPN/DraftKings** *(in use)* | ML, O/U | ~poll cadence | **Free** | 1 book, open CORS, no key |
| **OddsPapi** | **350+ books** incl. **Pinnacle** (sharp), 1X2/totals/**BTTS**/AH, price history | yes | **Free tier 250 req/mo**; paid above | Key required → server cron; tiny free quota fits a low-frequency consensus pull |
| **The Odds API** | 50 books consensus, 30s refresh | yes (30s) | **WC needs Business $99/mo** | Free tier excludes WC |
| **SportsGameOdds** | 30+ books, **player props**, half-markets, penalty lines | yes | paid (quote) | Props would make the anytime-scorer leg real |
| **Sportmonks** | Odds + **ML predictions** + **injuries** + **expected lineups** | yes | €15–149/mo | One vendor that also **fixes our dead injuries/lineups** (see POSTMORTEM) |
| **API-Football (api-sports.io)** | Odds, predictions, **injuries**, lineups, stats | yes | freemium (100 req/day free) | Also fills injuries/lineups; generous free tier |

## Recommendations (in order)
1. **Keep ESPN live odds (done).** Best free near-real-time lever; already live.
2. **Biggest odds-quality jump, low cost — add a multi-book CONSENSUS leg
   server-side.** Pinnacle is the sharpest public signal; blending a consensus
   (esp. Pinnacle) beats single-book DraftKings. Cheapest path: **OddsPapi free
   tier** (includes Pinnacle) pulled in a cron → `markets.json`, then blended
   like Kalshi. The Odds API ($99/mo) is the turnkey alternative.
3. **If we also want to fix injuries + lineups (post-mortem gaps) with ONE
   vendor:** **API-Football** (generous free tier) or **Sportmonks** — both add
   injuries + predicted lineups + odds, which would (a) make the anytime-scorer
   leg real and (b) repopulate the empty Injuries page.

## Integration shape (whichever paid source)
- New `scripts/scrape_<src>.py` → writes consensus odds (+ injuries/props if the
  source has them) into `data/`. Key as a **GitHub Actions secret**, never client.
- Wire into the hourly `frequent_update` cron (and `live_update` near kickoffs).
- The parlay already prefers live odds → falls back to cron market → model, so a
  new consensus feed slots in by extending that precedence.

## Decision needed
Which (if any) paid/keyed source to add — recommend starting with a **free
consensus pull (OddsPapi)** for sharper odds, and **API-Football** if we also
want injuries/lineups back. Both need a key (owner-provided) and a small cron.
</content>
