/* leaderboard-core.js — R16 (Phase 2): pure combined-leaderboard logic.
 *
 * total = group score (max 84) + knockout score (max 96) → max 180.
 *
 * Kept free of the Supabase client so it's unit-testable without a network or
 * localStorage. fetchLeaderboard() in competition.js fetches both tables +
 * profiles, then calls combineLeaderboardEntries() here.
 *
 * The previous leaderboard read only group_brackets and ranked on the knockout
 * score alone, silently dropping the 84-pt group component. This unions users
 * from BOTH tables (a player with only group picks, or only a bracket, still
 * ranks) and a missing half scores 0.
 */

import { scoreBracketWeighted, compareLeaderboardEntries } from './competition-scoring.js';
import { scoreGroupPredictions } from './group-scoring.js';

const laterISO = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));

export function combineLeaderboardEntries(brackets, predictions, namesById, data, deps = {}) {
  const scoreKnockout = deps.scoreBracketWeighted || scoreBracketWeighted;
  const scoreGroup = deps.scoreGroupPredictions || scoreGroupPredictions;
  const cmp = deps.compareLeaderboardEntries || compareLeaderboardEntries;

  const byUser = new Map();
  for (const r of brackets || []) {
    if (!r?.user_id) continue;
    const e = byUser.get(r.user_id) || { user_id: r.user_id, updatedAt: null };
    e.bracketPicks = r.picks || [];
    e.updatedAt = laterISO(e.updatedAt, r.updated_at);
    byUser.set(r.user_id, e);
  }
  for (const r of predictions || []) {
    if (!r?.user_id) continue;
    const e = byUser.get(r.user_id) || { user_id: r.user_id, updatedAt: null };
    e.groupPicks = r.picks || null;
    e.updatedAt = laterISO(e.updatedAt, r.updated_at);
    byUser.set(r.user_id, e);
  }

  const entries = [...byUser.values()].map((e) => {
    const weighted = scoreKnockout(e.bracketPicks || [], data);
    const groupScore = e.groupPicks ? scoreGroup(e.groupPicks, data).score : 0;
    const knockoutScore = weighted.score || 0;
    return {
      user_id: e.user_id,
      username: (namesById && namesById[e.user_id]) || 'Player',
      score: groupScore + knockoutScore, // combined total — ranked + displayed
      groupScore,
      knockoutScore,
      breakdown: weighted.breakdown,
      lastRoundCorrect: weighted.lastRoundCorrect,
      championCorrect: weighted.championCorrect,
      updatedAt: e.updatedAt || null,
    };
  });
  entries.sort(cmp);
  return entries;
}
