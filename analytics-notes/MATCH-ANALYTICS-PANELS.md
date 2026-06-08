# Match-detail analytics panels — data + equations

Rendered by `app/views/matchup-detail.js` (`#/matchup/<team_a>/<team_b>`). Only
**confidence-bar** and **composite-grid** feed the prediction model; everything
else is informational. **Only one panel computes in the browser: referee bias
(`app/ref-bias.js`).** Several feeds are empty pre-tournament and render graceful
"not yet available" states. All data is static JSON, cron-refreshed (see
DATA-PIPELINE.md); `markets.json` is the one file always re-fetched on
pull-to-refresh.

| Panel | Data file → fields | Computation | Feeds model? | Refresh |
|---|---|---|---|---|
| **confidence-bar** | `group_matchups.json → probabilities.{team_a_wins,draw,team_b_wins}` | display of model probs (see PREDICTION-MODELS) | **Yes — core model** | cron `rebuild_composite.py` |
| **composite-grid** | `teams.json → composite, sub_ratings.{mine,elo_scaled,tmv_scaled,qual_scaled}` | `0.15·mine+0.10·elo+0.45·tmv+0.30·qual + boosts` | **Yes — model input** | cron `rebuild_composite.py` |
| **xg** | `xg.json → team_a_xg, team_b_xg, formula_version` | `1.45 ± 0.045·gap` + form bump `(form−7.5)·0.04`, clamp [0.2,4.5] | No (derived from composite/form) | cron `compute_xg.py` |
| **form** | `form.json → [{date,opponent,score_a,score_b,result}]` | display, last 5 W/D/L | No (but feeds the xG form bump) | cron `scrape_form.py` |
| **h2h** | `h2h.json → [{date,score_a,score_b,winner}]` | display, last 5; pill from `winner` | No | cron `scrape_h2h.py` |
| **scorers** | `scorers.json → [{name,goals,club}]` | display, top 3 | No | cron `scrape_scorers.py` (live-only) |
| **referee + ref-bias** | `match_referees.json → ref_id`; `referees.json → {name,nationality,confederation,history[]}` | **client-side z-scores** (below) | No | cron `scrape_referees.py` |
| **weather** | `weather.json[venue_id][date] → {temp_c,condition_code,humidity_pct,wind_kph}` | `°F=round(°C·9/5+32)`, WMO code map | No | cron `scrape_weather.py` (Open-Meteo) |
| **travel-rest / fatigue** | `fatigue.json → {days_since_last_match, km_flown_to_this_venue}` | display; haversine km, days/86400 | No | cron `compute_fatigue.py` |
| **injuries** (`#/injuries`) | `injuries.json → by_team[team][{player,injury,status,return}]` | regex severity bucketing (out/tear→high, doubt/knock→med) | No | cron `scrape_injuries.py` (hourly) |
| **upset-badge** | `group_matchups.json → upset_risk.indicators[{type,severity,label,detail}]` | display only | No (informational) | **indicators hand-committed**; favored/underdog/gap are cron |
| **model-market-divergence** | `group_matchups.json` probs + `markets.json → match_outcomes.{team_a_prob,draw_prob,team_b_prob}` | `delta=round(model−market)` pp; agree ≤3 / warn ≤8 / disagree; hybrid `w·model+(1−w)·market` (w=0.5) | comparison + hybrid pick | `markets.json` cron + always re-fetched |

## Equations worth calling out

**xG** (`scripts/compute_xg.py`): `BASE_XG 1.45`, `GAP_COEF 0.045`; `team_a_xg =
1.45 + 0.045·gap`, `team_b_xg = 1.45 − 0.045·gap` (`gap = composite_a −
composite_b`). Recent-form bump per side: `f = Σ(W=3,D=1,L=0 over last 5)`, `bump
= (f − 7.5)·0.04`. Clamp `[0.2, 4.5]`. (Currently `used_form_*: false` — form.json
empty pre-tournament.)

**Referee bias** (`app/ref-bias.js` — the only in-browser analytic):
- Cards against a team: `yellows + 2·reds`.
- `z_cards = (mean_cards_against − 2.9) / 1.4`; `z_pens = (mean_pens − 0.22) /
  0.18` (priors: cards mean 2.9 / sd 1.4, pens mean 0.22 / sd 0.18).
- Confidence by sample size: `n≥5 high, 2–4 medium, ≤1 low`.
- Confederation lean: `cards_delta_pct = (own − other)/other·100` over teams in
  the ref's confederation vs others (confidence `n≥30 high, ≥10 medium`).
- Confederation map is a **hardcoded static lookup** (teams.json lacks it).

**Fatigue** (`scripts/compute_fatigue.py`): `days_since_last_match =
(kickoff − prev_kickoff)/86400`; `km_flown` = haversine great-circle between venue
lat/lon (`EARTH_RADIUS_KM 6371.0088`); `null` for each team's first match.

**Divergence / hybrid** (`app/markets.js`, `app/hybrid-model.js`): `delta =
round(modelProb − marketProb)` pp; class `≤3 agree / ≤8 warn / else disagree`.
Hybrid pick: market triplet normalized to sum 1, then `blended = w·model +
(1−w)·market` per outcome (`DEFAULT_WEIGHT 0.5`), argmax; falls back to pure model
when the match market is missing (which is currently always — see Kalshi stub).

## Notable findings
- **`upset_risk.indicators` is not produced by any script.** `rebuild_composite.py`
  only maintains `favored/underdog/gap` (via `setdefault`, never overwriting
  `indicators`). The indicator objects ("Toss-up game", etc.) are **hand-seeded**
  into `group_matchups.json`. The `detail` references the live `gap`, but the text
  itself is static.
- Empty pre-tournament (graceful fallbacks): `form.json`, `h2h.json`,
  `scorers.json`, `weather.json` venue blocks, `referees`/`match_referees`,
  `injuries.by_team`.
