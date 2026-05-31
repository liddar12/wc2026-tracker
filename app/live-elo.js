/* live-elo.js — E3: recompute Elo ratings from completed match results
   in-session, using a vanilla World-Football-Elo update rule. The static
   data/teams.json supplies the pre-tournament `elo_raw`; this module
   applies updates from actual_results so a team's rating reflects what
   they've actually done in the tournament so far.

   Public API:
     recomputeElo(data) -> { [teamName]: { startElo, currentElo, delta } }
   Cached per data_version; cheap to recompute (<50ms for a tournament).
*/

const K_GROUP = 30;     // K-factor for group stage
const K_KO = 40;        // higher K for knockouts (higher stakes)
const HOME_BONUS = 100; // host bonus for USA/Mexico/Canada — bumps expected score
const HOSTS = new Set(['USA', 'Mexico', 'Canada']);
const CACHE = new Map();

export function recomputeElo(data) {
  const version = data?.meta?.data_version || 'unknown';
  if (CACHE.has(version)) return CACHE.get(version);

  const teams = data?.teams || {};
  const start = {};
  for (const [name, t] of Object.entries(teams)) {
    start[name] = t?.elo_raw || 1500;
  }
  const elo = { ...start };

  const results = data?.actualResults || data?.actual_results || {};
  const groupStage = results.group_stage || {};
  const knockouts = results.knockouts || {};

  // Process group-stage results
  for (const key of Object.keys(groupStage)) {
    const [a, , b] = key.split('__');
    if (!a || !b) continue;
    const rec = groupStage[key];
    applyEloUpdate(elo, a, b, rec, K_GROUP);
  }

  // Process knockouts
  for (const key of Object.keys(knockouts)) {
    const [a, , b] = key.split('__');
    if (!a || !b) continue;
    const rec = knockouts[key];
    applyEloUpdate(elo, a, b, rec, K_KO);
  }

  const out = {};
  for (const name of Object.keys(start)) {
    const cur = elo[name];
    out[name] = {
      startElo: Math.round(start[name]),
      currentElo: Math.round(cur),
      delta: Math.round(cur - start[name]),
    };
  }
  CACHE.set(version, out);
  return out;
}

function applyEloUpdate(elo, a, b, rec, k) {
  const scoreA = rec?.score_a ?? rec?.team_a_score;
  const scoreB = rec?.score_b ?? rec?.team_b_score;
  if (typeof scoreA !== 'number' || typeof scoreB !== 'number') return;

  const ratingA = (elo[a] || 1500) + (HOSTS.has(a) ? HOME_BONUS : 0);
  const ratingB = (elo[b] || 1500) + (HOSTS.has(b) ? HOME_BONUS : 0);
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;

  let actualA, actualB;
  if (scoreA > scoreB) { actualA = 1; actualB = 0; }
  else if (scoreA < scoreB) { actualA = 0; actualB = 1; }
  else {
    // Penalty winner (knockouts) — give the winner ~75% credit, loser 25%
    if (rec?.penalty_winner === a) { actualA = 0.75; actualB = 0.25; }
    else if (rec?.penalty_winner === b) { actualA = 0.25; actualB = 0.75; }
    else { actualA = 0.5; actualB = 0.5; }
  }

  // Margin of victory multiplier (FIDE-style: log of goal difference)
  const gd = Math.abs(scoreA - scoreB);
  const margin = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8;

  if (elo[a] != null) elo[a] = elo[a] + k * margin * (actualA - expectedA);
  if (elo[b] != null) elo[b] = elo[b] + k * margin * (actualB - expectedB);
}

export function topMovers(data, limit = 10) {
  const all = recomputeElo(data);
  const arr = Object.entries(all).map(([name, r]) => ({ name, ...r }));
  arr.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return arr.slice(0, limit);
}
