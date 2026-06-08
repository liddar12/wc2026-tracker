# Prediction Models — data, equations, weights, refresh

`MODELS = ['j5l', 'dt', 'kalshi', 'hybrid', 'consensus']` (`app/lib/active-model.js:14`).
Hybrid and Consensus are *runtime blends* of the others, not independent models.
All model math is precomputed by scripts and committed as JSON; the browser only
reads + blends + renders.

---

## 1. J5L model (primary composite forecast)

Two precomputed artifacts, both built by `scripts/rebuild_composite.py`:
the **composite team rating** (`teams.json`) and the **win/draw/loss
probabilities** (`group_matchups.json`).

### Inputs
- `data/meta.json → model_weights`: `mine 0.15, elo 0.10, tmv 0.45, qual 0.30,
  cont_mult 1.5, host_mult 0.5`; `model_version "v4-optimized"`.
- `data/teams.json` per team:
  - `sub_ratings.{mine, elo_scaled, tmv_scaled, qual_scaled}` — the 4 calibrated
    components (source of truth). e.g. Mexico `mine 67.2, elo_scaled 69.0,
    tmv_scaled 74.2, qual_scaled 66.0`.
  - `boosts.continental` (e.g. 2.25), `boosts.host` (e.g. 1.25); flags
    `continental_champion`, `is_host`.
  - Raw `elo_raw, tmv_musd, fifa_rank, espn_rank, qualifying_form` feed the
    sub_ratings upstream but are **not** recombined at composite time.

### Equation — composite (`rebuild_composite.py:24-37`)
```
base = 0.15·mine + 0.10·elo_scaled + 0.45·tmv_scaled + 0.30·qual_scaled
if continental_champion: base += boosts.continental
if is_host:              base += boosts.host
composite = round(base, 1)
```
⚠️ The `cont_mult 1.5` / `host_mult 0.5` in meta.json are **not used** by the
runtime function — it adds the per-team `boosts.*` directly. Reconcile before
backtesting (documented vs executed weighting differ).

### Equation — win/draw/loss from `gap = composite_a − composite_b` (`:40-46`)
```
p_a  = 1 / (1 + exp(-gap / 4.5))          # logistic, scale 4.5 composite pts
p_b  = 1 - p_a
draw = max(0.05, 0.32 - |gap|·0.015)      # draw mass shrinks with gap, floor 5%
rest = 1 - draw
team_a_wins = p_a·rest ;  draw ;  team_b_wins = p_b·rest      (×100 → %)
expected_points: a = p_a·3 + draw ;  b = p_b·3 + draw
predicted_winner = "draw_likely" if |gap| < 3 else higher-composite team
win_confidence_pct = winning side's probability
```

### Output / display
`teams.json`: `composite`, `power_rank` (= composite desc). `group_matchups.json`:
`composite_a/b`, `gap`, `probabilities{}`, `expected_points{}`, `predicted_winner`,
`win_confidence_pct`, `upset_risk{}`. Shown as the tri-segment **confidence bar**
(`components/confidence-bar.js`), the **composite breakdown** grid, and the **J5L**
team-analytics chip.

### Refresh
Cron (`rebuild_composite.py` in daily/frequent/live). Committed JSON; browser
re-fetches on `data_version` change.

---

## 2. DT model (5th forecast)

Read-only consumer of `data/dt_model.json`. **The generator is NOT in this repo**
(no script references its internals).

### Inputs (`data/dt_model.json`, via `app/lib/dt-model.js:27-44`)
- `model{}`: `id "dt_model"`, `version "2.0"`, `method "player talent + coaching,
  Elo-anchored, Monte-Carlo bracket"`, `elo_anchored true`, `alpha_elo 0.55`.
- `team_rankings[]` (48): `rank, country, rating (0–100), title_prob,
  components{attack, midfield, defense, gk, coach, talent_z, elo_z}`.
- `bracket_simulation{iterations: 20000}`. `players[]` (1246) present but unused.
- `DT_NAME_MAP` bridges DT names → teams.json keys (Turkey→Turkiye, South
  Korea→Korea Republic, etc.).

### Equation
Contract: `rating = α·elo_z + (1−α)·talent_z`, `alpha_elo = 0.55` — but executed
in the **absent** generator. **Current state: 100% Elo.** All 48 teams have
`attack/midfield/defense/gk/coach/talent_z = 0`; only `elo_z` is nonzero (Spain
`elo_z 1.795 → rating 100.0`). So rating today is just min-max-scaled Elo; the
talent layer is dormant pending the FBref scrape. `title_prob` comes from the
20,000-iteration Monte-Carlo bracket (Spain 0.2636, Argentina 0.1792, France
0.1109). App-side usage is comparison only: `dtWinner(a,b)` picks higher `rating`.

### Output / refresh
DT team-analytics chip (`rating` + `Title: title_prob%`), bracket autofill,
backtest row. **Static-committed only** — `generated_at 2026-06-05`; no cron.
Refreshes only when you re-run the external pipeline and commit.

---

## 3. Kalshi market model

### Inputs
- **Kalshi public API** (`scripts/scrape_kalshi.py`): `api.elections.kalshi.com/
  trade-api/v2`, event `KXMENWORLDCUP-26`, series `KXMENWORLDCUP`. Per market:
  `yes_bid_dollars, yes_ask_dollars, last_price_dollars, previous_price_dollars,
  volume, open_interest`, + 30-day candlesticks for the top 20 teams.
- App reads `data/markets.json`: `tournament_winner[]` (`team, prob_pct,
  delta_24h_pp, volume, open_interest, sparkline[]`), `match_outcomes{}`
  (**currently empty**), `biggest_movers[]`, `updated_at`, `source "kalshi"`.

### Equation
```
prob = (yes_bid + yes_ask)/2  if both > 0   # mid-market (dollars = 0..1)
       else last_price else bid else ask else 0
prob_pct = round(prob·100, 1)               # NO de-vig / normalization
delta_24h_pp = (prob - previous_price)·100
biggest_movers = top 5 by |delta|
```
`fetch_match_outcomes()` is a **stub** — it finds candidate events but doesn't map
them, so `match_outcomes` ships empty and per-match market bars fall back to
tournament-winner odds. When populated, the match triplet is normalized by sum
(`hybrid-model.js:39-52`).

### Output / refresh
Winner ladder (`winner-view.js`), market bar + divergence (`market-odds.js`,
`model-market-divergence.js`), Kalshi chip, biggest-movers. **Live API at build
time** via cron (daily/hourly/15-min). `markets.json` is special-cased to be
**re-fetched on every client load** (bypasses the version cache).

---

## 4. Winner / champion odds (tournament ladder)

Not a separate model — a direct view of existing sources by active model:
- **Kalshi** (default): `markets.tournament_winner[]` ranked by `prob_pct` desc
  with sparkline + `delta_24h_pp`.
- **DT**: `dt_model.title_prob` (Monte-Carlo).
- **J5L**: no title probability — uses `power_rank` (composite desc); bracket
  autofill chains composite-winner picks.

Hybrid bracket-winner pick: `0.5·composite + 0.5·kalshi_prob_pct` per team
(`bracket-autofill.js:62-73`). ⚠️ composite (~0–100 strength) and prob_pct (0–100
probability) are added on **different natural scales** — a rough normalization
that favors high-composite teams over true market favorites.

---

## Summary table

| Model | Key inputs | Core equation | Weights / constants | Refresh |
|---|---|---|---|---|
| **J5L composite** | `teams.json` sub_ratings + boosts; `meta.json.model_weights` | `0.15·mine+0.10·elo+0.45·tmv+0.30·qual + boosts` | mine .15 / elo .10 / tmv .45 / qual .30; boosts additive | cron (committed) |
| **J5L W/D/L** | composite gap | `p_a=1/(1+e^(−gap/4.5))`; `draw=max(.05,.32−.015·\|gap\|)` | logistic scale 4.5; draw base .32, slope .015, floor .05; draw cutoff 3 | cron |
| **DT** | `dt_model.json` ratings/title_prob/components | `rating=0.55·elo_z+0.45·talent_z` (talent=0 today → pure Elo); MC title_prob | alpha_elo 0.55; MC 20000 | **manual commit** |
| **Kalshi** | Kalshi API; `markets.json` | `prob=(bid+ask)/2` (mid); `Δ24h=(prob−prev)·100` | no de-vig; movers top-5 | **live API @ build**, 15min–1h; re-fetched client-side |
| **Winner/champion** | `markets.tournament_winner.prob_pct` or `dt.title_prob` | rank by prob desc; hybrid `0.5·comp+0.5·kalshi%` | hybrid 50/50 | inherits source |
| **Hybrid (runtime)** | J5L probs + Kalshi `match_outcomes` | `w·model+(1−w)·market`, argmax | default w=0.5 (`wc26.hybrid_weight`) | client-side, no file |
