/* team-analytics.js — R12b: a single shared accessor for "the analytics
   numbers shown next to a team chip." Different models surface different
   primary signals; this normalises them into a consistent shape so the
   UI tile rendering doesn't have to fork by model. */

import { getActiveModel } from './active-model.js';
import { dtRatingsByTeam } from './dt-model.js';

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

  // DT Model: rating (0-100) + Monte-Carlo title probability
  const dtRec = dtRatingsByTeam(data)[team] || null;
  const dtRating = dtRec && dtRec.rating > 0 ? dtRec.rating : null;
  const dtTitlePct = dtRec && dtRec.title_prob > 0 ? dtRec.title_prob * 100 : null;

  // Hybrid (⅓ J5L + ⅓ DT + ⅓ Markets): use the precomputed forecast (forecast.json)
  // — champion odds + blended strength — falling back to a J5L+Kalshi mean.
  const fcRow = (data?.forecast?.teams || []).find((r) => r?.team === team) || null;
  const hybridChampPct = fcRow && typeof fcRow.champion === 'number' ? fcRow.champion * 100 : null;
  const hybridStrength = fcRow && typeof fcRow.hybrid_strength === 'number' ? fcRow.hybrid_strength : null;
  let hybridPct = hybridChampPct;
  if (hybridPct == null && composite != null && kalshiPct != null) {
    hybridPct = Math.round((composite + kalshiPct) / 2);
  }

  // Stack ("J5L AI Enhanced"): the learned J5L+DT blend strength (data/stacker.json).
  const stackStrength = (data?.stacker?.strengths || {})[team] ?? null;

  let primary;
  let secondary = [];
  switch (model) {
    case 'dt': {
      primary = { label: 'DT', value: dtRating != null ? dtRating.toFixed(1) : '—', hint: 'DT rating' };
      if (dtTitlePct != null) secondary.push({ label: 'Title', value: `${dtTitlePct.toFixed(1)}%` });
      if (composite != null) secondary.push({ label: 'J5L', value: composite.toFixed(1) });
      break;
    }
    case 'kalshi': {
      primary = { label: 'Markets', value: kalshiPct != null ? `${kalshiPct.toFixed(1)}%` : '—', hint: 'win odds' };
      if (composite != null) secondary.push({ label: 'J5L', value: composite.toFixed(1) });
      if (powerRank != null) secondary.push({ label: 'Power', value: `#${powerRank}` });
      break;
    }
    case 'hybrid': {
      const hv = hybridChampPct != null ? `${hybridChampPct.toFixed(1)}%` : (hybridPct != null ? `${hybridPct}` : '—');
      primary = { label: 'Hybrid', value: hv, hint: '⅓ J5L + ⅓ DT + ⅓ Markets' };
      if (composite != null) secondary.push({ label: 'J5L', value: composite.toFixed(1) });
      if (dtRating != null) secondary.push({ label: 'DT', value: dtRating.toFixed(1) });
      if (kalshiPct != null) secondary.push({ label: 'Markets', value: `${kalshiPct.toFixed(1)}%` });
      break;
    }
    case 'stack': {
      // "J5L AI Enhanced" — an ML-tuned J5L+DT blend. Show the familiar J5L
      // composite as the headline (the dominant, on-scale component) with the DT
      // rating alongside; the blend weight itself lives in data/stacker.json.
      primary = { label: 'AI Blend', value: composite != null ? composite.toFixed(1) : '—', hint: 'ML J5L+DT (learning)' };
      if (dtRating != null) secondary.push({ label: 'DT', value: dtRating.toFixed(1) });
      if (powerRank != null) secondary.push({ label: 'Power', value: `#${powerRank}` });
      break;
    }
    case 'consensus': {
      primary = { label: 'Consensus', value: powerRank != null ? `#${powerRank}` : '—', hint: 'see Hot Picks' };
      if (composite != null) secondary.push({ label: 'J5L', value: composite.toFixed(1) });
      if (kalshiPct != null) secondary.push({ label: 'Markets', value: `${kalshiPct.toFixed(1)}%` });
      break;
    }
    case 'j5l':
    default: {
      primary = { label: 'J5L', value: composite != null ? composite.toFixed(1) : '—', hint: 'composite power' };
      if (powerRank != null) secondary.push({ label: 'Power', value: `#${powerRank}` });
      if (kalshiPct != null) secondary.push({ label: 'Markets', value: `${kalshiPct.toFixed(1)}%` });
      break;
    }
  }
  return { primary, secondary, model, composite, kalshiPct, powerRank, fifaRank, dtRating, dtTitlePct, hybridStrength, hybridChampPct };
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
    else if (model === 'dt') score = a.dtRating ?? a.composite ?? 0;
    else if (model === 'hybrid') {
      // rank by the ⅓ blended strength (forecast.json); fall back to J5L+Kalshi mean
      score = a.hybridStrength != null ? a.hybridStrength
        : (a.composite != null && a.kalshiPct != null ? (a.composite + a.kalshiPct) / 2 : (a.composite ?? a.kalshiPct ?? 0));
    } else if (model === 'stack') {
      // rank by the learned J5L+DT blend strength (data/stacker.json)
      score = (data?.stacker?.strengths || {})[t] ?? a.composite ?? 0;
    } else {
      // j5l defaults to composite
      score = a.composite ?? 0;
    }
    return { team: t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((r) => r.team);
}
