/* bracket-resolver.js — shared knockout-slot resolution + actual-results
   lookup helpers. Used by brackets-live-view (live tournament) and
   bracket-view (projected/model). Keeps slot semantics ("1A", "2B",
   "3 ABCDF", "W74", "L101") in one place. */

export const STAGE_LABELS = {
  round_of_32:   'Round of 32',
  round_of_16:   'Round of 16',
  quarterfinals: 'Quarter-finals',
  semifinals:    'Semi-finals',
  third_place:   'Bronze final',
  final:         'Final',
};

export const STAGE_ORDER = [
  'round_of_32', 'round_of_16', 'quarterfinals', 'semifinals', 'third_place', 'final',
];

// ESPN statuses meaning the match is over. scrape_live_results.py also writes
// IN-PROGRESS records (so match cards can show live scores) — standings and
// winner-advancement must only consume FINAL results, or a halftime 1-0 counts
// as a played win and the bracket advances the current leader mid-match.
// Records without a status field (manual/legacy) are treated as final.
const FINAL_STATUSES = new Set(['STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_END_OF_FULL_TIME']);

export function isFinalResultRecord(rec) {
  return !rec?.status || FINAL_STATUSES.has(rec.status);
}

const SLOT_RE = /^\d[A-L]$|^3 [A-L]+$|^W\d+$|^L\d+$/;

export function isSlotPlaceholder(s) {
  if (typeof s !== 'string') return true;
  return SLOT_RE.test(s);
}

/**
 * Resolve every slot in the given knockout matches.
 * Returns the same matches mutated with `resolved_team_a` / `resolved_team_b`
 * and (for live mode) `actual` populated with score + winner.
 *
 * winnerResolver(matchNumber) -> team name or null
 *   For LIVE mode: returns the actual winner from data.actualResults
 *   For PROJECTED mode: returns the model-projected winner via composite gap
 */
export function resolveSlots(knockouts, data, opts = {}) {
  const { winnerResolver = null } = opts;
  const winners = new Map();
  const losers  = new Map();
  // Each best-third-placed team can fill only ONE R32 slot. Shared across the
  // whole resolution pass so a strong third (best across several slot combos)
  // isn't assigned to multiple matches. Matches are processed in match-number
  // order by the callers, so earlier slots claim first.
  const usedThirds = new Set();

  for (const m of knockouts) {
    const a = resolveSlot(m.team_a, data, winners, losers, usedThirds);
    const b = resolveSlot(m.team_b, data, winners, losers, usedThirds);
    m.resolved_team_a = a;
    m.resolved_team_b = b;

    const actual = lookupActual(data, m.stage, a, b);
    m.actual = actual;

    let winner = actual?.winner || null;
    if (!winner && winnerResolver) {
      winner = winnerResolver({ matchNumber: m.match_number, stage: m.stage, team_a: a, team_b: b });
    }
    if (winner && a && b) {
      winners.set(m.match_number, winner);
      const loser = winner === a ? b : winner === b ? a : null;
      if (loser) losers.set(m.match_number, loser);
    }
    m.projected_winner = winner;
  }
  return knockouts;
}

export function resolveSlot(slot, data, winners, losers, usedThirds) {
  if (!slot || typeof slot !== 'string') return null;
  if (!isSlotPlaceholder(slot)) return slot;

  const grpMatch = slot.match(/^(\d)([A-L])$/);
  if (grpMatch) return resolveGroupSlot(data, parseInt(grpMatch[1], 10), grpMatch[2]);

  const thirdMatch = slot.match(/^3 ([A-L]+)$/);
  if (thirdMatch) return resolveThirdSlot(data, thirdMatch[1], usedThirds);

  const winMatch = slot.match(/^W(\d+)$/);
  if (winMatch) return winners.get(parseInt(winMatch[1], 10)) || slot;

  const loseMatch = slot.match(/^L(\d+)$/);
  if (loseMatch) return losers.get(parseInt(loseMatch[1], 10)) || slot;

  return slot;
}

export function resolveGroupSlot(data, place, group) {
  // Try live standings first; fall back to projected order from group_matchups.
  const standings = computeGroupStandings(data, group);
  if (standings) {
    return standings[place - 1]?.team || `${place}${group}`;
  }
  const projected = computeProjectedGroupOrder(data, group);
  if (projected) {
    return projected[place - 1]?.team || `${place}${group}`;
  }
  return `${place}${group}`;
}

export function resolveThirdSlot(data, letters, usedThirds) {
  const candidates = [];
  for (const g of letters) {
    const live = computeGroupStandings(data, g);
    const ordered = live || computeProjectedGroupOrder(data, g);
    if (ordered && ordered[2]) candidates.push({ ...ordered[2], group: g });
  }
  if (!candidates.length) return `3 ${letters}`;
  candidates.sort((a, b) =>
    (b.points || 0) - (a.points || 0) ||
    (b.gd || 0)     - (a.gd || 0)     ||
    (b.gf || 0)     - (a.gf || 0)
  );
  // Dedup across slots: a third-placed team can only occupy one R32 slot. Each
  // slot takes the best still-available third among its letters. Without this,
  // one team (e.g. Group E's third, best across six "…E…" combos) was assigned
  // to every matching slot — appearing as the opponent in multiple matches.
  if (usedThirds) {
    for (const c of candidates) {
      if (!usedThirds.has(c.team)) { usedThirds.add(c.team); return c.team; }
    }
    return `3 ${letters}`; // every candidate already claimed → leave as placeholder
  }
  return candidates[0]?.team || `3 ${letters}`;
}

export function computeGroupStandings(data, group) {
  // Compute real standings from played group-stage results.
  // Returns null if the group is not fully played, so callers can fall back
  // to projected order.
  const gs = data?.actualResults?.group_stage || {};
  const gm = data?.groupMatchups?.[group];
  if (!gm) return null;
  const teams = gm.teams || [];
  const tbl = Object.fromEntries(
    teams.map((t) => [t, { team: t, points: 0, gf: 0, ga: 0, gd: 0, played: 0 }])
  );
  let played = 0;
  for (const m of (gm.matches || [])) {
    const key1 = `${m.team_a}__vs__${m.team_b}`;
    const key2 = `${m.team_b}__vs__${m.team_a}`;
    const rec = gs[key1] || gs[key2];
    if (!rec) continue;
    if (!isFinalResultRecord(rec)) continue; // live in-progress score — not played yet
    const a = rec.score_a ?? rec.team_a_score;
    const b = rec.score_b ?? rec.team_b_score;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const flipped = !!gs[key2];
    const teamA = flipped ? m.team_b : m.team_a;
    const teamB = flipped ? m.team_a : m.team_b;
    if (!tbl[teamA] || !tbl[teamB]) continue;
    tbl[teamA].played++; tbl[teamB].played++;
    tbl[teamA].gf += a; tbl[teamA].ga += b;
    tbl[teamB].gf += b; tbl[teamB].ga += a;
    tbl[teamA].gd = tbl[teamA].gf - tbl[teamA].ga;
    tbl[teamB].gd = tbl[teamB].gf - tbl[teamB].ga;
    if (a > b) tbl[teamA].points += 3;
    else if (a < b) tbl[teamB].points += 3;
    else { tbl[teamA].points += 1; tbl[teamB].points += 1; }
    played++;
  }
  if (played < (gm.matches || []).length) return null;
  return Object.values(tbl).sort((x, y) =>
    y.points - x.points || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team)
  );
}

export function computeProjectedGroupOrder(data, group) {
  // Pre-tournament projection: sort group teams by expected_points from the
  // model. Returns rows shaped like real standings so consumers can use them
  // interchangeably (with synthetic points/gd/gf so 3rd-place tiebreakers
  // still work).
  const gm = data?.groupMatchups?.[group];
  if (!gm) return null;
  const acc = Object.fromEntries(
    (gm.teams || []).map((t) => [t, { team: t, points: 0, gf: 0, ga: 0, gd: 0, played: 0 }])
  );
  for (const m of (gm.matches || [])) {
    const ep = m.expected_points || {};
    if (acc[m.team_a]) acc[m.team_a].points += (ep.team_a || 0);
    if (acc[m.team_b]) acc[m.team_b].points += (ep.team_b || 0);
  }
  return Object.values(acc).sort((x, y) => y.points - x.points || x.team.localeCompare(y.team));
}

export function lookupActual(data, stage, a, b) {
  if (!a || !b) return null;
  const tier = data?.actualResults?.[stage];
  if (!tier) return null;
  const rec = tier[`${a}__vs__${b}`] || tier[`${b}__vs__${a}`];
  if (!rec) return null;
  const sa = rec.score_a ?? rec.team_a_score;
  const sb = rec.score_b ?? rec.team_b_score;
  if (!Number.isFinite(sa) || !Number.isFinite(sb)) return null;
  const flipped = !!tier[`${b}__vs__${a}`];
  const score_a = flipped ? sb : sa;
  const score_b = flipped ? sa : sb;
  let winner = null;
  // Only declare a winner (and thereby advance them through the bracket) once
  // the match is FINAL — in-progress records still surface the live score.
  if (isFinalResultRecord(rec)) {
    if (score_a > score_b) winner = a;
    else if (score_b > score_a) winner = b;
    if (rec.winner === a) winner = a;
    else if (rec.winner === b) winner = b;
  }
  return { score_a, score_b, winner, kickoff_utc: rec.kickoff_utc };
}

// Model-projected winner: pick the team with the higher composite score.
// If neither composite is available, the first team wins (arbitrary tie-break).
export function projectWinner(data, a, b) {
  if (!a || !b) return a || b || null;
  if (isSlotPlaceholder(a) || isSlotPlaceholder(b)) return null;
  const ca = data?.teams?.[a]?.composite;
  const cb = data?.teams?.[b]?.composite;
  if (typeof ca !== 'number' || typeof cb !== 'number') return a;
  if (ca === cb) return a;
  return ca > cb ? a : b;
}
