# RJ30 — WC2026 Tracker Recommendations (free-data-source backlog)

Research date: 2026-06-30. **Hard constraint: zero additional cost** — every item below uses a
genuinely free source (no key or free-forever key), data the app already collects, or pure code.
Grounded in the live data/API inventory (see the source-assessment table at the bottom).

Two lists, as requested:
- **RJ30** — the prioritized list (P0 → P2): features, functions, upgrades, enhancements, bug fixes.
- **RJ30.1** — the nice-to-have / speculative list.

---

## Free data-source assessment (what's worth using — all $0)

| Source | $0? | Key? | What it gives us we don't have | Verdict |
|---|---|---|---|---|
| **Polymarket Gamma API** (`gamma-api.polymarket.com`, tag_id `102232`) | ✅ free, no rate limit | none | **Per-match W/D/L + winner odds for EVERY match** (group + knockout) — 9,217 WC26 markets | **Adopt** — fills the per-match-odds hole Kalshi/API-Football can't. App already calls this API in backtest scripts. |
| **Your own `match_events.json`** (ESPN summary, already populated) | ✅ | none | Goals-by-player → **top scorers / Golden Boot live goals** | **Adopt** — derive scorers from data we already store; no new feed. |
| **ESPN hidden API** (`site.api.espn.com`) | ✅ | none | Already powering scores/lineups/events; also has **team rosters** | **Keep + extend** for squad refresh. |
| **Open-Meteo** (`api.open-meteo.com`) | ✅ non-commercial | none | Per-venue forecast + historical by lat/long | **Fix existing integration** (already wired; scraper just under-populates). Note: "non-commercial" free tier. |
| **football-data.org** free tier | ✅ 10 req/min | free key | WC **standings**, **scorers**, matches | **Adopt as fallback** for standings/scorers cross-check (older format, no xG/odds on free). |
| **Kalshi** (already used) | ✅ | none | Tournament-winner / awards markets | **Keep** (tournament-level only). |
| BALLDONTLIE FIFA | ⚠️ free 5/min, rich data **paid** | free key | Shot maps, props, momentum — but the good stuff is $9.99+/mo | **Skip** (violates $0 for the valuable endpoints). |
| TheSportsDB | ⚠️ free **non-commercial only** ($9/mo commercial) | free key | Squads, artwork (crowd-sourced) | **Avoid** for this commercial domain; accuracy concerns. |

> Note vs. prior memory: "Polymarket ≈ Kalshi (r=0.997)" was about *tournament-winner model accuracy* — it does **not** apply here. The value is Polymarket's **per-match** markets, which Kalshi simply doesn't publish.

---

## RJ30 — Prioritized backlog

### P0 — highest impact, free, closes a visible gap

| ID | Item | What / how (free) | Impact | Effort |
|----|------|-------------------|--------|--------|
| **RJ30-1** | **Per-match odds via Polymarket** | New `scrape_polymarket_odds.py` → write per-match W/D/L into `markets.json.match_outcomes` + `consensus_odds`. Lights up the **Parlay's market term** (currently model-only) and the **matchup market-odds column + model-vs-market divergence**. | High | Med |
| **RJ30-2** | **Live top-scorers / Golden Boot** | Derive `scorers.json` by aggregating goals from the already-populated `match_events.json`; feed the Golden-Boot live-goals term. Kills the dark ESPN scorers feed. | High | **Low** |
| **RJ30-3** | **Goal & kickoff push notifications** | Web Push (service worker already present) on goals (from live/`match_events`) + kickoff reminders for favorited teams. No service cost. Biggest engagement lever. | High | Med |
| **RJ30-4** | **Fix the weather feed** | Repair `scrape_weather.py` to populate **all upcoming venue/date** forecasts via Open-Meteo (today it fills ~1 venue). Restores the matchup weather card. | Med | **Low** |

### P1 — should do

| ID | Item | What / how (free) | Impact | Effort |
|----|------|-------------------|--------|--------|
| **RJ30-5** | **Live win-probability timeline** | In-match win% from live score + minute + model (`live-elo.js` already exists) → sparkline on the live matchup card. | Med-High | Med |
| **RJ30-6** | **Group standings + qualification scenarios** | Compute standings + "what each team needs to advance" from results (or football-data.org). Complements the existing bracket. | Med | Med |
| **RJ30-7** | **Unfreeze `players.json` / squads** | Refresh active squads from ESPN rosters (free); blend live form so Golden Boot / Golden Awards stop running on a 2026-05-27 snapshot. | Med | Med |
| **RJ30-8** | **Results-derived form (retire dark `form.json`)** | Replace the empty ESPN team-schedule scraper with last-5 computed from `actual_results.json`; also revives the composite `form` weight (currently ~0). | Low-Med | **Low** |
| **RJ30-9** | **Deferred bug-fix bundle** | (a) `live-api` cache-control header consistency; (b) delete dead `scheduleCard()`; (c) persist live **minute** in `actual_results.json`; (d) browser-verify + fix ET/pen winner highlight on Home/Schedule cards; (e) validate `daily_update --strict`. | Med (cum.) | Low each |

### P2 — lower priority

| ID | Item | What / how (free) | Impact | Effort |
|----|------|-------------------|--------|--------|
| **RJ30-10** | **Referees / ref-bias** | Fix the Wikipedia officials parser (or football-data) to populate `match_referees.json` for the existing ref panel. | Low | Med |
| **RJ30-11** | **Model accuracy dashboard** | Promote `snapshot_backtest` live-forward capture into `accuracy-scoreboard-view` (Brier/log-loss vs. market, updating per match). | Low-Med | Med |
| **RJ30-12** | **Pipeline observability** | Surface the new staleness/dark-feed warnings in a tiny status view or a daily GitHub-issue summary (watchdog already emits them). | Low | Low |

---

## RJ30.1 — Nice-to-have / speculative

- **Shot maps / xG event timeline** — only free via scraping FBref/Understat (ToS risk) or StatsBomb open data (no live WC). Defer unless a clean free event-xG source appears.
- **Lineup formation / player position view** — `lineups.json` already has positions; render a pitch view.
- **AI match previews/recaps** — generate from existing data via Claude API (note: that's compute cost — out of the $0 rule unless using existing quota).
- **Possession / momentum stats** — needs a richer feed (BALLDONTLIE paid). Skip until free.
- **i18n / multi-language** (ES at minimum for a NA WC), **per-match OG share cards**, **calendar/ICS polish**, **iOS home-screen widget / Siri shortcuts**, **dark-mode + motion polish**, **historical H2H expansion**, **accessibility audit pass**.

---

## Suggested sequencing
Ship **RJ30-2 + RJ30-4 + RJ30-8** first (all **Low** effort, all reuse data/sources we already have), then **RJ30-1** (Polymarket per-match odds — the single biggest data unlock), then **RJ30-3** (push notifications). Each is independently shippable behind the existing 4-step green gate.

## Sources
- [Open-Meteo docs](https://open-meteo.com/en/docs) · [Polymarket FIFA WC](https://polymarket.com/fifa-world-cup) · [Polymarket Gamma usage (worldcuppolymarket)](https://worldcuppolymarket.vercel.app/)
- [football-data.org coverage](https://www.football-data.org/coverage) · [TheSportsDB free API](https://www.thesportsdb.com/free_sports_api) · [BALLDONTLIE FIFA](https://fifa.balldontlie.io/)
- [TheStatsAPI — free WC2026 API comparison](https://www.thestatsapi.com/blog/free-world-cup-api-alternatives) · [Highlightly — best football APIs 2026](https://highlightly.net/blogs/best-football-apis-in-2026)
