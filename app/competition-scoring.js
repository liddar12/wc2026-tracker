// Weighted-by-round scoring per docs/QA_STORIES_BRACKETOLOGY.md (BKT-008).
// R32=1, R16=2, QF=4, SF=8, Final=16. Champion correct adds a +16 bonus.
// Max possible = 1*16 + 2*8 + 4*4 + 8*2 + 16*1 + 16 = 16+16+16+16+16+16 = 96.
export const WEIGHTED_ROUND_POINTS = {
  R32: 1,
  R16: 2,
  QF: 4,
  SF: 8,
  Final: 16,
};
export const CHAMPION_BONUS = 16;
export const MAX_WEIGHTED_SCORE = 16 + 16 + 16 + 16 + 16 + CHAMPION_BONUS;

const STAGE_TO_ROUND = {
  round_of_32: 'R32',
  round_of_16: 'R16',
  quarterfinals: 'QF',
  semifinals: 'SF',
  final: 'Final',
};

// ESPN statuses that mean a match is OVER. scrape_live_results.py also writes
// IN-PROGRESS records (live scores for the match cards) — scoring must ignore
// those or pool points would swing mid-match and count half-played games.
// Records without a status field (manual/legacy) are treated as final.
const FINAL_STATUSES = new Set(['STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_END_OF_FULL_TIME']);

function isFinalRecord(rec) {
  return !rec?.status || FINAL_STATUSES.has(rec.status);
}

function actualResultsToTierMap(data) {
  // Knockout tiers FIRST: picks are team-pair keyed, and the 2026 format allows
  // a knockout rematch of a group-stage pairing. With group_stage first, such a
  // pick resolved to the group record and scored 0; knockout-first finds the
  // scoreable occurrence. Pure group pairs still fall through to group_stage
  // and are skipped (not scored), same as before.
  return {
    round_of_32: data?.actualResults?.round_of_32 || {},
    round_of_16: data?.actualResults?.round_of_16 || {},
    quarterfinals: data?.actualResults?.quarterfinals || {},
    semifinals: data?.actualResults?.semifinals || {},
    final: data?.actualResults?.final || {},
    third_place: data?.actualResults?.third_place || {},
    group_stage: data?.actualResults?.group_stage || {},
  };
}

// Legacy flat scorer (+1 per correct pick across any tier, including group
// stage). Production callers now use scoreBracketWeighted; this remains so
// tests and any external integrations keep working.
export function scoreBracket(picks, data) {
  const tiers = Object.values(actualResultsToTierMap(data));
  const cleanPicks = normalizeBracketPicks(picks);
  let score = 0;
  for (const pick of cleanPicks) {
    const actual = findActualOutcome(tiers, pick.team_a, pick.team_b);
    if (!actual) continue;
    if (pick.choice === actual) score += 1;
  }
  return score;
}

// Returns { score, breakdown: { R32, R16, QF, SF, Final, championBonus },
//   lastRoundCorrect, championCorrect }. The extra fields support tie-breakers.
export function scoreBracketWeighted(picks, data) {
  const tierMap = actualResultsToTierMap(data);
  const cleanPicks = normalizeBracketPicks(picks);

  const breakdown = { R32: 0, R16: 0, QF: 0, SF: 0, Final: 0, championBonus: 0 };
  const ROUND_DEPTH = { R32: 1, R16: 2, QF: 3, SF: 4, Final: 5 };
  let deepestRoundIdx = 0;
  let lastRoundCorrect = null;
  let championCorrect = false;

  for (const pick of cleanPicks) {
    const found = findActualOutcomeWithStage(tierMap, pick.team_a, pick.team_b);
    if (!found) continue;
    const { outcome, stage } = found;
    if (pick.choice !== outcome) continue;
    const round = STAGE_TO_ROUND[stage];
    if (!round) continue; // group_stage / third_place: not scored
    breakdown[round] += WEIGHTED_ROUND_POINTS[round] || 0;
    const idx = ROUND_DEPTH[round] || 0;
    if (idx > deepestRoundIdx) { deepestRoundIdx = idx; lastRoundCorrect = round; }
    if (round === 'Final') {
      championCorrect = true;
      breakdown.championBonus += CHAMPION_BONUS;
    }
  }
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { score, breakdown, lastRoundCorrect, championCorrect };
}

function findActualOutcomeWithStage(tierMap, aTeam, bTeam) {
  for (const stage of Object.keys(tierMap)) {
    const tier = tierMap[stage];
    const key1 = `${aTeam}__vs__${bTeam}`;
    const key2 = `${bTeam}__vs__${aTeam}`;
    const rec = tier[key1] || tier[key2];
    if (!rec) continue;
    if (!isFinalRecord(rec)) continue; // in-progress live score — not scoreable yet
    const a = Number(rec.score_a ?? rec.team_a_score);
    const b = Number(rec.score_b ?? rec.team_b_score);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const flipped = !!tier[key2];
    // Knockout rounds: regulation tie is broken by penalties; trust rec.winner
    // when present, so a correct pen-shootout pick scores points instead of
    // being treated as a draw (which knockout submissions reject).
    if (a === b) {
      if (rec.winner === aTeam) return { outcome: 'team_a', stage };
      if (rec.winner === bTeam) return { outcome: 'team_b', stage };
      return { outcome: 'draw', stage };
    }
    if (flipped) return { outcome: a > b ? 'team_b' : 'team_a', stage };
    return { outcome: a > b ? 'team_a' : 'team_b', stage };
  }
  return null;
}

// Compare two leaderboard entries by tie-breakers per BKT-009.
// Higher is better. Returns negative if a should rank above b.
export function compareLeaderboardEntries(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  // Tie-breaker 1: deepest round correct
  const roundIdx = (r) => ['R32', 'R16', 'QF', 'SF', 'Final'].indexOf(r);
  const aRound = roundIdx(a.lastRoundCorrect || '');
  const bRound = roundIdx(b.lastRoundCorrect || '');
  if (aRound !== bRound) return bRound - aRound;
  // Tie-breaker 2: champion correct
  if (a.championCorrect !== b.championCorrect) return a.championCorrect ? -1 : 1;
  // Tie-breaker 3: earliest submit (older updated_at wins)
  const at = Date.parse(a.updatedAt || '') || Infinity;
  const bt = Date.parse(b.updatedAt || '') || Infinity;
  if (at !== bt) return at - bt;
  // Tie-breaker 4: username alphabetical
  return String(a.username || '').localeCompare(String(b.username || ''));
}

/**
 * Knockout brackets advance a single team — a draw is not a valid outcome.
 * Strips draw picks (and all invalid/duplicate picks) for submission.
 */
export function normalizeKnockoutPicks(picks) {
  return normalizeBracketPicks(picks).filter((pick) => pick.choice !== 'draw');
}

export function normalizeBracketPicks(picks) {
  if (!Array.isArray(picks)) return [];
  const seen = new Set();
  const clean = [];
  for (const pick of picks) {
    if (!pick || typeof pick !== 'object') continue;
    const teamA = typeof pick.team_a === 'string' ? pick.team_a.trim() : '';
    const teamB = typeof pick.team_b === 'string' ? pick.team_b.trim() : '';
    const choice = pick.choice;
    if (!teamA || !teamB || teamA === teamB) continue;
    if (choice !== 'team_a' && choice !== 'team_b' && choice !== 'draw') continue;
    const pairKey = [teamA, teamB].sort((a, b) => a.localeCompare(b)).join('__vs__');
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    clean.push({ team_a: teamA, team_b: teamB, choice });
  }
  return clean;
}

// eslint-disable-next-line no-unused-vars
function findActualOutcome(tiers, aTeam, bTeam) {
  for (const stage of tiers) {
    const key1 = `${aTeam}__vs__${bTeam}`;
    const key2 = `${bTeam}__vs__${aTeam}`;
    const rec = stage[key1] || stage[key2];
    if (!rec) continue;
    const a = rec.score_a ?? rec.team_a_score;
    const b = rec.score_b ?? rec.team_b_score;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a === b) return 'draw';
    if (rec === stage[key2]) return a > b ? 'team_b' : 'team_a';
    return a > b ? 'team_a' : 'team_b';
  }
  return null;
}
