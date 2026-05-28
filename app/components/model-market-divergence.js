/* model-market-divergence.js — compact model vs market line. */
import { getMatchOutcome, modelOutcomeProb, marketOutcomeProb, formatDivergence } from '../markets.js';

export function divergenceLine(markets, match) {
  const outcome = getMatchOutcome(markets, match);
  if (!outcome) return null;
  const pick = modelOutcomeProb(match);
  const marketProb = marketOutcomeProb(outcome, pick.side);
  if (marketProb == null) return null;
  const div = formatDivergence(pick.prob, marketProb);
  const el = document.createElement('div');
  el.className = `divergence ${div.className}`;
  el.textContent = div.label;
  return el;
}
