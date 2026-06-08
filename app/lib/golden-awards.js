/* golden-awards.js — Golden Ball, Golden Glove, FIFA Young Player models.
 *
 * Each builds a transparent model score per eligible player from existing data
 * (players.json overall/offense/age/position, teams.json position_ratings,
 * forecast.json deep-run), softmaxes it to a model %, then blends with that
 * award's Kalshi market (markets.awards.*) — market-led for the voted awards
 * (Ball/Young ≈ 65% market), balanced for the stat-driven Glove (≈ 50%).
 * The Golden Boot lives in golden-boot.js (top-scorer Monte-Carlo + KXWCGOALLEADER).
 */

const POSW = { FWD: 1.0, MID: 0.9, DEF: 0.3, GK: 0 };
const BALL_W = { talent: 0.40, attack: 0.35, deep: 0.25 };
const GLOVE_W = { gk: 0.35, teamDef: 0.40, deep: 0.25 };
export const AWARD_MARKET_WEIGHT = { ball: 0.65, glove: 0.50, young: 0.65 };
const YOUNG_MAX_AGE = 21; // FIFA Young Player: 21-and-under

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').trim();
const surname = (s) => { const p = norm(s).split(' ').filter(Boolean); return p[p.length - 1] || ''; };

function zscorer(vals) {
  const v = vals.filter((x) => typeof x === 'number');
  const m = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length || 1)) || 1;
  return (x) => (typeof x === 'number' ? (x - m) / sd : 0);
}
function forecastMap(data) {
  const m = {};
  for (const r of (data?.forecast?.teams || [])) if (r?.team) m[r.team] = r;
  return m;
}
function marketMap(rows) {
  if (!rows || !rows.length) return null;
  const f = {}, s = {};
  for (const r of rows) {
    if (!r?.player || typeof r.prob_pct !== 'number') continue;
    f[norm(r.player)] = r.prob_pct;
    s[surname(r.player)] = (s[surname(r.player)] || 0) + r.prob_pct;
  }
  return { f, s };
}
const mktPct = (map, name) => (map ? (map.f[norm(name)] ?? map.s[surname(name)] ?? 0) : 0);

function softmaxModelPct(items) {
  const xs = items.map((i) => Math.exp(i.mScore));
  const sum = xs.reduce((a, b) => a + b, 0) || 1;
  items.forEach((i, k) => { i.modelPct = Math.round((xs[k] / sum) * 1000) / 10; });
}
/** Blend modelPct with the award market (w = market weight), renormalise to ~100. */
function blendMarket(items, market, w) {
  if (!market || w <= 0) {
    items.forEach((i) => { i.awardPct = i.modelPct; i.marketPct = i.marketPct || 0; });
  } else {
    let sum = 0;
    items.forEach((i) => { i.marketPct = Math.round(mktPct(market, i.player) * 10) / 10; i._b = w * i.marketPct + (1 - w) * i.modelPct; sum += i._b; });
    items.forEach((i) => { i.awardPct = sum > 0 ? Math.round((i._b / sum) * 1000) / 10 : 0; delete i._b; });
    items.blendedWithMarket = true;
  }
  items.sort((a, b) => b.awardPct - a.awardPct || b.modelPct - a.modelPct);
  items.forEach((i, k) => { i.rank = k + 1; });
  return items;
}

// ---- Golden Ball (best player) ---------------------------------------------
export function goldenBall(data, opts = {}) {
  const players = data?.players || [];
  if (!players.length) return [];
  const zOverall = zscorer(players.map((p) => p.overall));
  const zOffense = zscorer(players.map((p) => p.offense));
  const fc = forecastMap(data);
  const zDeep = zscorer(Object.values(fc).map((r) => (r.final || 0) + (r.champion || 0)));
  const items = players
    .filter((p) => (POSW[p.position] ?? 0) > 0 && (opts.maxAge ? (p.age ?? 99) <= opts.maxAge : true))
    .map((p) => {
      const f = fc[p.team] || {};
      const deep = (f.final || 0) + (f.champion || 0);
      const mScore = POSW[p.position] * (
        BALL_W.talent * zOverall(p.overall) + BALL_W.attack * zOffense(p.offense) + BALL_W.deep * zDeep(deep));
      return {
        player: p.name, team: p.team, position: p.position, age: p.age, mScore,
        factors: { talent: Math.round((p.overall || 0) * 10) / 10, deepRun: Math.round(deep * 1000) / 10, pos: p.position },
      };
    })
    .sort((a, b) => b.mScore - a.mScore)
    .slice(0, opts.pool || 120);
  softmaxModelPct(items);
  const w = opts.marketWeight ?? AWARD_MARKET_WEIGHT[opts.maxAge ? 'young' : 'ball'];
  return blendMarket(items, marketMap(opts.maxAge ? data?.markets?.awards?.young_player : data?.markets?.awards?.golden_ball), w);
}

// ---- FIFA Young Player (best U21) ------------------------------------------
export function youngPlayer(data, opts = {}) {
  return goldenBall(data, { ...opts, maxAge: YOUNG_MAX_AGE });
}

// ---- Golden Glove (best GK) ------------------------------------------------
export function goldenGlove(data, opts = {}) {
  const players = data?.players || [];
  const teams = data?.teams || {};
  if (!players.length) return [];
  // one contender per team: the highest-overall GK
  const byTeam = {};
  for (const p of players) {
    if (p.position !== 'GK') continue;
    if (!byTeam[p.team] || (p.overall || 0) > (byTeam[p.team].overall || 0)) byTeam[p.team] = p;
  }
  const gks = Object.values(byTeam);
  if (!gks.length) return [];
  const teamDefRaw = {};
  for (const [t, v] of Object.entries(teams)) {
    const pr = v?.position_ratings || {};
    teamDefRaw[t] = ((pr.gk || 0) + (pr.def || 0)) / 2;
  }
  const zGk = zscorer(gks.map((p) => p.overall));
  const zTeamDef = zscorer(Object.values(teamDefRaw));
  const fc = forecastMap(data);
  const zDeep = zscorer(Object.values(fc).map((r) => (r.sf || 0) + (r.final || 0) + (r.champion || 0)));
  const items = gks.map((p) => {
    const f = fc[p.team] || {};
    const deep = (f.sf || 0) + (f.final || 0) + (f.champion || 0);
    const mScore = GLOVE_W.gk * zGk(p.overall) + GLOVE_W.teamDef * zTeamDef(teamDefRaw[p.team]) + GLOVE_W.deep * zDeep(deep);
    return {
      player: p.name, team: p.team, position: 'GK', mScore,
      factors: { gkRating: Math.round((p.overall || 0) * 10) / 10, teamDef: Math.round((teamDefRaw[p.team] || 0) * 10) / 10, deepRun: Math.round(deep * 1000) / 10 },
    };
  }).sort((a, b) => b.mScore - a.mScore);
  softmaxModelPct(items);
  return blendMarket(items, marketMap(data?.markets?.awards?.golden_glove), opts.marketWeight ?? AWARD_MARKET_WEIGHT.glove);
}
