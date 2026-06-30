/* live-elo.js — E3: recompute Elo ratings from completed match results
   in-session, using a vanilla World-Football-Elo update rule. The static
   data/teams.json supplies the pre-tournament `elo_raw`; this module
   applies updates from actual_results so a team's rating reflects what
   they've actually done in the tournament so far.

   Public API:
     recomputeElo(data) -> { [teamName]: { startElo, currentElo, delta } }
   Cached per data_version; cheap to recompute (<50ms for a tournament).
*/

import { FINAL_STATUSES } from './lib/match-status.js';

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
  // FINAL only — scheduled 0-0 stubs and in-progress games must NOT move Elo
  // (was counting them as draws). Iterate ALL knockout tiers — the old code
  // read a knockouts key this structure never had, so KO games never counted —
  // chronologically so the result matches the server (scripts/compute_elo.py).
  // Use the CANONICAL FINAL set from match-status.js: the old local set omitted
  // STATUS_FINAL_AET / STATUS_FINAL_PEN, so a knockout decided in extra time or
  // on penalties was skipped here and never moved the client Elo / movers card.
  const FINAL = FINAL_STATUSES;
  const KO_TIERS = ['round_of_32', 'round_of_16', 'quarterfinals', 'semifinals', 'third_place', 'final'];
  const matches = [];
  for (const [tier, k] of [['group_stage', K_GROUP], ...KO_TIERS.map((t) => [t, K_KO])]) {
    const recs = results[tier] || {};
    for (const key of Object.keys(recs)) {
      const rec = recs[key];
      if (!rec || (rec.status && !FINAL.has(rec.status))) continue;
      const i = key.indexOf('__vs__');
      if (i < 0) continue;
      matches.push([rec.kickoff_utc || '', key.slice(0, i), key.slice(i + 6), rec, k]);
    }
  }
  matches.sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  for (const [, a, b, rec, k] of matches) applyEloUpdate(elo, a, b, rec, k);

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
    // Knockout tie broken by extra time / penalties: the regulation score is a
    // draw, so the winner lives in rec.winner (the canonical advancing team —
    // the field the scraper actually writes). The old code read a winner field
    // that nothing populated, so shootout/ET winners silently scored as
    // 0.5/0.5 draws. Give the winner ~75% credit, the loser 25%.
    if (rec?.winner === a) { actualA = 0.75; actualB = 0.25; }
    else if (rec?.winner === b) { actualA = 0.25; actualB = 0.75; }
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
