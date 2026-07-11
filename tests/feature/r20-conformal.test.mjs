/* r20-conformal.test.mjs — R20: split-conformal safe sets over the default
 * model's predictions. Locks the pure set-builder math, the calibration file
 * contract, and the view/cron wiring. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { conformalThreshold, predictionSet, safeSetLabel, OUTCOME_KEYS } from '../../app/lib/conformal.js';
import { stackMatchTriplet } from '../../app/lib/model-pick.js';

const read = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));

test('data/conformal.json: calibrated, on-target coverage, sane threshold', () => {
  const c = json('data/conformal.json');
  assert.equal(c.model, 'stack');
  const d = c.levels[c.display_level];
  assert.ok(d.threshold > 0.05 && d.threshold < 0.5, `threshold sane (${d.threshold})`);
  const target = parseFloat(c.display_level);
  assert.ok(Math.abs(d.empirical_coverage - target) < 0.08,
    `coverage ${d.empirical_coverage} near target ${target}`);
  assert.ok(c.n_calibration >= 25, 'enough calibration matches');
});

test('predictionSet: confident favorite → single outcome; toss-up widens; never empty', () => {
  const thr = 0.21;
  assert.deepEqual(predictionSet([0.80, 0.14, 0.06], thr), ['team_a'], 'strong favorite is a one-outcome set');
  assert.deepEqual(predictionSet([0.55, 0.26, 0.19], thr), ['team_a', 'draw'], 'close match adds the draw');
  assert.deepEqual(predictionSet([0.35, 0.31, 0.34], thr), ['team_a', 'team_b', 'draw'], 'toss-up covers everything');
  // pathological: nothing clears an absurd threshold → top pick still returned
  assert.deepEqual(predictionSet([0.4, 0.3, 0.3], 0.9), ['team_a'], 'never empty');
});

test('safeSetLabel: readable labels', () => {
  assert.equal(safeSetLabel(['team_a', 'draw'], 'France', 'Morocco'), 'France or draw');
  assert.equal(safeSetLabel(['team_b'], 'France', 'Morocco'), 'Morocco');
  assert.equal(safeSetLabel(['team_a', 'draw', 'team_b'], 'A', 'B'), 'any result');
  assert.equal(OUTCOME_KEYS.length, 3);
});

test('conformalThreshold reads the display level; junk → null', () => {
  assert.equal(conformalThreshold({ display_level: '0.85', levels: { '0.85': { threshold: 0.21 } } }), 0.21);
  assert.equal(conformalThreshold({}), null);
  assert.equal(conformalThreshold(null), null);
  assert.equal(conformalThreshold({ display_level: '0.85', levels: { '0.85': { threshold: 2 } } }), null);
});

test('stackMatchTriplet returns a normalized 3-way distribution', () => {
  const data = { stacker: { strengths: { France: 1.79, Morocco: -0.2 } } };
  const t = stackMatchTriplet(data, 'France', 'Morocco');
  assert.ok(Array.isArray(t) && t.length === 3);
  assert.ok(Math.abs(t[0] + t[1] + t[2] - 1) < 1e-9, 'sums to 1');
  assert.ok(t[0] > t[2], 'stronger side favored');
  assert.equal(stackMatchTriplet({ stacker: { strengths: {} } }, 'X', 'Y'), null);
});

test('wiring: cron step + data-loader + matchup pill + backtest coverage line', () => {
  for (const wf of ['frequent_update', 'live_update']) {
    assert.match(read(`.github/workflows/${wf}.yml`), /build_conformal\.py/, `${wf} recalibrates`);
  }
  assert.match(read('app/data-loader.js'), /conformal\.json/, 'data-loader registers conformal.json');
  assert.match(read('app/views/matchup-detail.js'), /safe-set/, 'matchup pill renders the safe set');
  assert.match(read('app/views/backtest-view.js'), /conformal-coverage/, 'backtest shows coverage');
  const s = read('scripts/build_conformal.py');
  assert.match(s, /\(n \+ 1\) \* \(1 - alpha\)/, 'finite-sample conformal quantile');
});
