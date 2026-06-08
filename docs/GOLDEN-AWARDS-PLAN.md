# Golden Awards — plan (Boot · Ball · Glove · Young Player)

Rename the **Golden Boot** section → **Golden Awards**, a tabbed section covering
the four individual WC awards, each with a transparent model **+** the live Kalshi
market for that award, plus a backtest harness. Goal: genuinely useful predictions,
not vanity numbers.

## Why this is fully buildable now (data probe)
- **Kalshi markets exist + are priced for all four** (independent signal — the lever
  that's helped calibration all session):
  - `KXWCGOALLEADER-26` — Golden Boot (34 players) — *already integrated*.
  - `KXWCAWARD-26GBALL` — Golden Ball (57), `-26GGLOVE` — Golden Glove (15),
    `-26BYP` — Best Young Player (12).
- **`players.json` per-player fields:** `position, age, overall, offense, defense,
  scoring, goals, caps, club`. → 58 U21 players (age ≤21; Yamal 18, Güler 21);
  GK `overall` (Maignan 76.2, Raya 73.9…).
- **`teams.json` `position_ratings.{gk,def,mid,fwd}`** + **`forecast.json`** deep-run
  odds (hybrid). No data gaps.

## Award models (all from existing data, then blended with the award's market)

General shape per award: compute a **model score** per eligible player → softmax to a
"win %" → **blend with the Kalshi market** (renormalise to ~100), exactly like the
Golden Boot. The blend weight is tuned per award by how *objective* it is.

### 1. Golden Boot — top scorer (exists)
Monte-Carlo projected goals (finishing × position × deep-run × opp-defense × xG-env ×
set-piece) blended 50/50 with `KXWCGOALLEADER`. Objective stat → model + market both
carry weight. **No change** beyond living under the new section.

### 2. Golden Ball — best player (voted, subjective)
Almost always an attacker/playmaker on a deep-running team (Messi '22, Modrić '18).
`ballScore = wT·z(overall) + wG·z(projGoals from Boot model) + wD·z(deepRun) + posW`
- `overall` = player talent; `projGoals` = attacking output (reuses the Boot engine);
  `deepRun` = team `forecast` final/champion odds (Golden Ball heavily favours
  finalists); `posW` = FWD 1.0 / MID 0.9 / DEF 0.3 / GK 0 (GKs win the Glove, not Ball).
- Subjective/voted → **market-led blend (~65% Kalshi GBALL / 35% model)**.

### 3. Golden Glove — best goalkeeper (GK-only)
Tracks clean sheets + deep run (Martínez '22, Courtois '18). GKs only:
`gloveScore = wK·z(GK overall) + wT·z(team def strength) + wD·z(deepRun)`
- team def strength = `teams.position_ratings.gk/def` + xG-against (clean-sheet proxy);
  deep run from `forecast`. Fairly objective → **~50/50 model/Kalshi GGLOVE**.
- (Kalshi `KXWCSAVE` saves market exists as a future secondary — deferred per owner.)

### 4. FIFA Young Player — best U21 player (voted)
Golden Ball model restricted to **age ≤ 21** (`players.age`; pool = 58). Same factors,
same posW. Subjective/voted → **market-led (~65% Kalshi BYP / 35% model)**.

## Scraper (cadence: multiple times a day, like the rest)
Extend `scrape_kalshi.py`: `fetch_awards()` reads `KXWCAWARD-26{GBALL,GGLOVE,BYP}`
(de-vigged per-player odds) → `markets.json.awards = { golden_ball:[], golden_glove:[],
young_player:[] }` (goal_leader stays as is). Runs in the **hourly `frequent` + 15-min
`live`** crons (already where Kalshi is scraped) → all award odds refresh several times
a day; the client recomputes on each load + live-refresh.

## Backtesting (honest about the ceiling)
Extend `golden-boot-backtest.mjs` → a 4-award harness. For each past tournament with
known winners (WC 2014/18/22, Euros, Copa):
- metrics per award: **winner top-1 / top-3 hit-rate**, **Brier / log-loss** on the
  actual winner, calibration.
- compare: model-only vs market-only vs the blend; grid-tune the per-award blend weight
  on held-out tournaments.
- **Reality check:** one winner per award per tournament = tiny N, and **Golden Ball /
  Young Player are *voted* (subjective)** → inherently noisy to backtest; the Boot and
  Glove are stat-driven and more backtestable. So the **market blend is the main source
  of usefulness**; the backtest sets the weights + reports honest top-3 hit-rates rather
  than implying point precision. Needs historical award-winner + pre-tournament
  player-rating data (sourced like the Golden Boot backtest).

## UI
- Route `#/golden-awards` (keep `#/golden-boot` as an alias → Boot tab). Home "Jump to"
  tile: **🏆 Golden Awards**.
- Tabbed section: **🥇 Boot · 🏆 Ball · 🧤 Glove · 🌟 Young Player**. Each tab: ranked
  contenders with **blended % + model% / market% (📊)** + factor chips + a "how it's
  built" explainer noting the Kalshi blend + multi-daily refresh.
- New lib `app/lib/golden-awards.js` (Ball/Glove/Young projectors) reusing the Boot
  engine + `goalLeaderMarket`-style market matchers; `golden-boot.js` stays the Boot.

## Build phases
1. **Scraper + data**: `fetch_awards()` → `markets.json.awards`; cron wired.
2. **Models**: `golden-awards.js` (Ball/Glove/Young) + per-award market blend.
3. **UI**: rename section + 4 tabs + view; Home tile.
4. **Backtest**: 4-award harness + tune blend weights; report top-3 hit-rates.
5. **Ship**: tests green → preview → live (additive, behind a new section = low risk).
