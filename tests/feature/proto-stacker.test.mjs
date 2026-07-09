/* proto-stacker.test.mjs — locks the client-side stacker apply math against the
 * Python (sklearn) fit. PROTOTYPE: guards data/proto/stacker.json + app/stack-
 * model.js. If the artifact is absent (proto not generated) the suite is skipped,
 * so this never blocks the main pipeline. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { stackerBlend, applyStacker } from '../../app/stack-model.js';

const ART = 'data/proto/stacker.json';

test('stacker apply matches the sklearn fit on the reference row', { skip: !existsSync(ART) }, () => {
  const artifact = JSON.parse(readFileSync(ART, 'utf8'));
  assert.equal(artifact.coef.length, 3);
  assert.equal(artifact.intercept.length, 3);
  assert.equal(artifact.feature_order.length, 12);

  // The first locked match (Mexico vs South Africa): j5l/dt/market triplets from
  // data/live-backtest.json. sklearn predict_proba on this row (build_stacker.py)
  // = [0.672204, 0.277553, 0.050243]. The JS softmax must reproduce it.
  const j5l = [0.864, 0.095, 0.041];
  const dt = [0.5788, 0.2249, 0.1963];
  const market = [0.6915, 0.204, 0.1045];
  const { a, d, b } = stackerBlend(j5l, dt, market, artifact);
  assert.ok(Math.abs(a - 0.672204) < 1e-4, `a=${a}`);
  assert.ok(Math.abs(d - 0.277553) < 1e-4, `d=${d}`);
  assert.ok(Math.abs(b - 0.050243) < 1e-4, `b=${b}`);
  assert.ok(Math.abs(a + d + b - 1) < 1e-9, 'probabilities sum to 1');
});

test('applyStacker output is always a normalized 3-way distribution', { skip: !existsSync(ART) }, () => {
  const artifact = JSON.parse(readFileSync(ART, 'utf8'));
  for (const feats of [new Array(12).fill(0), new Array(12).fill(1), new Array(12).fill(0.33)]) {
    const { a, d, b } = applyStacker(feats, artifact);
    for (const p of [a, d, b]) assert.ok(p >= 0 && p <= 1, `prob in range: ${p}`);
    assert.ok(Math.abs(a + d + b - 1) < 1e-9, 'sums to 1');
  }
});
