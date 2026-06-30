/* markets.js — helpers for Kalshi market data in the UI. */

const LS_MODEL_HISTORY = 'wc26.model_conf_history';
const MAX_HISTORY = 30;

export function winnerByTeam(markets) {
  const map = new Map();
  for (const row of markets?.tournament_winner || []) {
    if (row?.team) map.set(row.team, row);
  }
  return map;
}

export function matchOutcomeKey(match) {
  const a = match.team_a;
  const b = match.team_b;
  return `${a}__vs__${b}`;
}

export function getMatchOutcome(markets, match) {
  const outcomes = markets?.match_outcomes;
  if (!outcomes || typeof outcomes !== 'object') return null;
  const key = matchOutcomeKey(match);
  const rev = `${match.team_b}__vs__${match.team_a}`;
  return outcomes[key] || outcomes[rev] || null;
}

/* mergedMarkets(data) — the markets object the matchup-detail market bar +
 * divergence read, with Polymarket per-match outcomes overlaid UNDER Kalshi
 * (Kalshi wins on conflict — it's the attributed source in the UI). This lights
 * up the bar for Polymarket-only fixtures while keeping Kalshi authoritative
 * where both price a match. Top-level markets fields (tournament_winner, source,
 * updated_at) are preserved so the rest of the detail UI is unchanged. Safe when
 * either feed is absent. */
export function mergedMarkets(data) {
  const markets = data?.markets && typeof data.markets === 'object' ? data.markets : {};
  const poly = data?.polymarketOdds?.match_outcomes;
  const kalshi = markets.match_outcomes;
  if (!poly || typeof poly !== 'object') return markets;
  // Polymarket first, Kalshi second → Kalshi overwrites on conflicting keys.
  const match_outcomes = {
    ...poly,
    ...(kalshi && typeof kalshi === 'object' ? kalshi : {}),
  };
  return { ...markets, match_outcomes };
}

export function modelOutcomeProb(match) {
  const p = match.probabilities;
  if (match.predicted_winner === 'draw_likely') return { side: 'draw', prob: p.draw };
  if (match.predicted_winner === match.team_a) return { side: 'team_a', prob: p.team_a_wins };
  if (match.predicted_winner === match.team_b) return { side: 'team_b', prob: p.team_b_wins };
  return { side: 'team_a', prob: p.team_a_wins };
}

export function marketOutcomeProb(outcome, side) {
  if (!outcome) return null;
  if (side === 'draw') return outcome.draw_prob;
  if (side === 'team_a') return outcome.team_a_prob;
  if (side === 'team_b') return outcome.team_b_prob;
  return null;
}

export function divergenceClass(deltaPp) {
  const abs = Math.abs(deltaPp);
  if (abs <= 3) return 'div-agree';
  if (abs <= 8) return 'div-warn';
  return 'div-disagree';
}

export function formatDivergence(modelProb, marketProb) {
  if (marketProb == null) return null;
  const delta = Math.round(modelProb - marketProb);
  const sign = delta > 0 ? '+' : '';
  return {
    modelProb: Math.round(modelProb),
    marketProb: Math.round(marketProb),
    delta,
    label: `Model ${Math.round(modelProb)}% · Market ${Math.round(marketProb)}% · ${sign}${delta} pp`,
    className: divergenceClass(delta),
  };
}

export function sparklineForMatch(markets, match) {
  const winners = winnerByTeam(markets);
  const pick = modelOutcomeProb(match);
  let team = match.team_a;
  if (pick.side === 'team_b') team = match.team_b;
  else if (pick.side === 'draw') {
    team = match.predicted_winner === match.team_a ? match.team_a : match.team_b;
  }
  const row = winners.get(team);
  if (row?.sparkline?.length) return row.sparkline;
  return getModelHistory(match);
}

function historyKey(match) {
  return match.match_id || matchOutcomeKey(match);
}

export function recordModelConfidence(match) {
  const key = historyKey(match);
  let all;
  try {
    all = JSON.parse(localStorage.getItem(LS_MODEL_HISTORY) || '{}');
  } catch {
    all = {};
  }
  const hist = all[key] || [];
  const val = match.win_confidence_pct / 100;
  if (hist.length && hist[hist.length - 1] === val) return;
  hist.push(val);
  if (hist.length > MAX_HISTORY) hist.splice(0, hist.length - MAX_HISTORY);
  all[key] = hist;
  try {
    localStorage.setItem(LS_MODEL_HISTORY, JSON.stringify(all));
  } catch { /* quota */ }
}

export function getModelHistory(match) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_MODEL_HISTORY) || '{}');
    const hist = all[historyKey(match)];
    if (Array.isArray(hist) && hist.length) return hist;
  } catch { /* ignore */ }
  const v = match.win_confidence_pct / 100;
  return Array(8).fill(v);
}

export function kalshiAttribution() {
  const el = document.createElement('p');
  el.className = 'kalshi-attr muted';
  el.innerHTML = 'Odds from <a href="https://kalshi.com/markets/kxmwc" target="_blank" rel="noopener">prediction markets</a>';
  return el;
}
