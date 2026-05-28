export function scoreBracket(picks, data) {
  const tiers = [
    data?.actualResults?.group_stage || {},
    data?.actualResults?.round_of_32 || {},
    data?.actualResults?.round_of_16 || {},
    data?.actualResults?.quarterfinals || {},
    data?.actualResults?.semifinals || {},
    data?.actualResults?.third_place || {},
    data?.actualResults?.final || {}
  ];
  const cleanPicks = normalizeBracketPicks(picks);
  let score = 0;
  for (const pick of cleanPicks) {
    const actual = findActualOutcome(tiers, pick.team_a, pick.team_b);
    if (!actual) continue;
    if (pick.choice === actual) score += 1;
  }
  return score;
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
