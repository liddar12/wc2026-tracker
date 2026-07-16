/* luck-index.js — descriptive per-team "luck" profile from group-stage data.
 *
 * DISPLAY-ONLY by design: backtested from the R32 (28 knockout matches), a
 * luck weighting adds no predictive value over the stack model (permutation
 * p≈0.28; strictly worse once strength is partialled out — raw "luck"
 * correlates +0.56 with strength via corners/fouls dominance). So this NEVER
 * feeds projections; it explains how a team got here. Full methodology and
 * backtest tables: docs/LUCK_ANALYSIS.md.
 *
 * Components (group-stage per-match rates, z-scored across teams, + = lucky):
 *   pens_for / pens_against  scored penalties awarded for / against (pen-goal)
 *   corners_for/_against     corners won / conceded (matchStats)
 *   foul_diff                fouls drawn − committed (favorable-whistle proxy)
 *   card_diff                opponent cards − own cards (yellow=1, red=2)
 *   own_goal_gifts           opponent own-goals received
 *   finish_luck              goals scored − pre-match model xG
 *   concede_luck             opponent pre-match xG − goals conceded
 */
import { isSlotPlaceholder, lookupActual } from '../bracket-resolver.js';
import { isFinalStatus } from './match-status.js';

const KO_STAGES = new Set(['round_of_32', 'round_of_16', 'quarterfinals', 'semifinals', 'third_place', 'final']);

// sign: +1 means a higher rate is lucky
export const LUCK_COMPONENTS = {
  pens_for: +1, pens_against: -1,
  corners_for: +1, corners_against: -1,
  foul_diff: +1, card_diff: +1,
  own_goal_gifts: +1, finish_luck: +1, concede_luck: +1,
};

export const LUCK_LABELS = {
  pens_for: ['penalty awarded', 'no penalties won'],
  pens_against: ['no penalties faced', 'penalty conceded'],   // sign −1: low value is lucky
  corners_for: ['corner edge', 'few corners won'],
  corners_against: ['few corners faced', 'corner pressure'],
  foul_diff: ['friendly whistle', 'harsh whistle'],
  card_diff: ['card edge', 'card trouble'],
  own_goal_gifts: ['own-goal gift', ''],
  finish_luck: ['hot finishing', 'cold finishing'],
  concede_luck: ['defense over-performing', 'leaking soft goals'],
};

function stageMap(data) {
  const m = new Map();
  for (const row of data?.scheduleFull || []) {
    if (row?.team_a && row?.team_b) m.set(`${row.team_a}__vs__${row.team_b}`, row.stage);
  }
  return m;
}

const isGroup = (stages, key) => {
  if (!key.includes('__vs__')) return false;
  if (stages.has(key)) return stages.get(key) === 'group';
  const [a, b] = key.split('__vs__');
  return stages.get(`${b}__vs__${a}`) === 'group';
};

/** Group-stage luck profile for every team with ≥2 group matches of stats.
 *  Returns { teams: { [team]: { index, z: {component: z}, played } } }. */
export function computeLuckIndex(data) {
  const stages = stageMap(data);
  const acc = {}; // team -> raw tallies
  const T = (t) => (acc[t] = acc[t] || {
    played: 0, xgPlayed: 0,
    pens_for: 0, pens_against: 0, corners_for: 0, corners_against: 0,
    fouls_drawn: 0, fouls_committed: 0, cards: 0, opp_cards: 0,
    own_goal_gifts: 0, finish_luck: 0, concede_luck: 0,
  });

  for (const [key, row] of Object.entries(data?.matchStats || {})) {
    if (!isGroup(stages, key) || !row?.team_a || !row?.team_b) continue;
    const sa = row.stats_a || {}; const sb = row.stats_b || {};
    if (typeof sa.corners !== 'number' && typeof sa.fouls !== 'number') continue;
    const a = T(row.team_a); const b = T(row.team_b);
    a.played++; b.played++;
    a.corners_for += sa.corners || 0; a.corners_against += sb.corners || 0;
    b.corners_for += sb.corners || 0; b.corners_against += sa.corners || 0;
    a.fouls_committed += sa.fouls || 0; a.fouls_drawn += sb.fouls || 0;
    b.fouls_committed += sb.fouls || 0; b.fouls_drawn += sa.fouls || 0;
  }

  for (const [key, row] of Object.entries(data?.matchEvents || {})) {
    if (!isGroup(stages, key)) continue;
    const [ka, kb] = key.split('__vs__');
    if (!acc[ka] || !acc[kb]) continue; // rate base comes from stats coverage
    for (const e of row?.events || []) {
      const team = e?.team === ka ? ka : e?.team === kb ? kb : null;
      if (!team) continue;
      const other = team === ka ? kb : ka;
      if (e.type === 'pen-goal') { acc[team].pens_for++; acc[other].pens_against++; }
      else if (e.type === 'yellow') { acc[team].cards += 1; acc[other].opp_cards += 1; }
      else if (e.type === 'red') { acc[team].cards += 2; acc[other].opp_cards += 2; }
      else if (e.type === 'own-goal') acc[other].own_goal_gifts++;
    }
  }

  const gs = data?.actualResults?.group_stage || {};
  for (const [key, rec] of Object.entries(gs)) {
    if (!isFinalStatus(rec)) continue;
    const [a, b] = key.split('__vs__');
    if (!acc[a] || !acc[b]) continue;
    const x = (data?.xg || {})[key] || (data?.xg || {})[`${b}__vs__${a}`];
    if (!x || x.team_a !== a) continue;
    const sa = rec.score_a; const sb = rec.score_b;
    if (typeof sa !== 'number' || typeof sb !== 'number') continue;
    acc[a].xgPlayed++; acc[b].xgPlayed++;
    acc[a].finish_luck += sa - x.team_a_xg; acc[b].finish_luck += sb - x.team_b_xg;
    acc[a].concede_luck += x.team_b_xg - sb; acc[b].concede_luck += x.team_a_xg - sa;
  }

  const teams = Object.keys(acc).filter((t) => acc[t].played >= 2);
  if (teams.length < 4) return { teams: {} }; // not enough sample to z-score

  const rates = {};
  for (const t of teams) {
    const r = acc[t]; const per = (v) => v / r.played;
    rates[t] = {
      pens_for: per(r.pens_for), pens_against: per(r.pens_against),
      corners_for: per(r.corners_for), corners_against: per(r.corners_against),
      foul_diff: per(r.fouls_drawn) - per(r.fouls_committed),
      card_diff: per(r.opp_cards) - per(r.cards),
      own_goal_gifts: per(r.own_goal_gifts),
      finish_luck: r.xgPlayed ? r.finish_luck / r.xgPlayed : 0,
      concede_luck: r.xgPlayed ? r.concede_luck / r.xgPlayed : 0,
    };
  }

  const z = {};
  for (const comp of Object.keys(LUCK_COMPONENTS)) {
    const vals = teams.map((t) => rates[t][comp]);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) || 1;
    z[comp] = Object.fromEntries(teams.map((t) => [t, (rates[t][comp] - mean) / sd]));
  }

  const out = {};
  const comps = Object.entries(LUCK_COMPONENTS);
  for (const t of teams) {
    const zs = Object.fromEntries(comps.map(([c, sign]) => [c, sign * z[c][t]]));
    const index = comps.reduce((s, [c]) => s + zs[c], 0) / comps.length;
    out[t] = { index, z: zs, played: acc[t].played };
  }
  // Rank (1 = luckiest) so the UI can say "5th luckiest of 48 teams" — plain
  // language beats a σ score for non-statistical readers.
  const ordered = Object.keys(out).sort((a, b) => out[b].index - out[a].index);
  ordered.forEach((t, i) => { out[t].rank = i + 1; out[t].total = ordered.length; });
  return { teams: out };
}

const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

/** "5th luckiest of 48 teams" — plain-language standing for one profile. */
export function luckStanding(profile) {
  if (!profile?.rank) return '';
  return `${ordinal(profile.rank)} luckiest of ${profile.total} teams`;
}

/** Plain-language head-to-head: how much luckier one side has been than the
 *  other, in words a non-statistical reader gets. Null without both profiles. */
export function compareLuckPlain(teamA, teamB, profA, profB) {
  if (!profA || !profB) return null;
  const d = profA.index - profB.index;
  const [lead, trail] = d >= 0 ? [teamA, teamB] : [teamB, teamA];
  const gap = Math.abs(d);
  if (gap < 0.15) return `${teamA} and ${teamB} have had about the same amount of luck so far.`;
  if (gap < 0.4) return `${lead} has caught slightly more breaks than ${trail} so far.`;
  if (gap < 0.8) return `${lead} has been noticeably luckier than ${trail} this tournament.`;
  return `${lead} has been far luckier than ${trail} this tournament.`;
}

/** Teams still alive: named on both sides of an unplayed knockout match. */
export function remainingKnockoutTeams(data) {
  const out = new Set();
  for (const m of data?.scheduleFull || []) {
    if (!KO_STAGES.has(m?.stage)) continue;
    const a = m.team_a; const b = m.team_b;
    if (isSlotPlaceholder(a) || isSlotPlaceholder(b)) continue;
    const rec = lookupActual(data, m.stage, a, b);
    if (rec?.winner) continue;
    out.add(a); out.add(b);
  }
  return [...out];
}

/** Live per-match luck ledger for ONE fixture — the "change of luck" panel on
 *  the matchup page. Reads whatever exists NOW (live-merged score, cron-fed
 *  events/stats), so it grows during the match and re-renders on live refresh.
 *  Returns { [team]: [{ label, detail, lucky }] } or null before any signal. */
export function matchLuckLedger(data, match) {
  const a = match?.team_a; const b = match?.team_b;
  if (!a || !b) return null;
  const k1 = `${a}__vs__${b}`; const k2 = `${b}__vs__${a}`;
  const out = { [a]: [], [b]: [] };
  const push = (team, label, detail, lucky) => out[team].push({ label, detail, lucky });

  const ev = (data?.matchEvents?.[k1] || data?.matchEvents?.[k2])?.events || [];
  const tally = { [a]: { pens: 0, cards: 0, og: 0 }, [b]: { pens: 0, cards: 0, og: 0 } };
  for (const e of ev) {
    const t = tally[e?.team]; if (!t) continue;
    if (e.type === 'pen-goal') t.pens++;
    else if (e.type === 'yellow') t.cards += 1;
    else if (e.type === 'red') t.cards += 2;
    else if (e.type === 'own-goal') t.og++;
  }
  for (const [team, other] of [[a, b], [b, a]]) {
    if (tally[team].pens) push(team, 'pen awarded', `×${tally[team].pens}`, true);
    if (tally[team].og) push(team, 'own goal', `×${tally[team].og}`, false);
    if (tally[other].og) push(team, 'own-goal gift', `×${tally[other].og}`, true);
  }
  const cardDiff = tally[b].cards - tally[a].cards; // + = A has the edge
  if (cardDiff > 0) { push(a, 'card edge', `+${cardDiff}`, true); push(b, 'card burden', `−${cardDiff}`, false); }
  else if (cardDiff < 0) { push(b, 'card edge', `+${-cardDiff}`, true); push(a, 'card burden', `−${-cardDiff}`, false); }

  const st = data?.matchStats?.[k1] || data?.matchStats?.[k2];
  if (st?.team_a) {
    const sA = st.team_a === a ? st.stats_a : st.stats_b;
    const sB = st.team_a === a ? st.stats_b : st.stats_a;
    const corn = (sA?.corners ?? null) !== null && (sB?.corners ?? null) !== null ? sA.corners - sB.corners : null;
    if (corn > 2) { push(a, 'corner edge', `+${corn}`, true); }
    else if (corn < -2) { push(b, 'corner edge', `+${-corn}`, true); }
    const foul = (sA?.fouls ?? null) !== null && (sB?.fouls ?? null) !== null ? sB.fouls - sA.fouls : null;
    if (foul > 3) { push(a, 'friendly whistle', `+${foul} fouls drawn`, true); push(b, 'harsh whistle', `−${foul}`, false); }
    else if (foul < -3) { push(b, 'friendly whistle', `+${-foul} fouls drawn`, true); push(a, 'harsh whistle', `−${-foul}`, false); }
  }

  // Score vs pre-match model xG — live: updates with every merged score tick.
  const tier = data?.actualResults?.[match.stage === 'group' || !match.stage ? 'group_stage' : match.stage] || {};
  const rec = tier[k1] || tier[k2];
  const x = (data?.xg || {})[k1] || (data?.xg || {})[k2];
  if (rec && rec.status !== 'STATUS_SCHEDULED' && x?.team_a) {
    const flip = !tier[k1];
    const sa = flip ? rec.score_b : rec.score_a; const sb = flip ? rec.score_a : rec.score_b;
    const xa = x.team_a === a ? x.team_a_xg : x.team_b_xg;
    const xb = x.team_a === a ? x.team_b_xg : x.team_a_xg;
    if (typeof sa === 'number' && typeof xa === 'number') {
      const fa = sa - xa; const fb = sb - xb;
      if (fa >= 0.75) push(a, 'hot finishing', `+${fa.toFixed(1)} vs xG`, true);
      else if (fa <= -0.75) push(a, 'cold finishing', `${fa.toFixed(1)} vs xG`, false);
      if (fb >= 0.75) push(b, 'hot finishing', `+${fb.toFixed(1)} vs xG`, true);
      else if (fb <= -0.75) push(b, 'cold finishing', `${fb.toFixed(1)} vs xG`, false);
    }
  }

  return out[a].length || out[b].length ? out : null;
}

/** Top |z| component chips for a team's luck row (default: up to 2, |z|≥0.8). */
export function luckChips(profile, { max = 2, minZ = 0.8 } = {}) {
  if (!profile?.z) return [];
  return Object.entries(profile.z)
    .filter(([c, v]) => Math.abs(v) >= minZ && LUCK_LABELS[c][v >= 0 ? 0 : 1])
    .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
    .slice(0, max)
    .map(([c, v]) => ({ component: c, z: v, label: LUCK_LABELS[c][v >= 0 ? 0 : 1] }));
}
