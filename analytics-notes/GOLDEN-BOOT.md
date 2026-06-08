# Golden Boot model — data, equations, Monte-Carlo

Projects each player's total WC2026 goals, then runs a seeded Monte-Carlo to
estimate each contender's **chance (%) to finish top scorer** ("boot %"). Pure,
deterministic, **runtime-only** model — no backend, no precomputed file. Source:
`app/lib/golden-boot.js`; view `app/views/golden-boot-view.js` (`#/golden-boot`).

Headline:
```
perMatch      = baseRate × (scoring/100)^scoringExp × posWeight[position]
projRemaining = perMatch × expectedMatches × oppDefFactor × xgEnvFactor × (1 + setPieceBonus)
projGoals     = currentGoals(live) + projRemaining
```

## Inputs (only these 5 keys are actually consumed)
| `data` key | File | Fields used |
|---|---|---|
| `data.players` | `players.json` (1197) | `position`, `team`, `scoring` (fallback `offense`), `name` |
| `data.teams` | `teams.json` (48) | `position_ratings.def`, `composite`, `group` |
| `data.groupMatchups` | `group_matchups.json` | `[group].teams` |
| `data.xg` | `xg.json` (73 matchups) | `team_a, team_b, team_a_xg, team_b_xg` |
| `data.scorers` | `scorers.json` (currently `{}`) | live goals per player |

> `markets.json`, `injuries.json`, `schedule_full.json`, `dt_model.json`, and
> minutes/availability are mentioned in the plan but **not referenced** in
> `golden-boot.js`. The `players.json.goals` field (e.g. Mbappe 50 = career
> internationals) is **not** used — live goals come only from `scorers.json`.

## GB_CONFIG constants (`golden-boot.js:23-34`)
```
baseRate      0.70    goals/match for a 100-scoring FWD vs avg defense
scoringExp    2.0     finishing-curve steepness (rewards elite finishers)
posWeight     { FWD 1.0, MID 0.55, DEF 0.15, GK 0.0 }
minMatches    3       group-stage exit
maxMatches    7       finalist
setPieceBonus 0.12    "top scorer ≈ penalty taker" heuristic
oppDefClamp   [0.7, 1.4]
xgEnvClamp    [0.8, 1.25]
contenderPool 120
sims          10000   (view uses 8000; backtest 5000)
```

## Context factors (`buildContext`)
- **leagueDef** = mean of all teams' `position_ratings.def` (fallback 60).
- **expectedMatches[team]** = linear interp of `composite` between league min/max →
  `3 + t·(7−3)`, `t=(c−minC)/(maxC−minC)`. Weakest → 3 games, strongest → 7.
- **oppDefFactor[team]** = avg over the 3 **group** opponents of
  `clamp(leagueDef / oppDef, [0.7,1.4])`. Weaker opponent D → >1. (Knockout
  opponents are NOT projected.)
- **xgEnvFactor[team]** = mean total xG over the team's xg.json matches ÷ leagueXg
  (fallback 2.6), `clamp([0.8,1.25])`.

## Per-player projection (`projectPlayer`)
```
w        = posWeight[position]               (GK→0 ⇒ dropped)
scoring  = player.scoring ?? player.offense ?? 0
perMatch = 0.70 × (max(scoring,0)/100)^2.0 × w
matches  = expectedMatches[team] ?? 3
oppDef   = oppDefFactor[team] ?? 1
xgEnv    = xgEnvFactor[team] ?? 1
setPiece = isTopScorer ? 0.12 : 0     # team's highest-scoring non-GK attacker
projRemaining = perMatch × matches × oppDef × xgEnv × (1 + setPiece)
projGoals     = currentGoals + projRemaining
```

## Monte-Carlo (`goldenBootProjections`)
1. Project all players, drop GKs, sort by `projGoals`, take top **120**.
2. Seed `mulberry32(seed ?? 1234567)` — deterministic PRNG.
3. For `sims` runs: each contender draws `currentGoals + poisson(projRemaining)`
   (Knuth). Max-goal player(s) win; ties split `1/winners`.
4. `bootPct = round(wins/sims·1000)/10`; sort desc → rank.

**Odds derivation:** boot % is purely the Monte-Carlo win frequency — **no market
anchor** (markets.json unused). Fixed seed ⇒ fully reproducible.

## Live updates
`app/live-poller.js` polls every **30 s** when a match is in `[now, now+2h]`,
force-refetches (always pulls markets), dispatches `data:live-refresh` →
`main.js` calls `setData` → the Golden Boot view recomputes with fresh
`scorers.json` goals. End-to-end live latency is bounded by the **15-min scorers
cron**, not the 30-s poll.

## Backtest (`scripts/golden-boot-backtest.mjs`) — scaffold only
- Imports the **same shipped model** (no re-port). Metrics implemented + tested:
  `winnerRank`, `topNHit` (top3/top5), `brier`, `logLoss`, `goalMAE` (top-K=10).
- `--selftest` builds a synthetic 8-team tournament and asserts the favorite ranks
  top-3 — the only runnable path today.
- `--dir <historical/>` expects `historical/<tournament>/{inputs,actuals}.json` —
  **no such data ships**. Real history (WC14/18/22, Euro16/20/24, Copa21/24) is
  not sourced, so **no published accuracy exists**; the view's "validated against
  past tournaments" line is aspirational.

## Factor → weight → source
| Factor | Weight | Source |
|---|---|---|
| Finishing (base) | `baseRate 0.70`, `scoringExp 2.0` | players.json `scoring`/`offense` |
| Position | `{FWD 1.0, MID 0.55, DEF 0.15, GK 0.0}` | players.json `position` |
| Deep run | interp `3 → 7` | teams.json `composite` |
| Opponent defense | clamp `[0.7,1.4]`, group avg | teams.json `position_ratings.def` + group_matchups |
| Scoring environment | clamp `[0.8,1.25]`, fallback 2.6 | xg.json totals |
| Set-piece / PK | `+0.12` heuristic | derived (max-scoring attacker) |
| Live goals | additive | scorers.json |
| Minutes / market | **not implemented** | (injuries/markets unused) |

## To improve accuracy
1. **Real PK/set-piece taker data** — replace the +0.12 "highest-scoring attacker"
   guess (most-flagged weakness).
2. **Run the backtest on real history** — source the 7 tournaments per the data
   contract; today GB_CONFIG weights are untuned.
3. **Knockout opponent projection** — `oppDefFactor` only uses the 3 group
   opponents; winners reach SF/Final.
4. **Wire minutes/availability** — injuries.json/lineups.json loaded but unused; a
   rotated/injured starter is projected at full strength.
5. **Market anchor** — blend a top-scorer/title market into boot %.
6. **Knockout xG** — xg.json is group-only; deep-run projected matches fall back
   to leagueXg 2.6.
