/* predictions.js — derive accuracy stats, model predictions, etc.
 *
 * Match outcome representation:
 *   'team_a' | 'draw' | 'team_b'
 * Model picks come from group_matchups.json's predicted_winner field which is
 * the team name string or 'draw_likely'. Normalize via modelChoice().
 */

import { allPicks } from './state.js';

export function modelChoice(match) {
  if (match.predicted_winner === 'draw_likely') return 'draw';
  if (match.predicted_winner === match.team_a) return 'team_a';
  if (match.predicted_winner === match.team_b) return 'team_b';
  return null;
}

export function actualChoice(match, actualResults) {
  const stage = actualResults?.group_stage || {};
  const key1 = `${match.team_a}__vs__${match.team_b}`;
  const key2 = `${match.team_b}__vs__${match.team_a}`;
  const rec = stage[key1] || stage[key2];
  if (!rec) return null;
  const a = rec.score_a ?? rec.team_a_score;
  const b = rec.score_b ?? rec.team_b_score;
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  if (a > b) return rec === stage[key2] ? 'team_b' : 'team_a';
  if (a < b) return rec === stage[key2] ? 'team_a' : 'team_b';
  return 'draw';
}

export function describePrediction(match, teams) {
  const a = match.team_a, b = match.team_b;
  const ga = teams[a], gb = teams[b];
  const sentences = [];
  const gap = Math.abs(match.gap);
  if (match.predicted_winner === 'draw_likely') {
    sentences.push(`${a} and ${b} sit ${gap.toFixed(1)} composite points apart — close enough that a draw is plausible.`);
  } else {
    const fav = match.predicted_winner;
    sentences.push(`${fav} is favored by a ${gap.toFixed(1)}-point composite gap, giving roughly a ${match.win_confidence_pct.toFixed(0)}% win probability.`);
  }
  if (ga && gb) {
    const stronger = ga.tmv_musd > gb.tmv_musd ? a : b;
    sentences.push(`${stronger} carries the more valuable squad in market terms (${stronger === a ? ga.tmv_musd : gb.tmv_musd} M$ vs ${stronger === a ? gb.tmv_musd : ga.tmv_musd} M$).`);
  }
  if (match.upset_risk?.indicators?.length) {
    const labels = match.upset_risk.indicators.map(i => i.label.toLowerCase()).join('; ');
    sentences.push(`Watch for upset risk: ${labels}.`);
  }
  return sentences.join(' ');
}

export function accuracySummary(data) {
  const picks = allPicks();
  const matches = collectAllMatches(data.groupMatchups);
  const byKey = new Map();
  for (const m of matches) {
    byKey.set(`${m.team_a}__vs__${m.team_b}`, m);
    byKey.set(`${m.team_b}__vs__${m.team_a}`, m);
  }

  let userCorrect = 0, modelCorrect = 0, total = 0;
  const items = [];
  for (const p of picks) {
    const m = byKey.get(p.key);
    if (!m) {
      items.push({ ...p, match: null, actual: null, userResult: 'pending', modelResult: 'pending' });
      continue;
    }
    const actual = actualChoice(m, data.actualResults);
    const model = modelChoice(m);
    if (actual) {
      total += 1;
      const userR = p.choice === actual ? 'correct' : 'wrong';
      const modelR = model === actual ? 'correct' : 'wrong';
      if (userR === 'correct') userCorrect += 1;
      if (modelR === 'correct') modelCorrect += 1;
      items.push({ ...p, match: m, actual, userResult: userR, modelResult: modelR });
    } else {
      items.push({ ...p, match: m, actual: null, userResult: 'pending', modelResult: 'pending' });
    }
  }
  return { items, total, userCorrect, modelCorrect };
}

export function collectAllMatches(groupMatchups) {
  const out = [];
  for (const [group, info] of Object.entries(groupMatchups)) {
    for (const m of info.matches) out.push({ ...m, group });
  }
  return out;
}
