/* hybrid-model.js — E1: blend the in-house composite with Kalshi market.
   Public API:
     hybridProb(match, markets, opts) -> { side, prob_pct, modelProb, marketProb, weight }
     hybridChoice(match, markets, opts) -> 'team_a' | 'team_b' | 'draw' | null

   The weight is configurable; default 50/50. When market data is missing we
   fall back to pure model. When model and market disagree on direction we
   surface the *blended* prob across all three sides (a, draw, b) and pick the
   max — this prevents nonsense cases where the model says A 55% and market
   says B 60% averaging to 47.5% on A.
*/

import { getMatchOutcome } from './markets.js';

const DEFAULT_WEIGHT = 0.5;
const LS_HYBRID_WEIGHT = 'wc26.hybrid_weight';

export function getStoredWeight() {
  try {
    const v = parseFloat(localStorage.getItem(LS_HYBRID_WEIGHT));
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  } catch {}
  return DEFAULT_WEIGHT;
}

export function setStoredWeight(weight) {
  try { localStorage.setItem(LS_HYBRID_WEIGHT, String(weight)); } catch {}
}

function modelTriplet(match) {
  const p = match?.probabilities || {};
  return {
    a: (p.team_a_wins || 0) / 100,
    d: (p.draw || 0) / 100,
    b: (p.team_b_wins || 0) / 100,
  };
}

function marketTriplet(outcome) {
  if (!outcome) return null;
  const a = outcome.team_a_prob;
  const d = outcome.draw_prob;
  const b = outcome.team_b_prob;
  if (a == null || b == null) return null;
  const total = (a || 0) + (d || 0) + (b || 0);
  if (!total) return null;
  return {
    a: (a || 0) / total,
    d: (d || 0) / total,
    b: (b || 0) / total,
  };
}

export function hybridDistribution(match, markets, opts = {}) {
  const weight = typeof opts.weight === 'number' ? opts.weight : getStoredWeight();
  const model = modelTriplet(match);
  const outcome = getMatchOutcome(markets, match);
  const market = marketTriplet(outcome);
  if (!market) {
    return { a: model.a, d: model.d, b: model.b, weight: 1, source: 'model' };
  }
  const w = Math.max(0, Math.min(1, weight));
  return {
    a: w * model.a + (1 - w) * market.a,
    d: w * model.d + (1 - w) * market.d,
    b: w * model.b + (1 - w) * market.b,
    weight: w,
    source: 'hybrid',
  };
}

export function hybridProb(match, markets, opts = {}) {
  const dist = hybridDistribution(match, markets, opts);
  const sides = [
    { side: 'team_a', prob: dist.a },
    { side: 'draw', prob: dist.d },
    { side: 'team_b', prob: dist.b },
  ];
  sides.sort((x, y) => y.prob - x.prob);
  const winner = sides[0];
  return {
    side: winner.side,
    prob_pct: Math.round(winner.prob * 100),
    distribution: { a: dist.a, d: dist.d, b: dist.b },
    weight: dist.weight,
    source: dist.source,
  };
}

export function hybridChoice(match, markets, opts = {}) {
  const r = hybridProb(match, markets, opts);
  return r?.side || null;
}
