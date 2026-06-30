/* model-accuracy-data.test.mjs — RJ30-11: lock the data contract the
   model-accuracy view depends on. Every scored match in data/live-backtest.json
   must carry, per model, a score with correct∈{0,1} + numeric brier, and a valid
   `actual` outcome label. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const live = JSON.parse(readFileSync(new URL('data/live-backtest.json', root), 'utf8'));

const VALID_ACTUAL = new Set(['team_a_wins', 'draw', 'team_b_wins']);

test('live-backtest.json has a matches map + a summary', () => {
  assert.ok(live.matches && typeof live.matches === 'object');
  assert.ok(live.summary && typeof live.summary === 'object');
});

test('every scored match has a valid actual + at least one well-formed model score', () => {
  const scored = Object.entries(live.matches).filter(([, m]) => m && m.scored === true);
  // It is valid for the board to be empty pre-tournament; if there are scored
  // matches, each must satisfy the contract.
  for (const [key, m] of scored) {
    assert.ok(VALID_ACTUAL.has(m.actual), `${key}: actual ${m.actual} must be a W/D/L label`);
    assert.ok(m.score && typeof m.score === 'object', `${key}: has a score map`);
    const models = Object.keys(m.score);
    assert.ok(models.length >= 1, `${key}: at least one model scored`);
    let well = 0;
    for (const k of models) {
      const sc = m.score[k];
      if (!sc) continue;
      assert.ok(sc.correct === 0 || sc.correct === 1, `${key}.${k}: correct ∈ {0,1}`);
      assert.equal(typeof sc.brier, 'number', `${key}.${k}: numeric brier`);
      well += 1;
    }
    assert.ok(well >= 1, `${key}: at least one well-formed model score`);
  }
});

test('summary per-model rows carry correct/total/brier the header reads verbatim', () => {
  for (const k of ['model', 'dt', 'market', 'hybrid']) {
    const s = live.summary[k];
    if (!s) continue; // a model leg may be absent very early
    assert.equal(typeof s.correct, 'number', `summary.${k}.correct numeric`);
    assert.equal(typeof s.total, 'number', `summary.${k}.total numeric`);
    assert.ok(s.brier == null || typeof s.brier === 'number', `summary.${k}.brier numeric-or-null`);
  }
});
