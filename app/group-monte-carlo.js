/* group-monte-carlo.js — E2: simulate each group N times using the model's
   per-match win/draw/win probabilities. Returns P(1st), P(2nd), P(3rd), P(4th)
   per team. Cached in-memory after the first run for the same data version. */

const SIM_ITERATIONS = 5000;
const CACHE = new Map();   // dataVersion -> { [groupLetter]: { team: { p1, p2, p3, p4 } } }

export function groupProbabilities(data, groupLetter) {
  if (!data || !groupLetter) return null;
  const version = data?.meta?.data_version || 'unknown';
  if (!CACHE.has(version)) CACHE.set(version, {});
  const versionCache = CACHE.get(version);
  if (versionCache[groupLetter]) return versionCache[groupLetter];

  const result = simulateGroup(data, groupLetter);
  if (result) versionCache[groupLetter] = result;
  return result;
}

function simulateGroup(data, letter) {
  const info = data?.groupMatchups?.[letter];
  if (!info?.teams || !info?.matches) return null;
  const teams = info.teams;
  const matches = info.matches;
  // Build a [teamA, teamB, P_a, P_draw, P_b] table once
  const table = matches.map((m) => {
    const probs = m.probabilities || {};
    const pa = (probs.team_a_wins || 0) / 100;
    const pd = (probs.draw || 0) / 100;
    const pb = (probs.team_b_wins || 0) / 100;
    // Normalize in case rounding loses some
    const sum = pa + pd + pb;
    return [m.team_a, m.team_b, pa / sum, pd / sum, pb / sum];
  });

  // tally[team][rank-1] += 1
  const tally = Object.fromEntries(teams.map((t) => [t, [0, 0, 0, 0]]));

  for (let i = 0; i < SIM_ITERATIONS; i++) {
    const standings = Object.fromEntries(teams.map((t) => [t, { pts: 0, gd: 0, gf: 0 }]));
    for (const [a, b, pa, pd] of table) {
      const r = Math.random();
      // Use simplified goal model: 2-0/1-0/2-1/1-1/0-0/etc — we just need rank-order,
      // so pts + a small randomized GD/GF tiebreak is enough.
      let ga, gb;
      if (r < pa) { ga = randGoals(2); gb = randGoals(0); standings[a].pts += 3; }
      else if (r < pa + pd) { ga = gb = randGoals(1); standings[a].pts += 1; standings[b].pts += 1; }
      else { gb = randGoals(2); ga = randGoals(0); standings[b].pts += 3; }
      standings[a].gf += ga; standings[a].gd += (ga - gb);
      standings[b].gf += gb; standings[b].gd += (gb - ga);
    }
    const sorted = Object.entries(standings).sort((x, y) =>
      y[1].pts - x[1].pts || y[1].gd - x[1].gd || y[1].gf - x[1].gf
    );
    sorted.forEach(([team], idx) => { if (idx < 4) tally[team][idx]++; });
  }

  // Normalize tallies → probabilities
  const result = {};
  for (const t of teams) {
    const [c1, c2, c3, c4] = tally[t];
    result[t] = {
      p1: c1 / SIM_ITERATIONS,
      p2: c2 / SIM_ITERATIONS,
      p3: c3 / SIM_ITERATIONS,
      p4: c4 / SIM_ITERATIONS,
      // Combined "advance to R32" probability: top-2 OR best-3rd. Best-3rd
      // qualification depends on cross-group comparison; here we just sum
      // p1 + p2 + p3*P(your 3rd-place is among the 8 best). Approximation
      // for display: p1 + p2 + (2/3)*p3 since 8 of 12 thirds advance.
      pAdvance: (c1 + c2) / SIM_ITERATIONS + (8 / 12) * (c3 / SIM_ITERATIONS),
    };
  }
  return result;
}

function randGoals(mean) {
  // Discrete distribution centered on `mean`, max 5.
  // Quick approximation of Poisson(mean) without external deps.
  if (mean === 0) return Math.random() < 0.55 ? 0 : 1;
  if (mean === 1) {
    const r = Math.random();
    if (r < 0.3) return 0;
    if (r < 0.7) return 1;
    if (r < 0.9) return 2;
    return 3;
  }
  // mean ~2
  const r = Math.random();
  if (r < 0.1) return 0;
  if (r < 0.3) return 1;
  if (r < 0.6) return 2;
  if (r < 0.85) return 3;
  if (r < 0.97) return 4;
  return 5;
}
