/* golden-boot-remaining.test.mjs — RCA 2026-07-13 (Golden Awards not updating).
 *
 * Two independent failures froze/faked the Golden Boot mid-knockout:
 * 1. scorers.json went dark 2026-06-30: ESPN's robots.txt now disallows the
 *    site.api team/statistics endpoints, scrape_scorers.py silently no-opped
 *    forever. Fixed by wiring derive_scorers.py (match-events derived, zero
 *    network) into live_update.yml.
 * 2. projGoals added a FULL-tournament expected-matches worth of projected
 *    goals on top of goals already scored — for every contender, including
 *    players whose teams were eliminated (an R16 loser still projected ~5
 *    matches of future goals). Fixed: buildContext derives remainingMatches
 *    = max(0, expectedMatches − played FINAL matches) and the projector uses it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildContext, projectPlayer } from '../../app/lib/golden-boot.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const F = 'STATUS_FULL_TIME';
function fixture() {
  return {
    teams: {
      Alive: { composite: 90, group: 'A', position_ratings: { def: 70 } },
      Out: { composite: 85, group: 'A', position_ratings: { def: 70 } },
      Filler: { composite: 60, group: 'A', position_ratings: { def: 70 } },
    },
    groupMatchups: { A: { teams: ['Alive', 'Out', 'Filler'] } },
    // Alive: reached SF (expected ≈ 7.2 total). Out: eliminated in R32 (expected 4).
    forecast: { teams: [
      { team: 'Alive', r32: 1, r16: 1, qf: 1, sf: 0.9, final: 0.5 },
      { team: 'Out', r32: 1, r16: 0, qf: 0, sf: 0, final: 0 },
    ] },
    // Both played 3 group games; Alive also won R32/R16/QF (one on pens), Out lost its R32.
    actualResults: {
      group_stage: {
        'Alive__vs__Out': { score_a: 2, score_b: 0, status: F },
        'Alive__vs__Filler': { score_a: 2, score_b: 0, status: F },
        'Out__vs__Filler': { score_a: 1, score_b: 0, status: F },
        'Alive__vs__X1': { score_a: 1, score_b: 0, status: F },
        'Out__vs__X2': { score_a: 1, score_b: 0, status: F },
      },
      round_of_32: {
        'Alive__vs__Y1': { score_a: 1, score_b: 0, status: F },
        'Out__vs__Y2': { score_a: 0, score_b: 1, status: F },
      },
      round_of_16: { 'Alive__vs__Y3': { score_a: 1, score_b: 1, status: 'STATUS_FINAL_PEN', winner: 'Alive' } },
      quarterfinals: { 'Alive__vs__Y4': { score_a: 2, score_b: 0, status: F } },
    },
    xg: {},
  };
}

test('remainingMatches: eliminated team clamps to 0; alive team gets expected − played', () => {
  const ctx = buildContext(fixture());
  // Out: expected 3+1 = 4 total, played 4 (3 group + R32, FULL_TIME) → 0 left
  assert.equal(ctx.remainingMatches.Out, 0, 'eliminated team has no remaining matches');
  // Alive: expected 3+1+1+1+0.9+0.5 = 7.4 total, played 6 (PEN R16 counts as played)
  assert.ok(Math.abs(ctx.remainingMatches.Alive - 1.4) < 1e-9,
    `semifinalist remaining ≈ 1.4 (got ${ctx.remainingMatches.Alive})`);
});

test('eliminated player projects NO additional goals; current tally is preserved', () => {
  const ctx = buildContext(fixture());
  const p = projectPlayer({ name: 'Gone Star', team: 'Out', position: 'FWD', scoring: 95 }, ctx, { 'Gone Star': 5 });
  assert.equal(p.projRemaining, 0, 'no projected goals for an eliminated team');
  assert.equal(p.projGoals, 5, 'keeps the achieved tally (can still win the Boot)');
});

test('alive player projects from REMAINING matches, far below the old full-tournament count', () => {
  const ctx = buildContext(fixture());
  const p = projectPlayer({ name: 'Hot Striker', team: 'Alive', position: 'FWD', scoring: 95 }, ctx, { 'Hot Striker': 8 });
  assert.ok(p.projRemaining > 0, 'still projects something for a semifinalist');
  const perMatch = p.projRemaining / (p.factors.deepRun || 1);
  assert.ok(p.factors.deepRun <= 2, `factors.deepRun shows remaining matches (${p.factors.deepRun}), not ~7 total`);
  assert.ok(perMatch < 2, 'sane per-match rate');
});

test('pre-tournament (no results) remainingMatches === expectedMatches — behavior unchanged', () => {
  const data = fixture();
  data.actualResults = {};
  const ctx = buildContext(data);
  assert.deepEqual(ctx.remainingMatches, ctx.expectedMatches);
});

// ---- source / wiring --------------------------------------------------------
test('live_update.yml derives scorers from match events (robots-dead scraper unwired)', () => {
  const y = read('.github/workflows/live_update.yml');
  assert.match(y, /derive_scorers\.py/, 'derive step wired in');
  assert.doesNotMatch(y, /scripts\/scrape_scorers\.py/, 'dead ESPN scraper no longer run');
  assert.ok(y.indexOf('scrape_match_events.py') < y.indexOf('derive_scorers.py'),
    'derivation runs AFTER the match-events scrape it reads from');
});

test('a cron refreshes pipeline_status.json (was wired into no workflow)', () => {
  const y = read('.github/workflows/frequent_update.yml');
  assert.match(y, /build_pipeline_status\.py/);
});
