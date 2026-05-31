# R5 — Final scope, 3 sub-releases

Decided 2026-05-31. Tournament kickoff: 2026-06-11 (11 days).

## R5a — Tournament-critical (12 hr, ~3 sessions, ship pre-June 11)

Goal: When kickoff hits, the app correctly handles live matches, has the polish a fan expects, and gives them tools to fill brackets quickly.

| # | Feature | Hr |
|---|---|--:|
| A1 | Translucent backdrop-blur header (Apple HIG Deference) | 0.5 |
| A3 | Bracket auto-fill: 3-variant (Model / Kalshi / 50-50 hybrid) | 1.5 |
| A6 | "Match of the day" chip on Home (upset risk × stage weight) | 0.5 |
| A7 | iOS "Add to Home Screen" prompt + manifest shortcuts | 1 |
| A11 | What-changed diff toast on data update | 1 |
| B1 | Live score polling: every 30s when match in [now, now+2h] | 2 |
| B2 | Pull-to-refresh re-fetches scores | 1 |
| B3 | LIVE matches pinned to top of every list | 1 |
| B7 | Score-reveal count-up animation | 1 |
| E2 | Group-finish Monte Carlo probabilities (4th chip on group picker) | 2 |
| F2 | Bracket templates (Model / Consensus / Chalk / Wild) | – grouped w/ A3 |
| H5 | Confetti on bracket submission + perfect picks | 0.5 |

**Acceptance**: On 2026-06-11 at 19:00 UTC, the M1 (Mexico v South Africa) card on Home shows LIVE pulse + minute counter, score updates every 30s automatically, and the bracket reflects the actual outcome within ~60s of match end.

## R5b — Deep stats + model upgrades (20 hr, ~5 sessions, ship during group stage)

Goal: Surface the rich data we've been scraping. Users get the "deep stats" experience that competes with ESPN / The Athletic.

| # | Feature | Hr |
|---|---|--:|
| D1 | Player roster page per team | 2 |
| D4 | Weather forecast block (matchup detail + venue detail) | 2 |
| D5 | xG visualization on matchup detail | 2 |
| D6 | Head-to-head history page | 2 |
| D9 | Probable lineups section (already imported, verify rendering) | 2 |
| D10 | Injuries dashboard | 2 |
| E1 | Hybrid model: composite + Kalshi 5th sub-rating | 3 |
| E3 | Live Elo updates after each match | 2 |
| G2 | Contrast pass: every text/bg pair WCAG AA | 2 |
| B4 | Web push notifications (goals + match end) | 1 (extends R5a B1) |
| H4 | Match-ball Trionda animation on score updates | – grouped w/ B7 |

**Acceptance**: A user opening any matchup-detail page sees roster, weather, xG, H2H, lineups, and injuries — all populated. Push notification opt-in works on iOS PWA-installed users.

## R5c — Engagement + polish (29 hr, ~7 sessions, ship during knockouts)

Goal: Make users want to come back. Shareable content, retrospection, accuracy scoreboard.

| # | Feature | Hr |
|---|---|--:|
| A4 | Fill with public consensus | 2 |
| A5 | Calendar .ics export for favorite team | 1 |
| A8 | Shareable bracket link | 1.5 |
| A10 | Countdown PWA badge / dynamic title | 0.5 |
| C3 | "Hot picks" dashboard (most-picked teams across pools) | 3 |
| E4 | Backtest panel (model vs 2022 WC, Euro 2024) | 4 |
| E5 | Per-user accuracy scoreboard | 3 |
| G1 | Full VoiceOver pass + aria-label audit | 4 |

**Acceptance**: Users can share their bracket via link; see how the model performs historically; track their own accuracy round-by-round. Full screen-reader support verified on iOS VoiceOver.

## Deferred to R6 (post-tournament)

A2 (search), A9 (markdown export), B5 (granular push prefs), B6 (VAR markers), C1 (OG image), C2 (bracket battle), C4 (achievements), C5 (pool chat), C6 (regret view), C7 (global leaderboard), D2 (headshots), D3 (refs), D7 (fatigue), D8 (top scorers), F1 (multi-bracket), F3-F6 (pool admin variants), G3-G5 (i18n), G6 (motion audit), H1-H3 (stadium photos, crests, custom font), H6 (empty-state art).

## Net plan

- R5a: 12 hr → starts now
- R5b: 20 hr → starts when group stage begins
- R5c: 29 hr → starts when knockouts begin

If R5a runs over, demote A11 (diff toast) and H5 (confetti) to R5b.
