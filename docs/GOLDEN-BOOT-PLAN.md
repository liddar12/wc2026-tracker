# Golden Boot Tracker — plan, requirements & architecture

A live top-scorer tracker + predictor in the Home **"Jump to"** grid: who's
scoring, who's *likely* to win the Golden Boot, and the backtestable factors
behind it. Modeled after the DT-model pattern (a scored model + a view + a
backtest harness), reusing existing data.

FR = functional · NFR = non-functional · AC = acceptance criteria.
Owner: 🤖 buildable from repo data · 👤 needs you (data sourcing / IP).

---

## 1. What it is
- **Entry point:** a "🏆 Golden Boot" tile in Home → "Jump to" (`home-view.js:777`) → new route `#/golden-boot`.
- **The view shows:**
  1. **Live leaderboard** — players ranked by goals (during the tournament), with team, minutes, penalties.
  2. **Golden Boot odds** — each contender's **chance % to finish top scorer**, biggest movers.
  3. **Why** — per-contender factor breakdown (finishing, deep-run, opponent defenses, set-pieces, xG environment).
  4. **Upcoming** — next fixtures + opponent-defense difficulty for the top contenders.
- Pre-tournament: pure projections. During the tournament: blends actual goals + projected remaining, recomputed each data refresh.

---

## 2. Data inventory (what backs the model)
| Signal | Source in repo | Status |
|---|---|---|
| Player finishing quality | `players.json` → `scoring`, `offense`, `overall`, `position`, `team`, `group`, `goals` | ✅ available (1197 players) |
| Team deep-run (more games = more goals) | `markets.json tournament_winner.prob_pct`, `teams.json` composite, DT `title_prob` | ✅ available |
| Opponent defensive weakness | `teams.json` defense + per-team aggregate from `players.json`, `xg.json` (xG conceded) | ✅ available |
| Group/draw difficulty | derived from group teams' strength | ✅ derivable |
| Match scoring environment | `xg.json` per-matchup `team_a_xg/team_b_xg` | ✅ (group stage; knockout projected) |
| Minutes / availability | `injuries.json by_team`, `players.json` overall/role, age/caps | ◐ partial (proxy) |
| Live goals / form | `scorers.json`, `actual_results.json` | ✅ during tournament (empty now) |
| **Set-pieces / penalty taker** | — | ❌ **not in repo** → heuristic now, real data later |
| Historical base rates | backtest output | ◐ needs sourcing |

---

## 3. The model (factors → projected goals → boot %)
Each factor is **backtestable** to high-scoring games + historical Golden Boots.

**Per-player projected tournament goals** =
`finishing_rate × expected_minutes × Σ_fixtures[ opponent_defense_factor × advancement_prob ] × scoring_env × (1 + set_piece_bonus) + live_goals_so_far`

Factor definitions:
1. **finishing_rate** — normalized from `players.json scoring`/`offense`, position-weighted (FWD > attacking MID > MID > DEF > GK).
2. **expected_minutes** — starter vs squad (overall/role) × availability (`injuries.json`).
3. **deep-run / advancement_prob** — per round, from team title/advancement odds (`markets`/`teams`/DT). Golden Boot winners almost always reach the SF/Final → more matches to score in. This is the single strongest historical factor.
4. **opponent_defense_factor** — weakness of each projected opponent's defense across the bracket path (group fixtures known; knockout opponents probability-weighted). "Strong team vs weak defense" is captured here.
5. **scoring_env** — `xg.json` expected total goals for the player's matches (high-xG games → more goals available).
6. **set_piece_bonus** — designated penalty/FK taker premium. **No repo data → heuristic v1:** treat each team's top-`scoring` attacker as the likely PK taker (+bonus), clearly flagged as an estimate; replace with real penalty/set-piece data later.
7. **live_goals_so_far** — actual goals from `scorers.json`/`actual_results.json` once matches start.

**Projected goals → Golden Boot chance %:** Monte-Carlo — simulate the remaining
tournament N times; in each sim draw each contender's goals from `Poisson(projected_remaining)`
(plus goals already scored), count who finishes top; `boot% = wins / N`. Handles
ties and "chasing" dynamics far better than a static ranking. ~50–100 contenders ×
10k sims runs fast enough at runtime.

---

## 4. Architecture
- **`app/lib/golden-boot.js`** (NEW, pure + testable): `goldenBootProjections(data, opts)` → ranked contenders `[{ player, team, position, currentGoals, projGoals, bootPct, factors:{finishing, deepRun, oppDefense, setPiece, xgEnv, minutes} }]`. Reads `players.json` + `markets`/`teams` + `xg.json` + `schedule_full.json` + `scorers.json`/`actualResults` + `injuries.json`. Monte-Carlo is a seeded, deterministic function (seed passed in) so it's unit-testable.
- **`app/views/golden-boot-view.js`** (NEW): renders the leaderboard + odds + factor breakdown + upcoming difficulty; live-refreshes on `data:live-refresh`.
- **`main.js`**: route `case 'golden-boot'` + nav highlight; **`home-view.js`**: the "Jump to" tile.
- **Data:** no new required file — computed at runtime from existing refreshed data (works with the existing out-of-band data-refresh job). Optional later: a precomputed `golden_boot.json` if we move Monte-Carlo offline.
- **Backtest:** `scripts/golden-boot-backtest.(py|mjs)` — validate factor weights + the projection→boot-prob mapping against history.

---

## 5. Backtest (the "backtestable to Euro / Copa / last 3 WCs" requirement)
- **Tournaments:** WC 2014 / 2018 / 2022, Euro 2016 / 2020 / 2024, Copa América 2019/2021 / 2024.
- **Metric:** (a) did the model rank the actual Golden Boot winner in the top-N pre-tournament? (b) calibration — Brier/log-loss on per-player boot probabilities; (c) goal-total MAE for the top contenders.
- **Also validates the sub-signals** the user called out: do "deep-run" + "weak-opponent-defense" + "penalty-taker" + "high-xG-environment" actually correlate with tournament goal output historically? Each becomes a weighted term only if it earns its place (same discipline as the DT backtest).
- **Data need (👤/sourcing):** historical per-player tournament goals + pre-tournament factors. Not in the repo — same residential-IP/public-dataset sourcing as the DT backtest. I'll **scaffold the harness + a runnable self-test now**; plug in real data to produce published accuracy.

---

## 6. Build phases (each behind the 100% QA gate, shipped via PR)
1. **Model core** — `golden-boot.js` (projections + seeded Monte-Carlo) + unit tests (factor math, Poisson sim determinism, live-blend).
2. **View + Jump-to** — `golden-boot-view.js`, route, Home tile; Playwright (tile → view renders; leaderboard/odds/factors present; live-refresh).
3. **Backtest harness** — `golden-boot-backtest.*` + self-test; wire real history when sourced.
4. (Optional) market blend if a top-scorer market appears; precomputed `golden_boot.json` if we move sim offline.

## 7. Risks / honesty
- **Set-piece/penalty data is missing** → v1 uses a heuristic, clearly labeled (like DT's "Elo-anchored prior"). Real penalty/FK/corner data materially improves Golden Boot prediction and is the top enrichment.
- **Odds are model-derived** (no market to anchor) — the backtest is what earns trust; until it's run on real history, label boot% as a model estimate.
- **Knockout opponents are projected** (probability-weighted), so deep-run contenders' odds carry more uncertainty — surfaced in the UI.

## 8. Decisions — LOCKED
1. **Odds engine:** runtime **seeded Monte-Carlo** in `golden-boot.js` (deterministic, unit-testable, live).
2. **Factor depth:** all repo-available factors now + a **flagged penalty/set-piece heuristic** (clearly labeled estimate; enrich later).
3. **Backtest:** **scaffold the harness now** + runnable self-test; plug in WC14/18/22 + Euro16/20/24 + Copa21/24 history to publish accuracy.
4. **Live cadence:** **recompute on each data refresh** (`data:live-refresh`); pre-tournament shows projections.

Build order (each behind 100% QA, shipped via PR): (1) `golden-boot.js` model core + tests → (2) `golden-boot-view.js` + Jump-to tile + route + Playwright → (3) backtest harness + self-test. Ready to build on your go.
