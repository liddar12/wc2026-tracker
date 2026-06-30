/* model-market-divergence.js — compact model vs market line. */
import { getMatchOutcome, modelOutcomeProb, marketOutcomeProb, formatDivergence } from '../markets.js';

export function divergenceLine(markets, match) {
  const outcome = getMatchOutcome(markets, match);
  if (!outcome) return null;
  // Model-less rows (unmodeled knockout fixtures) carry no probabilities — there
  // is no model side to compare against the market, so skip the divergence line
  // rather than let modelOutcomeProb throw on undefined match.probabilities.
  if (!match?.probabilities) return null;
  const pick = modelOutcomeProb(match);
  const marketProb = marketOutcomeProb(outcome, pick.side);
  if (marketProb == null) return null;
  // pick.prob is a percent (0–100, from match.probabilities); marketProb is a
  // fraction (0–1, from match_outcomes) — put both on the percent scale so the
  // divergence reads e.g. "Model 61% · Market 50% · +11 pp", not "Market 0% · +60 pp".
  const div = formatDivergence(pick.prob, marketProb * 100);
  const el = document.createElement('div');
  el.className = `divergence ${div.className}`;
  el.textContent = div.label;
  return el;
}
