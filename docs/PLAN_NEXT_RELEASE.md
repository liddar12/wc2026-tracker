# Next-Release Inventory + Plan

Date: 2026-05-31 · Tournament kickoff: 2026-06-11 (**11 days away**)

## Apple Sports bracket UI — implemented vs deferred

### Implemented (live in prod)

| # | Pattern | Status |
|---|---|---|
| 1 | Vertical stack of full-width match cards (one per match) | ✅ `lcard-stack` on Home + Schedule |
| 2 | Big tabular scoreboard numbers (60pt) | ✅ `--t-score` 3.25rem on `.lcard-score` |
| 3 | LIVE pulse + minute counter | ✅ `live-indicator` w/ `pulse-live` keyframes |
| 4 | Status pills (FT/LIVE/PEN/scheduled-time) | ✅ `status-pill` component on bracket rows |
| 5 | Pinned favorite team at top of today | ✅ Home reorders favorite first |
| 6 | Stadium / team-color block at top of detail | ✅ Matchup-detail header has team-color gradient banner |
| 7 | Tap match → modal sheet preserving bracket scroll | ✅ `match-sheet.js` |
| 8 | Long-press → quick actions (favorite / share / pick) | ✅ `attachLongPress` on bracket slots |
| 9 | Animated win/loss reveals | ✅ `.bb-slot.is-actual-win` pop-scale |
| 10 | "We are here" tournament position indicator | ✅ `.bb-here` divider before current round |
| 11 | Bracket Compare mode (my picks vs model) | ✅ `/#/brackets/mode/compare` |
| 12 | Inline group-stage standings (tap letter) | ✅ Group letter strip on `/#/brackets` |
| 13 | Bracket sub-tabs (Live / Projected / Compare) | ✅ |
| 14 | Favorite-team glow + ⭐ marker on bracket nodes | ✅ `.is-fav-slot` + `.has-fav::before` |

### Deferred or partial (Apple Sports has, we don't)

| # | Pattern | Status | Why deferred |
|---|---|---|---|
| 15 | Translucent backdrop-blur header (Apple HIG "Deference") | 🟡 Token defined but not applied | Header still uses solid primary. CSS `backdrop-filter: saturate(180%) blur(20px)` would land it. 30 min. |
| 16 | Trophy-tree two-column converging bracket (poster view) | ❌ | Q9 chose vertical layout. Could add as `/#/brackets/mode/tree` later. |
| 17 | Connector threads between rounds | ❌ | Q9 noted: doesn't apply in vertical layout. Would matter for trophy-tree view. |
| 18 | Picture-in-picture mini-card while scrolling | ❌ | Out of scope; iOS PiP API is video-only. Could approximate with a sticky mini-bar. |
| 19 | Real-time score updates DURING matches | ❌ | **High priority for June 11** — polling at 30s when match LIVE. |
| 20 | Goal/red-card/sub timeline per match | ❌ | Requires live data source we don't have. Apple has it via licensed feeds. |
| 21 | "Top games today" curated section | 🟡 Today's matches stack exists, no curation | Could surface highest-importance match via composite gap × upset risk. |
| 22 | Watchlist alerts / push notifications | 🟡 Watchlist exists, no alerts | Needs web-push setup + Settings opt-in. |
| 23 | Player headshots on detail | ❌ | No image source for player photos. |
| 24 | Stadium photography per venue | ❌ | Licensing concern; commission-free alternatives would lift the venues tab considerably. |
| 25 | Editorial "key moments" timeline | ❌ | Same as #20 — needs licensed feed. |

---

## All unimplemented features (full project inventory)

Sorted by **dependency depth** (top items can be built immediately).

### A. Quick wins (no new infra; ~30 min – 2 hr each)

| # | Feature | Effort |
|---|---|--:|
| A1 | Translucent backdrop-blur app header (item #15 above) | 30 min |
| A2 | Search box on Schedule + Matches | 1 hr |
| A3 | Bracket auto-fill button: "Fill with model" — one tap = composite-gap winner for every empty slot | 1 hr |
| A4 | Bracket auto-fill button: "Fill with public consensus" — uses aggregated picks from public pools | 2 hr |
| A5 | Calendar export (`.ics`) for favorite team's matches | 1 hr |
| A6 | "Top games today" curated chip on Home (highest upset risk × importance) | 30 min |
| A7 | iOS "Add to Home Screen" prompt + better manifest icons | 1 hr |
| A8 | Shareable bracket link (`/#/share/{poolId}/{userId}`) — read-only preview of a friend's bracket | 1.5 hr |
| A9 | Markdown bracket export (copy-paste for Slack / Discord) | 30 min |
| A10 | Tournament countdown widget for the home screen (PWA shortcut) | 30 min |
| A11 | "What changed" diff toast (new feature) when meta.data_version moves | 1 hr |

### B. Real-time tournament features (needed for June 11; ~2–4 hr each)

| # | Feature | Effort | Dependency |
|---|---|--:|---|
| B1 | Live score polling: every 30s when a match has kickoff_utc in [now, now+2h] | 2 hr | none |
| B2 | "Refresh" pull-to-refresh shows new scores | 1 hr | B1 |
| B3 | LIVE matches always render at top of every list view | 1 hr | B1 |
| B4 | Goal/match-end browser notifications via web push API | 3 hr | B1 + service worker registration |
| B5 | Push notification opt-in flow in Settings | 1.5 hr | B4 |
| B6 | Per-match VAR/red card markers (data source TBD) | 2+ hr | live data source needed |
| B7 | Score-reveal animation: count-up from previous to new | 1 hr | B1 |

### C. Social / engagement features (~3–8 hr each)

| # | Feature | Effort | Dependency |
|---|---|--:|---|
| C1 | Shareable bracket page (A8 elaborated): public OG-image preview, copy/share buttons | 3 hr | A8 |
| C2 | "Bracket battle" head-to-head between 2 users in same pool | 4 hr | none |
| C3 | "Hot picks" — most-picked teams across all public pools (privacy-safe aggregate) | 3 hr | none |
| C4 | Streak / achievements (correct picks in a row, group sweep, etc.) | 5 hr | requires scoring history |
| C5 | Pool chat / comments (per-pool message thread) | 8 hr | new Supabase table + RLS |
| C6 | Bracket regret tracking ("you'd have scored X more pts if you'd picked Y") | 3 hr | scoring infra |
| C7 | Public leaderboard across ALL pools (opt-in) | 4 hr | new view |

### D. Deep stats views (data already exists, no views)

| # | Feature | Effort | Data source |
|---|---|--:|---|
| D1 | Player roster page per team | 2 hr | `data/players.json` |
| D2 | Player headshot lookup (commission-free pool) | 3 hr | external scrape |
| D3 | Referee history + bias tab | 2 hr | `data/match_referees.json`, `data/referees.json` |
| D4 | Weather forecast page per venue | 2 hr | `data/weather.json` |
| D5 | xG (expected goals) visualization per matchup | 2 hr | `data/xg.json` |
| D6 | Head-to-head detail page | 2 hr | `data/h2h.json` |
| D7 | Travel/fatigue distance + rest days view | 2 hr | `data/fatigue.json` |
| D8 | Top scorers leaderboard | 2 hr | `data/scorers.json` |
| D9 | Lineups page (probable XI) | 2 hr | `data/lineups.json` |
| D10 | Injuries dashboard | 2 hr | `data/injuries.json` |

### E. Model / projection improvements (~3–6 hr each)

| # | Feature | Effort |
|---|---|--:|
| E1 | **Hybrid composite + Kalshi model** (add `kalshi_scaled` sub-rating, reweight) | 3 hr |
| E2 | Group-finish probabilities (Monte Carlo simulation from match probs) | 4 hr |
| E3 | Live Elo updates after each match | 3 hr |
| E4 | Backtest panel: show model performance on past WCs | 4 hr |
| E5 | Per-user accuracy scoreboard (how often does this user pick correctly) | 3 hr |

### F. Multi-bracket / advanced pool features (~3–5 hr each)

| # | Feature | Effort |
|---|---|--:|
| F1 | Multiple brackets per user per pool (currently 1) | 4 hr |
| F2 | Bracket templates (model bracket, consensus bracket, "all favorites") | 2 hr |
| F3 | Weighted vs flat scoring toggle per pool | 3 hr |
| F4 | Pool admin controls (rename, change visibility, kick member, transfer ownership) | 4 hr |
| F5 | Private pool: invite-by-email (admin sends from inside the app) | 3 hr |
| F6 | Pool tournament journal (shared notes per match) | 4 hr |

### G. Accessibility + i18n (~5–10 hr total)

| # | Feature | Effort |
|---|---|--:|
| G1 | Full VoiceOver pass + aria-label audit | 4 hr |
| G2 | Contrast pass: every text/bg pair WCAG AA verified | 2 hr |
| G3 | Spanish locale (primary host country) | 6 hr |
| G4 | Portuguese locale (Brazil following) | 4 hr |
| G5 | French locale | 4 hr |
| G6 | Reduce-motion: audit every animation honors it | 1 hr |

### H. Branding / visual polish (~3–6 hr each)

| # | Feature | Effort |
|---|---|--:|
| H1 | Stadium photography (commission-free) | 4 hr |
| H2 | Custom team badge SVGs (replace flag emoji w/ proper crest) | 6 hr |
| H3 | WC26 official typography (Hex Franklin?) | 3 hr |
| H4 | Match-ball animations on score updates | 3 hr |
| H5 | Confetti on bracket submission + perfect picks | 1 hr |
| H6 | Empty-state illustrations for "no matches today" / "no pools yet" | 3 hr |

---

## Phased rollout (recommended)

**R5 — Tournament-ready** (must ship before June 11; ~12 hr total)
- B1, B2, B3 (live score polling + UI)
- A1 (header blur)
- A3, A4 (bracket auto-fill)
- A5 (calendar export for fav)
- A6 (Top games today curation)
- A7 (Add to home screen)
- A11 (what-changed toast)

**R6 — Engagement** (during group stage, ~15 hr)
- B4, B5 (web push + opt-in)
- C1 (shareable bracket link + OG image)
- C2 (bracket battle)
- C3 (hot picks)
- F2 (bracket templates)

**R7 — Deep stats** (during knockouts, ~12 hr)
- D1–D10 (stats views — pick the most valuable 4–6)
- E5 (per-user accuracy)

**R8 — Polish post-tournament** (~15 hr)
- E1 (hybrid model)
- G1–G2 (a11y)
- H1, H6 (branding)
- F4 (pool admin)
