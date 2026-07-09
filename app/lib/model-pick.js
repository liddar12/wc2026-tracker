/* model-pick.js — per-match "who's favored + confidence" for ANY active model,
   so views (matchup pill, etc.) follow the selected/default model instead of
   hard-coding hybrid.

   Returns { side: 'team_a'|'draw'|'team_b', prob_pct, source } or null.

   Per-match W/D/L math mirrors the server (build_hybrid.wdl: MU=0.30, BETA=0.70)
   on a z-scored rating gap, so client probs match what the pipeline computes:
     - stack : learned J5L+DT blend strength (data/stacker.json)  ← the default
     - j5l   : the composite probabilities persisted on the match row
     - hybrid: hybridProb() (⅓ blend + live market)
     - dt    : z-scored DT rating gap
     - kalshi: tournament-winner implied strengths (2-way share)
*/
import { hybridProb } from '../hybrid-model.js';
import { getActiveModel } from './active-model.js';
import { dtRatingsByTeam } from './dt-model.js';

const MU = 0.30;
const BETA = 0.70;
const LOG_FACT = [0];
for (let k = 1; k <= 10; k++) LOG_FACT[k] = LOG_FACT[k - 1] + Math.log(k);
const pois = (k, lam) => Math.exp(k * Math.log(lam) - lam - LOG_FACT[k]);

// Analytic bivariate-Poisson W/D/L for a rating gap (A win, draw, B win).
export function wdl(gap) {
  const sup = BETA * gap;
  const la = Math.exp(MU + sup / 2);
  const lb = Math.exp(MU - sup / 2);
  const pa = []; const pb = [];
  for (let k = 0; k <= 10; k++) { pa[k] = pois(k, la); pb[k] = pois(k, lb); }
  let h = 0; let d = 0; let a = 0;
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const p = pa[i] * pb[j];
      if (i > j) h += p; else if (i === j) d += p; else a += p;
    }
  }
  const t = h + d + a || 1;
  return [h / t, d / t, a / t];
}

function fromTriplet(pa, pd, pb) {
  const sides = [['team_a', pa], ['draw', pd], ['team_b', pb]].sort((x, y) => y[1] - x[1]);
  return { side: sides[0][0], prob_pct: Math.round(sides[0][1] * 100) };
}

// Stack per-match probabilities from the learned blend strengths.
export function stackMatchProb(data, a, b) {
  const s = data?.stacker?.strengths || {};
  const sa = s[a]; const sb = s[b];
  if (typeof sa !== 'number' || typeof sb !== 'number') return null;
  const [pa, pd, pb] = wdl(sa - sb);
  return { ...fromTriplet(pa, pd, pb), source: 'stack' };
}

function dtMatchProb(data, a, b) {
  const byTeam = dtRatingsByTeam(data);
  const ratings = Object.values(byTeam).map((r) => r.rating).filter((v) => typeof v === 'number');
  if (ratings.length < 2 || !byTeam[a] || !byTeam[b]) return null;
  const mean = ratings.reduce((s, v) => s + v, 0) / ratings.length;
  const sd = Math.sqrt(ratings.reduce((s, v) => s + (v - mean) ** 2, 0) / ratings.length) || 1;
  const [pa, pd, pb] = wdl((byTeam[a].rating - byTeam[b].rating) / sd);
  return { ...fromTriplet(pa, pd, pb), source: 'dt' };
}

function j5lMatchProb(match) {
  const p = match?.probabilities;
  if (!p || typeof p.team_a_wins !== 'number') return null;
  return { ...fromTriplet((p.team_a_wins || 0) / 100, (p.draw || 0) / 100, (p.team_b_wins || 0) / 100), source: 'j5l' };
}

function kalshiMatchProb(data, a, b) {
  const rows = data?.markets?.tournament_winner || [];
  const by = {};
  for (const r of rows) if (r?.team && typeof r.prob_pct === 'number') by[r.team] = r.prob_pct;
  const pa = by[a]; const pb = by[b];
  if (typeof pa !== 'number' || typeof pb !== 'number' || pa + pb === 0) return null;
  const share = pa / (pa + pb);
  return { side: share >= 0.5 ? 'team_a' : 'team_b', prob_pct: Math.round(Math.max(share, 1 - share) * 100), source: 'kalshi' };
}

/** Per-match pick for a given model (defaults to the active model). */
export function modelPickForMatch(match, data, model) {
  model = model || getActiveModel();
  const a = match?.team_a; const b = match?.team_b;
  switch (model) {
    case 'stack':  return stackMatchProb(data, a, b) || j5lMatchProb(match);
    case 'hybrid': return hybridProb(match, data?.markets);
    case 'dt':     return dtMatchProb(data, a, b) || j5lMatchProb(match);
    case 'kalshi': return kalshiMatchProb(data, a, b) || j5lMatchProb(match);
    case 'j5l':
    default:       return j5lMatchProb(match);
  }
}
