/* crowd-adjust.test.mjs — 2026-07-19 crowd-factor layer.
 *
 * A known partisan-crowd asymmetry is applied as a FIXED, literature-anchored
 * prior on top of the model's advance probability (never fitted from our data —
 * a crowd term is noise on 28 knockouts, docs/CROWD_ANALYSIS.md). These lock:
 * the ratio->delta mapping, the probability shift toward the supported side,
 * anchoring to the displayed advance_pct, and — critically — that no model /
 * scoring / bracket path imports the layer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deltaGoalsForRatio, crowdAdjustment, twoWayFromGap } from '../../app/lib/crowd-adjust.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('deltaGoalsForRatio: 1:1 -> 0, 3:1 -> 0.15 central, monotonic + capped', () => {
  assert.equal(deltaGoalsForRatio(1, 'central'), 0, 'even crowd = no effect');
  assert.ok(Math.abs(deltaGoalsForRatio(3, 'central') - 0.15) < 1e-9, '3:1 central = 0.15 goals');
  assert.ok(deltaGoalsForRatio(2, 'central') < deltaGoalsForRatio(3, 'central'), 'monotonic in ratio');
  assert.ok(deltaGoalsForRatio(3, 'strong') > deltaGoalsForRatio(3, 'central'), 'strong > central');
  assert.ok(deltaGoalsForRatio(50, 'central') <= 0.15 * 1.4 + 1e-9, 'capped for extreme ratios');
});

test('crowdAdjustment: anchors to advance_pct and shifts toward the crowd side', () => {
  const data = { crowd: { 'Spain__vs__Argentina': { favored: 'Argentina', ratio: 3, calibration: 'central' } } };
  const match = { team_a: 'Spain', team_b: 'Argentina', advance_pct_a: 60.7, advance_pct_b: 39.3 };
  const adj = crowdAdjustment(data, match);
  assert.ok(adj, 'adjustment present');
  assert.equal(adj.base.Spain, 60.7, 'base anchored to the model advance %');
  assert.ok(adj.adjusted.Argentina > adj.base.Argentina, 'crowd-favored side gains');
  assert.ok(adj.adjusted.Spain < adj.base.Spain, 'opponent loses');
  // conservation: the two sides still sum to ~100
  assert.ok(Math.abs(adj.adjusted.Spain + adj.adjusted.Argentina - 100) < 0.2);
  // central 3:1 is a few points, not a landslide (does not flip a 60/40)
  assert.ok(adj.deltaPct > 1 && adj.deltaPct < 7, `plausible shift (${adj.deltaPct}pp)`);
  assert.ok(adj.adjusted.Spain > 50, 'a 61/39 favorite is narrowed, not flipped');
});

test('crowdAdjustment: favored=team_a shifts the other way; symmetric', () => {
  const data = { crowd: { 'A__vs__B': { favored: 'A', ratio: 3 } } };
  const adj = crowdAdjustment(data, { team_a: 'A', team_b: 'B', advance_pct_a: 50, advance_pct_b: 50 });
  assert.ok(adj.adjusted.A > 50 && adj.adjusted.B < 50, 'even match tilts to the supported side');
});

test('crowdAdjustment: falls back to the stack two-way when no advance_pct', () => {
  const data = {
    crowd: { 'Spain__vs__Argentina': { favored: 'Argentina', ratio: 3 } },
    stacker: { strengths: { Spain: 2.0, Argentina: 1.6 } },
  };
  const adj = crowdAdjustment(data, { team_a: 'Spain', team_b: 'Argentina' });
  assert.ok(adj, 'works off stack strengths');
  const expectedBase = Math.round(twoWayFromGap(2.0 - 1.6) * 1000) / 10;
  assert.equal(adj.base.Spain, expectedBase, 'base is the stack two-way');
  assert.ok(adj.adjusted.Argentina > adj.base.Argentina);
});

test('crowdAdjustment: null when no entry, unknown favored, or unrated', () => {
  assert.equal(crowdAdjustment({ crowd: {} }, { team_a: 'A', team_b: 'B', advance_pct_a: 50 }), null);
  assert.equal(crowdAdjustment({ crowd: { 'A__vs__B': { favored: 'C', ratio: 3 } } },
    { team_a: 'A', team_b: 'B', advance_pct_a: 50 }), null, 'favored must be one of the two teams');
  assert.equal(crowdAdjustment({ crowd: { 'A__vs__B': { favored: 'A', ratio: 3 } } },
    { team_a: 'A', team_b: 'B' }), null, 'no advance_pct and no stack -> null');
});

test('the real data/crowd.json entry is well-formed for the final', () => {
  const c = JSON.parse(read('data/crowd.json'));
  const e = c['Spain__vs__Argentina'] || c['Argentina__vs__Spain'];
  assert.ok(e && e.favored === 'Argentina' && e.ratio === 3, 'final entry: Argentina 3:1');
});

// ---- source / wiring --------------------------------------------------------
test('crowd factor is display-only: no model/scoring/bracket path imports it', () => {
  for (const f of ['app/bracket-autofill.js', 'app/lib/model-pick.js', 'app/bracket-resolver.js',
    'app/competition-scoring.js', 'app/lib/golden-boot.js']) {
    assert.ok(!read(f).includes('crowd-adjust'), `${f} must not consume the crowd layer`);
  }
});

test('the matchup page mounts the crowd factor + loader exposes data.crowd', () => {
  assert.match(read('app/views/matchup-detail.js'), /crowdFactorSection/, 'matchup view mounts it');
  assert.match(read('app/components/crowd-factor.js'), /never feeds the projection/, 'transparency disclaimer');
  assert.match(read('app/data-loader.js'), /crowd\.json/, 'loader fetches crowd.json');
});
