/* team-analytics.js — R12b: a single shared accessor for "the analytics
   numbers shown next to a team chip." Different models surface different
   primary signals; this normalises them into a consistent shape so the
   UI tile rendering doesn't have to fork by model. */

import { getActiveModel } from './active-model.js';

/**
 * teamAnalytics(team, data, model?) → {
 *   primary: { label, value, hint? }, // headline number for the chip
 *   secondary: [{ label, value }],    // up to 2 supporting numbers
 *   model,
 * }
 *
 * - J5L:        composite power-rank vs. peers (1 = strongest)
 * - Kalshi:     tournament-winner probability (%)
 * - Hybrid:     mean of normalized J5L + Kalshi
 * - Consensus:  not per-team (it's per-slot via cross-pool aggregation);
 *               falls back to J5L for chip display
 */
export function teamAnalytics(team, data, model) {
  model = model || getActiveModel();
  const teamRec = data?.teams?.[team] || null;
  const composite = teamRec?.composite ?? null;
  const powerRank = teamRec?.power_rank ?? null;
  const fifaRank = teamRec?.fifa_rank ?? null;

  // Kalshi tournament-winner probability
  const winnerRow = (data?.markets?.tournament_winner || []).find((r) => r?.team === team);
  const kalshiPct = winnerRow?.prob_pct ?? null;

  // Hybrid: simple normalize-and-mean
  let hybridPct = null;
  if (composite != null && kalshiPct != null) {
    // J5L composite is roughly 0..100 already; Kalshi prob_pct is 0..100.
    hybridPct = Math.round((composite + kalshiPct) / 2);
  }

  let primary;
  let secondary = [];
  switch (model) {
    case 'kalshi': {
      primary = { label: 'Kalshi', value: kalshiPct != null ? `${kalshiPct.toFixed(1)}%` : '—', hint: 'win odds' };
      if (composite != null) secondary.push({ label: 'J5L', value: composite.toFixed(1) });
      if (powerRank != null) secondary.push({ label: 'Power', value: `#${powerRank}` });
      break;
    }
    case 'hybrid': {
      primary = { label: 'Hybrid', value: hybridPct != null ? `${hybridPct}` : '—', hint: '50/50 J5L+Kalshi' };
      if (composite != null) secondary.push({ label: 'J5L', value: composite.toFixed(1) });
      if (kalshiPct != null) secondary.push({ label: 'Kalshi', value: `${kalshiPct.toFixed(1)}%` });
      break;
    }
    case 'consensus': {
      primary = { label: 'Consensus', value: powerRank != null ? `#${powerRank}` : '—', hint: 'see Hot Picks' };
      if (composite != null) secondary.push({ label: 'J5L', value: composite.toFixed(1) });
      if (kalshiPct != null) secondary.push({ label: 'Kalshi', value: `${kalshiPct.toFixed(1)}%` });
      break;
    }
    case 'j5l':
    default: {
      primary = { label: 'J5L', value: composite != null ? composite.toFixed(1) : '—', hint: 'composite power' };
      if (powerRank != null) secondary.push({ label: 'Power', value: `#${powerRank}` });
      if (kalshiPct != null) secondary.push({ label: 'Kalshi', value: `${kalshiPct.toFixed(1)}%` });
      break;
    }
  }
  return { primary, secondary, model, composite, kalshiPct, powerRank, fifaRank };
}

/**
 * Rank a list of teams under the active model. Returns the same list sorted
 * by predicted strength (best first). Used by "Suggest from <model>" in Play.
 */
export function rankTeamsByModel(teams, data, model) {
  model = model || getActiveModel();
  const scored = teams.map((t) => {
    const a = teamAnalytics(t, data, model);
    let score = 0;
    if (model === 'kalshi') score = a.kalshiPct ?? a.composite ?? 0;
    else if (model === 'hybrid') {
      score = a.composite != null && a.kalshiPct != null ? (a.composite + a.kalshiPct) / 2 : (a.composite ?? a.kalshiPct ?? 0);
    } else {
      // j5l + consensus default to composite
      score = a.composite ?? 0;
    }
    return { team: t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((r) => r.team);
}
