/* group-scoring.js — score group-finish predictions per BKT-spec.
   1st correct = 3pt, 2nd correct = 2pt, 3rd-place qualifier correct (in the
   user's best-thirds list) = 1pt. Max = 12*3 + 12*2 + 8*1 = 84.

   Predictions shape:
     { "A": ["Mexico","Czechia","Korea Republic","South Africa"], ...,
       "best_thirds": ["Korea Republic", "Canada", "Morocco", ...8 names] }
*/

import { computeGroupStandings } from './bracket-resolver.js';

export const GROUP_POINTS = { first: 3, second: 2, third: 1 };
export const MAX_GROUP_SCORE = 12 * GROUP_POINTS.first + 12 * GROUP_POINTS.second + 8 * GROUP_POINTS.third;

export function normalizeGroupPredictions(picks) {
  if (!picks || typeof picks !== 'object') return { groups: {}, best_thirds: [] };
  const groups = {};
  // R6: accept BOTH shapes — the R6 builder writes
  //   { groups: { A: [...] }, best_thirds: [...] }
  // while the legacy shape was flat top-level letter keys. Without this dual
  // handling, R32 slot resolution silently fails and the entire knockout
  // funnel can't be completed.
  const source = (picks.groups && typeof picks.groups === 'object') ? picks.groups : picks;
  for (const [g, list] of Object.entries(source)) {
    if (g === 'best_thirds') continue;
    if (!/^[A-L]$/.test(g)) continue;
    if (!Array.isArray(list)) continue;
    groups[g] = list.filter((t) => typeof t === 'string' && t.trim()).slice(0, 4);
  }
  const best_thirds = Array.isArray(picks.best_thirds)
    ? picks.best_thirds.filter((t) => typeof t === 'string' && t.trim()).slice(0, 8)
    : [];
  return { groups, best_thirds };
}

export function scoreGroupPredictions(picks, data) {
  const { groups: predictedGroups, best_thirds } = normalizeGroupPredictions(picks);
  const breakdown = { first: 0, second: 0, thirds: 0 };
  for (const [g, predicted] of Object.entries(predictedGroups)) {
    const actual = computeGroupStandings(data, g);
    if (!actual || actual.length < 2) continue;
    if (predicted[0] && actual[0] && predicted[0] === actual[0].team) {
      breakdown.first += GROUP_POINTS.first;
    }
    if (predicted[1] && actual[1] && predicted[1] === actual[1].team) {
      breakdown.second += GROUP_POINTS.second;
    }
  }

  // Best thirds: which teams were the actual 8 best 3rd-place qualifiers?
  // Read straight from data.actualResults.qualified_for_r32 if present;
  // else compute from each group's 3rd-place team ranked by points/gd/gf.
  let actualBestThirds = [];
  const explicit = data?.actualResults?.qualified_for_r32;
  if (Array.isArray(explicit) && explicit.length === 32) {
    actualBestThirds = explicit.slice(24); // last 8 of 32 in FIFA's pool
  } else {
    const thirds = [];
    for (const g of Object.keys(predictedGroups)) {
      const standings = computeGroupStandings(data, g);
      if (standings && standings[2]) thirds.push(standings[2]);
    }
    thirds.sort((a, b) =>
      (b.points || 0) - (a.points || 0) ||
      (b.gd || 0)     - (a.gd || 0)     ||
      (b.gf || 0)     - (a.gf || 0)
    );
    actualBestThirds = thirds.slice(0, 8).map((t) => t.team);
  }
  const actualSet = new Set(actualBestThirds);
  for (const t of best_thirds) {
    if (actualSet.has(t)) breakdown.thirds += GROUP_POINTS.third;
  }

  const score = breakdown.first + breakdown.second + breakdown.thirds;
  return { score, breakdown };
}
