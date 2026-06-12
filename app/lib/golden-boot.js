/* golden-boot.js — R19: Golden Boot (top scorer) projector + live odds.
 *
 * Pure + deterministic (seeded) so it's unit-testable and recomputes live as
 * data refreshes. Reads existing data files only — no new backend.
 *
 * Model: project each contender's tournament goals from backtestable factors,
 * then a seeded Monte-Carlo (Poisson per contender) estimates each player's
 * chance to finish as top scorer (the "boot %").
 *
 *   projGoals = currentGoals(live) + perMatchRate × expectedMatches
 *               × oppDefenseFactor × xgEnvFactor × (1 + setPieceBonus)
 *
 * Factors (each maps to data the user wanted backtested):
 *   finishing      players.json `scoring` + position weight   (elite finishers)
 *   expectedMatches teams.json composite → deep run            (more games = more goals)
 *   oppDefense     group opponents' teams.position_ratings.def (weak defenses)
 *   xgEnv          xg.json total xG of the team's matches      (high-scoring games)
 *   setPiece       team's top scorer ≈ penalty taker (HEURISTIC, flagged)
 *   live           scorers.json / actual_results                (during tournament)
 */

// ---- config (defaults; the backtest harness will tune these) ----------------
export const GB_CONFIG = {
  baseRate: 0.70,        // goals/match for a 100-scoring FWD vs an average defense
  scoringExp: 2.0,       // steepness — rewards elite finishing
  posWeight: { FWD: 1.0, MID: 0.55, DEF: 0.15, GK: 0.0 },
  minMatches: 3,         // group-stage exit
  maxMatches: 7,         // finalist
  setPieceBonus: 0.12,   // top scorer ≈ penalty taker (heuristic)
  oppDefClamp: [0.7, 1.4],
  xgEnvClamp: [0.8, 1.25],
  contenderPool: 120,    // cap for the Monte-Carlo
  sims: 10000,
  marketWeight: 0.5,     // blend weight for the Kalshi Golden Boot market (independent signal)
};

// ---- Kalshi Golden Boot market (independent signal) -------------------------
function normName(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').trim();
}
function surnameOf(s) { const p = normName(s).split(' ').filter(Boolean); return p[p.length - 1] || ''; }

/** Build {full→pct, surname→pct} from data.markets.goal_leader, or null if absent. */
export function goalLeaderMarket(data) {
  const rows = data?.markets?.goal_leader || [];
  if (!rows.length) return null;
  const byFull = {}, bySurname = {};
  for (const r of rows) {
    if (!r?.player || typeof r.prob_pct !== 'number') continue;
    byFull[normName(r.player)] = r.prob_pct;
    bySurname[surnameOf(r.player)] = (bySurname[surnameOf(r.player)] || 0) + r.prob_pct;
  }
  return { byFull, bySurname };
}
function marketPctFor(market, name) {
  if (!market) return 0;
  return market.byFull[normName(name)] ?? market.bySurname[surnameOf(name)] ?? 0;
}

// ---- seeded RNG (mulberry32) + Poisson (Knuth) ------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(lambda, rng) {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

// ---- team / tournament context ---------------------------------------------
function clamp(x, [lo, hi]) { return Math.min(hi, Math.max(lo, x)); }

export function buildContext(data, cfg = GB_CONFIG) {
  const teams = data?.teams || {};
  const names = Object.keys(teams);
  const defs = names.map((n) => teams[n]?.position_ratings?.def).filter((x) => typeof x === 'number');
  const leagueDef = defs.length ? defs.reduce((a, b) => a + b, 0) / defs.length : 60;
  const comps = names.map((n) => teams[n]?.composite).filter((x) => typeof x === 'number');
  const minC = comps.length ? Math.min(...comps) : 50;
  const maxC = comps.length ? Math.max(...comps) : 90;

  // Expected matches (deep-run): prefer the hybrid forecast — 3 group games + the
  // sum of knockout round-reach probabilities (a principled expected-games count
  // for the 48-team format, where a finalist plays 8). Fall back to a composite
  // interpolation when forecast.json isn't loaded.
  const fc = {};
  for (const r of (data?.forecast?.teams || [])) {
    if (r?.team) {
      fc[r.team] = 3 + (r.r32 || 0) + (r.r16 || 0) + (r.qf || 0) + (r.sf || 0) + (r.final || 0);
    }
  }
  const expectedMatches = {};
  for (const n of names) {
    if (fc[n] != null) { expectedMatches[n] = fc[n]; continue; }
    const c = teams[n]?.composite ?? minC;
    const t = maxC > minC ? (c - minC) / (maxC - minC) : 0.5;
    expectedMatches[n] = cfg.minMatches + t * (cfg.maxMatches - cfg.minMatches);
  }

  // group opponents (from group_matchups) → avg opponent defensive weakness
  const gm = data?.groupMatchups || {};
  const oppDefFactor = {};
  for (const n of names) {
    const grp = teams[n]?.group;
    const teammates = (gm[grp]?.teams || []).filter((t) => t !== n);
    if (!teammates.length) { oppDefFactor[n] = 1; continue; }
    const factors = teammates.map((o) => {
      const od = teams[o]?.position_ratings?.def ?? leagueDef;
      return clamp(leagueDef / (od || leagueDef), cfg.oppDefClamp); // weaker opp def → >1
    });
    oppDefFactor[n] = factors.reduce((a, b) => a + b, 0) / factors.length;
  }

  // xG scoring environment per team (avg total xG over its matches in xg.json)
  const xg = data?.xg || {};
  const xgTotals = {};
  for (const key of Object.keys(xg)) {
    const r = xg[key];
    const total = (r?.team_a_xg || 0) + (r?.team_b_xg || 0);
    for (const side of [r?.team_a, r?.team_b]) {
      if (!side) continue;
      (xgTotals[side] = xgTotals[side] || []).push(total);
    }
  }
  const allTotals = Object.values(xgTotals).flat();
  const leagueXg = allTotals.length ? allTotals.reduce((a, b) => a + b, 0) / allTotals.length : 2.6;
  const xgEnvFactor = {};
  for (const n of names) {
    const arr = xgTotals[n];
    const avg = arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : leagueXg;
    xgEnvFactor[n] = clamp(avg / (leagueXg || 2.6), cfg.xgEnvClamp);
  }

  return { teams, leagueDef, expectedMatches, oppDefFactor, xgEnvFactor };
}

// ---- live goals lookup -------------------------------------------------------
// Accent/punctuation-insensitive key so ESPN's "Julián Quiñones" credits the
// squad list's "Julian Quinones" (and vice versa).
export function normPlayerName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

// Two sources, merged by normalized name taking the MAX (they count the SAME
// tournament goals): scorers.json (ESPN team top-scorers — historically slow
// to populate) and match_events.json goal events (live within ~15 min). The
// events source is what guarantees today's scorers appear even when the
// scorers feed is empty.
export function liveGoalsByPlayer(data) {
  const raw = {}; // normalized key → { name (first-seen raw), goals }
  const credit = (name, goals) => {
    const nk = normPlayerName(name);
    if (!nk || !Number.isFinite(goals)) return;
    if (!(nk in raw) || goals > raw[nk].goals) raw[nk] = { name: raw[nk]?.name || name, goals };
  };

  const s = data?.scorers;
  if (Array.isArray(s)) {
    const acc = {};
    for (const r of s) { const k = r?.player || r?.name; if (k) acc[k] = (acc[k] || 0) + (r.goals || 0); }
    for (const [k, v] of Object.entries(acc)) credit(k, v);
  } else if (s && typeof s === 'object') {
    for (const [k, v] of Object.entries(s)) {
      if (k === '__meta__') continue;
      if (typeof v === 'number') credit(k, v);
      else if (v && typeof v === 'object' && typeof v.goals === 'number') credit(k, v.goals);
    }
  }

  const me = data?.matchEvents;
  if (me && typeof me === 'object') {
    const acc = {};
    for (const [k, rec] of Object.entries(me)) {
      if (k === '__meta__' || !Array.isArray(rec?.events)) continue;
      for (const e of rec.events) {
        if ((e.type === 'goal' || e.type === 'pen-goal') && e.player) {
          acc[e.player] = (acc[e.player] || 0) + 1;
        }
      }
    }
    for (const [k, v] of Object.entries(acc)) credit(k, v);
  }

  const out = {};
  for (const { name, goals } of Object.values(raw)) out[name] = goals;
  return out;
}

// ---- per-player projection --------------------------------------------------
export function projectPlayer(player, ctx, live, cfg = GB_CONFIG, topScorerByTeam = null) {
  const pos = player.position;
  const w = cfg.posWeight[pos] ?? 0;
  if (w <= 0) return null; // GKs / non-scorers excluded
  const team = player.team;
  const scoring = typeof player.scoring === 'number' ? player.scoring : (player.offense || 0);
  const perMatch = cfg.baseRate * Math.pow(Math.max(scoring, 0) / 100, cfg.scoringExp) * w;
  const matches = ctx.expectedMatches[team] ?? cfg.minMatches;
  const oppDef = ctx.oppDefFactor[team] ?? 1;
  const xgEnv = ctx.xgEnvFactor[team] ?? 1;
  const isTopScorer = topScorerByTeam && topScorerByTeam[team] === player.name;
  const setPiece = isTopScorer ? cfg.setPieceBonus : 0;
  const projRemaining = perMatch * matches * oppDef * xgEnv * (1 + setPiece);
  const currentGoals = live[player.name] || 0;
  return {
    player: player.name,
    team,
    position: pos,
    currentGoals,
    projRemaining,
    projGoals: currentGoals + projRemaining,
    factors: {
      finishing: Math.round(scoring * 10) / 10,
      deepRun: Math.round(matches * 10) / 10,
      oppDefense: Math.round(oppDef * 100) / 100,
      xgEnv: Math.round(xgEnv * 100) / 100,
      setPiece: isTopScorer,
    },
  };
}

// ---- main entry -------------------------------------------------------------
export function goldenBootProjections(data, opts = {}) {
  const cfg = { ...GB_CONFIG, ...(opts.config || {}) };
  const players = data?.players || [];
  if (!players.length) return [];
  const ctx = buildContext(data, cfg);
  const live = liveGoalsByPlayer(data);

  // heuristic penalty-taker: the highest-`scoring` attacker per team
  const topScorerByTeam = {};
  for (const p of players) {
    if ((cfg.posWeight[p.position] ?? 0) <= 0) continue;
    const cur = topScorerByTeam[p.team];
    if (!cur || (p.scoring || 0) > cur.scoring) topScorerByTeam[p.team] = { name: p.name, scoring: p.scoring || 0 };
  }
  const topNameByTeam = Object.fromEntries(Object.entries(topScorerByTeam).map(([t, v]) => [t, v.name]));

  // Re-key live goals to the squad list's canonical names (accent-insensitive)
  // and keep any scorer who has no players.json entry at all.
  const normToCanonical = {};
  for (const p of players) {
    const nk = normPlayerName(p.name);
    if (nk && !(nk in normToCanonical)) normToCanonical[nk] = p.name;
  }
  const liveCanon = {};
  const unmatchedScorers = [];
  for (const [name, goals] of Object.entries(live)) {
    const canon = normToCanonical[normPlayerName(name)];
    if (canon) liveCanon[canon] = Math.max(liveCanon[canon] || 0, goals);
    else if (goals > 0) unmatchedScorers.push({ name, goals });
  }

  const projected = players
    .map((p) => projectPlayer(p, ctx, liveCanon, cfg, topNameByTeam))
    .filter(Boolean)
    .sort((a, b) => b.projGoals - a.projGoals);
  let contenders = projected.slice(0, cfg.contenderPool);

  // EVERY actual goal-scorer enters the field (and the Monte-Carlo) even if
  // their projection fell outside the contender pool — real goals must always
  // be on the board with real odds.
  const inField = new Set(contenders.map((c) => c.player));
  for (const c of projected.slice(cfg.contenderPool)) {
    if (c.currentGoals > 0 && !inField.has(c.player)) { contenders.push(c); inField.add(c.player); }
  }
  // Scorers missing from the squad list entirely get a conservative synthetic
  // projection so they still appear with honest (small) odds.
  if (unmatchedScorers.length) {
    const teamByScorer = {};
    for (const [k, rec] of Object.entries(data?.matchEvents || {})) {
      if (k === '__meta__' || !Array.isArray(rec?.events)) continue;
      for (const e of rec.events) if (e.player && e.team) teamByScorer[normPlayerName(e.player)] = e.team;
    }
    for (const { name, goals } of unmatchedScorers) {
      if (inField.has(name)) continue;
      contenders.push({
        player: name,
        team: teamByScorer[normPlayerName(name)] || '',
        position: 'FWD',
        currentGoals: goals,
        projRemaining: 1.2,
        projGoals: goals + 1.2,
        factors: { finishing: 0, deepRun: 2.5, oppDefense: 1, xgEnv: 1, setPiece: false, synthetic: true },
      });
      inField.add(name);
    }
  }

  // Monte-Carlo: each sim draws Poisson(projRemaining)+currentGoals; top scorer wins.
  const sims = opts.sims ?? cfg.sims;
  const rng = mulberry32(opts.seed ?? 1234567);
  const wins = new Array(contenders.length).fill(0);
  for (let s = 0; s < sims; s++) {
    let best = -1, bestIdx = [];
    for (let i = 0; i < contenders.length; i++) {
      const g = contenders[i].currentGoals + poisson(contenders[i].projRemaining, rng);
      if (g > best) { best = g; bestIdx = [i]; }
      else if (g === best) bestIdx.push(i);
    }
    const share = 1 / bestIdx.length;
    for (const i of bestIdx) wins[i] += share;
  }
  contenders.forEach((c, i) => {
    c.modelPct = Math.round((wins[i] / sims) * 1000) / 10; // model-only boot %
    c.bootPct = c.modelPct;
    c.projGoals = Math.round(c.projGoals * 10) / 10;
  });

  // Blend the Kalshi Golden Boot market (independent signal) into boot %, then
  // renormalise so the field still sums to ~100%. marketWeight=0 → model only.
  const market = goalLeaderMarket(data);
  const mw = cfg.marketWeight ?? 0;
  if (market && mw > 0) {
    let sum = 0;
    for (const c of contenders) {
      c.marketPct = Math.round(marketPctFor(market, c.player) * 10) / 10;
      c.bootPct = mw * c.marketPct + (1 - mw) * c.modelPct;
      sum += c.bootPct;
    }
    if (sum > 0) contenders.forEach((c) => { c.bootPct = Math.round((c.bootPct / sum) * 1000) / 10; });
    contenders.blendedWithMarket = true;
  }

  contenders.sort((a, b) => b.bootPct - a.bootPct || b.projGoals - a.projGoals);
  contenders.forEach((c, i) => { c.rank = i + 1; });
  return contenders;
}
