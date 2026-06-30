/* standings.js — RJ30-6: the pure, node-testable group-standings engine.
   No DOM. Wraps + extends bracket-resolver.computeGroupStandings so the two
   never diverge on the FINAL-gated math (pts 3/1/0, gd, gf, key-flip,
   isFinalStatus). Adds: W/D/L, FIFA head-to-head tiebreaking, partial/empty
   group handling (the resolver returns null mid-group; this view wants the live
   partial table), best-thirds across all 12 groups, and plain-language
   qualification scenarios.

   Locked by tests/feature/rj30-standings.test.mjs:
   - groupTable: 4 rows, pts→gd→gf order, ranks 1..4, W/D/L consistent with
     pts+played+gd, top-2 of a COMPLETE group advanced='auto', H2H breaks an
     exact pts/gd/gf tie, partial group complete=false & no auto lock, empty
     group all-zero, unknown/null guarded → [], agrees with computeGroupStandings
     order + leader points.
   - bestThirds: ranks 12 thirds, exactly 8 in, cutoffRank===8.
   - qualificationScenario: {status,needs} strings for every team; decided group
     ⇒ top-2 qualified-1st/2nd, bottom eliminated/in-best-third; alive team gets
     an actionable needs line.
*/

import { isFinalStatus } from './match-status.js';

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

// Read a FINAL-gated, orientation-aware score for a fixture from group_stage.
// Returns { a, b } oriented to (m.team_a, m.team_b), or null when not yet played
// (no record, an in-progress/LIVE record, or non-numeric scores).
function finalScore(gs, m) {
  const key1 = `${m.team_a}__vs__${m.team_b}`;
  const key2 = `${m.team_b}__vs__${m.team_a}`;
  const rec = gs[key1] || gs[key2];
  if (!rec) return null;
  if (!isFinalStatus(rec)) return null; // live/in-progress — not played yet
  const sa = rec.score_a ?? rec.team_a_score;
  const sb = rec.score_b ?? rec.team_b_score;
  if (!Number.isFinite(sa) || !Number.isFinite(sb)) return null;
  const flipped = !gs[key1] && !!gs[key2];
  return flipped ? { a: sb, b: sa } : { a: sa, b: sb };
}

// Head-to-head mini-table points among a set of teams, computed ONLY from their
// direct group_stage results. Returns { [team]: { pts, gd, gf } }.
function headToHead(gs, matches, teamSet) {
  const acc = {};
  for (const t of teamSet) acc[t] = { pts: 0, gd: 0, gf: 0 };
  for (const m of matches) {
    if (!teamSet.has(m.team_a) || !teamSet.has(m.team_b)) continue;
    const sc = finalScore(gs, m);
    if (!sc) continue;
    acc[m.team_a].gf += sc.a; acc[m.team_b].gf += sc.b;
    acc[m.team_a].gd += sc.a - sc.b; acc[m.team_b].gd += sc.b - sc.a;
    if (sc.a > sc.b) acc[m.team_a].pts += 3;
    else if (sc.a < sc.b) acc[m.team_b].pts += 3;
    else { acc[m.team_a].pts += 1; acc[m.team_b].pts += 1; }
  }
  return acc;
}

/**
 * Real group table from actual results, FINAL-gated, with FIFA tiebreaking.
 * @param {object} data - { actualResults, groupMatchups }.
 * @param {string} group - group letter.
 * @returns {Array<{team,played,w,d,l,gf,ga,gd,points,rank,
 *                   advanced:'auto'|'third'|'out'|null, complete:boolean}>}
 *   Empty array for an unknown group or null data.
 */
export function groupTable(data, group) {
  const gs = data?.actualResults?.group_stage || {};
  const gm = data?.groupMatchups?.[group];
  if (!gm) return [];
  const teams = Array.isArray(gm.teams) ? gm.teams : [];
  const matches = Array.isArray(gm.matches) ? gm.matches : [];

  const row = Object.fromEntries(teams.map((t) => [t, {
    team: t, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, points: 0,
  }]));

  let playedCount = 0;
  for (const m of matches) {
    const sc = finalScore(gs, m);
    if (!sc) continue;
    const A = row[m.team_a], B = row[m.team_b];
    if (!A || !B) continue; // data drift — skip unknown teams
    A.played++; B.played++;
    A.gf += sc.a; A.ga += sc.b;
    B.gf += sc.b; B.ga += sc.a;
    if (sc.a > sc.b) { A.w++; B.l++; A.points += 3; }
    else if (sc.a < sc.b) { B.w++; A.l++; B.points += 3; }
    else { A.d++; B.d++; A.points += 1; B.points += 1; }
    playedCount++;
  }
  for (const r of Object.values(row)) r.gd = r.gf - r.ga;

  const complete = matches.length > 0 && playedCount >= matches.length;

  // Sort: pts → gd → gf → head-to-head (mini-table among the exactly-tied
  // cluster) → alphabetical (lots). H2H NEVER overrides a strict pts/gd/gf
  // edge — it only re-orders an otherwise-equal cluster.
  const ordered = Object.values(row).sort((x, y) => {
    if (y.points !== x.points) return y.points - x.points;
    if (y.gd !== x.gd) return y.gd - x.gd;
    if (y.gf !== x.gf) return y.gf - x.gf;
    return 0; // equal on the primary keys — resolve via H2H below
  });

  // Apply the head-to-head pass over each maximal pts/gd/gf-equal cluster.
  applyHeadToHead(ordered, gs, matches);

  ordered.forEach((r, i) => {
    r.rank = i + 1;
    r.advanced = complete ? (i < 2 ? 'auto' : (i === 2 ? 'third' : 'out')) : null;
  });
  return ordered.map((r) => ({ ...r, complete }));
}

// Re-order any maximal run of rows equal on pts/gd/gf using a head-to-head
// mini-table (pts→gd→gf among just those teams), falling back to alphabetical
// (drawing of lots). Mutates `ordered` in place.
function applyHeadToHead(ordered, gs, matches) {
  let i = 0;
  while (i < ordered.length) {
    let j = i + 1;
    while (
      j < ordered.length &&
      ordered[j].points === ordered[i].points &&
      ordered[j].gd === ordered[i].gd &&
      ordered[j].gf === ordered[i].gf
    ) j++;
    if (j - i > 1) {
      const cluster = ordered.slice(i, j);
      const set = new Set(cluster.map((r) => r.team));
      const h2h = headToHead(gs, matches, set);
      cluster.sort((x, y) => {
        const hx = h2h[x.team], hy = h2h[y.team];
        if (hy.pts !== hx.pts) return hy.pts - hx.pts;
        if (hy.gd !== hx.gd) return hy.gd - hx.gd;
        if (hy.gf !== hx.gf) return hy.gf - hx.gf;
        return x.team.localeCompare(y.team); // lots
      });
      for (let k = 0; k < cluster.length; k++) ordered[i + k] = cluster[k];
    }
    i = j;
  }
}

/**
 * Cross-group ranking of every group's 3rd-placed team (pts→gd→gf, top 8 of 12
 * advance). Honors actualResults.qualified_for_r32 when present (so the bracket
 * and this list never disagree). Mirrors group-scoring.js ordering.
 * @param {object} data
 * @returns {{ ranked: Array<{team,group,points,gd,gf,in:boolean}>, cutoffRank:number }}
 */
export function bestThirds(data) {
  const groups = data?.groupMatchups ? Object.keys(data.groupMatchups).sort() : [];
  const thirds = [];
  for (const g of groups) {
    const t = groupTable(data, g);
    if (t[2]) thirds.push({ team: t[2].team, group: g, points: t[2].points, gd: t[2].gd, gf: t[2].gf });
  }
  thirds.sort((a, b) =>
    (b.points || 0) - (a.points || 0) ||
    (b.gd || 0) - (a.gd || 0) ||
    (b.gf || 0) - (a.gf || 0) ||
    a.team.localeCompare(b.team),
  );

  // Explicit qualifier list wins when FIFA has published it (last 8 of 32).
  let inSet = null;
  const explicit = data?.actualResults?.qualified_for_r32;
  if (Array.isArray(explicit) && explicit.length === 32) {
    inSet = new Set(explicit.slice(24));
  }

  const ranked = thirds.map((r, i) => ({
    ...r,
    in: inSet ? inSet.has(r.team) : i < 8,
  }));
  return { ranked, cutoffRank: 8 };
}

// Played + remaining fixtures for one team in its group (FINAL-gated).
function teamFixtures(data, group, team) {
  const gs = data?.actualResults?.group_stage || {};
  const gm = data?.groupMatchups?.[group];
  const matches = Array.isArray(gm?.matches) ? gm.matches : [];
  const remaining = [];
  let played = 0;
  for (const m of matches) {
    if (m.team_a !== team && m.team_b !== team) continue;
    const sc = finalScore(gs, m);
    if (sc) played++;
    else remaining.push(m);
  }
  return { played, remaining };
}

/**
 * Plain-language qualification scenario + status for one team.
 * @returns {{ status:'qualified-1st'|'qualified-2nd'|'in-best-third'|'eliminated'|'alive',
 *             needs:string }} — both always non-empty strings.
 */
export function qualificationScenario(data, group, team) {
  const t = groupTable(data, group);
  const row = t.find((r) => r.team === team);
  if (!row) return { status: 'alive', needs: 'Awaiting fixtures.' };

  const complete = t.every((r) => r.complete) && t.length > 0;

  if (complete) {
    if (row.rank === 1) return { status: 'qualified-1st', needs: 'Qualified as group winner.' };
    if (row.rank === 2) return { status: 'qualified-2nd', needs: 'Qualified as group runner-up.' };
    if (row.rank === 3) {
      const bt = bestThirds(data);
      const mine = bt.ranked.find((r) => r.team === team);
      if (mine?.in) {
        return { status: 'in-best-third', needs: 'Through as one of the eight best third-placed teams.' };
      }
      return { status: 'eliminated', needs: 'Eliminated — finished outside the eight best third-placed teams.' };
    }
    return { status: 'eliminated', needs: 'Eliminated — finished bottom of the group.' };
  }

  // Group still in play — enumerate what the team needs from its remaining games.
  const { remaining } = teamFixtures(data, group, team);
  if (!remaining.length) {
    // Team has finished its fixtures but the group hasn't — position is provisional.
    if (row.rank <= 2) return { status: 'alive', needs: `Currently ${ordinal(row.rank)} — needs other results to confirm a top-2 finish.` };
    if (row.rank === 3) return { status: 'alive', needs: 'Currently 3rd — needs to hold on as one of the best third-placed teams.' };
    return { status: 'alive', needs: 'Needs favourable results elsewhere to stay in contention.' };
  }

  const next = remaining[0];
  const opp = next.team_a === team ? next.team_b : next.team_a;
  const games = remaining.length === 1 ? 'final group game' : `${remaining.length} games`;
  let needs;
  if (row.rank <= 2) {
    needs = `Advances with a win over ${opp} in its ${games}; a draw likely still goes through.`;
  } else if (row.rank === 3) {
    needs = `Must win its ${games} (vs ${opp}) to climb into the top two; a draw leaves it relying on best-third math.`;
  } else {
    needs = `Needs to win its ${games} (vs ${opp}) and hope for favourable results to stay alive.`;
  }
  return { status: 'alive', needs };
}

function ordinal(n) {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

export { GROUP_LETTERS };
