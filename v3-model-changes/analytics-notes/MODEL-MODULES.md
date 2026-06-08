# V3 model modules — data, equations, weights

All four layers are in `../model/worldcup2026/wc2026/`. Everything is data-driven;
swap any layer without touching the others.

---

## 1. `ratings.py`

Blends raw signals into **one z-scored strength per team**. Higher = stronger.

### Inputs (columns of `teams_2026.csv`)
`elo`, `market_value` (€m), `gdp_per_capita` (USD), `population`, `fifa_points`,
`temperature` (optional), `is_host` (0/1). Missing optional columns are skipped.

### Equation
Each signal is standardised (z-score), market/GDP/population are **log-transformed
first**, then weighted and summed; a host bonus is added; the result is
**re-standardised**:
```
z(x)   = (x − mean(x)) / std(x)            # std over the 48 teams
rating = w_elo·z(elo)
       + w_market·z(log market_value)
       + w_gdp·z(log gdp_per_capita)
       + w_population·z(log population)
       + w_fifa·z(fifa_points)
       + w_temperature·z(temperature)      # 0 by default
rating = rating + host_bonus · is_host
rating = z(rating)                         # final mean ≈ 0, std ≈ 1
```
Weights apply to **standardised** inputs, so they're directly comparable; they
needn't sum to 1. `std == 0` (all-equal input) yields zeros, not NaN.

### Weights (`RatingConfig` defaults)
`w_elo 0.50 · w_market 0.30 · w_gdp 0.07 · w_population 0.05 · w_fifa 0.08 ·
host_bonus 0.35 · w_temperature 0.0`. The README's library example uses an
alternative `w_elo 0.55 / w_market 0.30 / w_fifa 0.05`. **Tune by backtesting,
not intuition.**

### Output
`pd.Series` indexed by team name (mean≈0, std≈1) → fed to the match model.

---

## 2. `match_model.py`

Turns two strengths into a scoreline. `MatchModel(ratings_array, MatchConfig)`.

### Expected goals
```
supremacy = beta · (rating_A − rating_B)
lambda_A  = exp(mu + supremacy / 2)
lambda_B  = exp(mu − supremacy / 2)
```
`mu` = baseline scoring (`exp(0.30) ≈ 1.35` goals each in an even match); `beta`
= how strongly a rating edge becomes goal supremacy. Both fittable.

### Sampling — bivariate Poisson (`sample_goals`, used by the simulator)
Shared component `lambda3` correlates the two scores (the simulator analogue of
the Dixon-Coles low-score fix):
```
shared ~ Poisson(lambda3)
g_A = Poisson(max(lambda_A − lambda3, 1e-6)) + shared
g_B = Poisson(max(lambda_B − lambda3, 1e-6)) + shared
```
Fully vectorised over team-id arrays → tens of thousands of tournaments per call.

### Analytic 1X2 (`outcome_probs`, used by evaluation/baselines)
Independent-Poisson grid up to `max_goals=12`:
```
joint[i,j] = Poisson(i; lambda_A) · Poisson(j; lambda_B)
P(home) = Σ_{i>j} joint   P(draw) = Σ_{i=j} joint   P(away) = Σ_{i<j} joint
```
normalised to sum 1. (The shared component shifts these only marginally, so the
independent grid is used for scoring.)

### Knockout resolution (`knockout_winner`)
Draws go to a **rating-weighted shootout**:
`P(A wins) = 1 / (1 + exp(−pen_beta · (rating_A − rating_B)))`.

### Config (`MatchConfig` defaults)
`mu 0.30 · beta 0.70 · lambda3 0.12 · pen_beta 0.35 · max_goals 12`.

---

## 3. `tournament.py`

Monte-Carlos the real **48-team / 12-group** format, vectorised over `n_sims`.

### Format
- 12 groups (A–L) × 4 teams, single round-robin (6 matches/group).
- Group ranking key: `pts·1e6 + gd·1e3 + gf + tiny_random` (points → goal diff →
  goals for → random tiebreak).
- Qualifiers (32): top-2 of each group (24) + the **8 best third-placed** teams
  (thirds ranked by the same key across all 12 groups).
- Knockout: R32 → R16 → QF → SF → Final, single-elimination via
  `sample_goals` + `knockout_winner`.

### Bracket seeding
`bracket="reseed"` (default): the 32 qualifiers are sorted by strength and placed
via `_seed_bracket_order(32)` so **seeds 1 and 2 can only meet in the final** (a
balanced bracket → meaningful champion odds). `bracket="fixed"` + `fixed_bracket`
reproduces an exact official slotting.

### Validation built in
`load_teams` requires `team` + `group`; the constructor raises if any group ≠ 4
teams or any team lacks a rating.

### Output (`SimResult.table()`)
DataFrame per team: `rating`, `P(R32) P(R16) P(QF) P(SF) P(Final) P(Champion)`,
sorted by champion probability. Survival is monotonic by construction; champion
probs sum to ~1. Config: `n_sims 20000`, `seed 42`.

---

## 4. `evaluation.py`

Proper scoring of the **match-level** probabilities — the discipline Klement skips.

```
multiclass_brier(p, y)   = mean Σ_k (p_k − onehot_k)²            # 0..2, lower better
multiclass_log_loss(p,y) = −mean log(p[actual])                   # lower better
baseline_bookmaker(odds) = normalise(1/odds_home, 1/odds_draw, 1/odds_away)  # de-vig
```
`evaluate_model(model, matches, name_to_id)` scores a list of `(home, away,
outcome∈{H,D,A})` and returns `{brier, log_loss, n}`. **The benchmark to beat is
the bookmaker baseline (or a pure-Elo variant)** — if the extra signals can't beat
it, they aren't earning their weight.
