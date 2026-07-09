import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODELS,
  MODEL_LABELS,
  MODEL_TO_AUTOFILL_SOURCE,
  getDefaultModel,
  setDefaultModel,
  getActiveModel,
  setActiveModel,
  modelToAutofillSource,
} from '../../app/lib/active-model.js';
import { teamAnalytics, rankTeamsByModel } from '../../app/lib/team-analytics.js';

function mockStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
  };
}

test('R12b/R16: MODELS list contains the documented models incl. DT', () => {
  assert.deepEqual(MODELS, ['j5l', 'dt', 'kalshi', 'hybrid', 'stack']);
  for (const m of MODELS) {
    assert.ok(MODEL_LABELS[m], `missing label for ${m}`);
    assert.ok(MODEL_TO_AUTOFILL_SOURCE[m], `missing autofill mapping for ${m}`);
  }
});

test('R12b: getActiveModel falls back to default when nothing set', () => {
  const s = mockStorage();
  // R17: default forecast is now the "J5L AI Enhanced" stack model.
  assert.equal(getActiveModel(s), 'stack');
});

test('R12b: setActiveModel writes and getActiveModel returns it', () => {
  const s = mockStorage();
  setActiveModel('kalshi', s);
  assert.equal(getActiveModel(s), 'kalshi');
});

test('R12b: setDefaultModel + getActiveModel chain', () => {
  const s = mockStorage();
  setDefaultModel('hybrid', s);
  // Active picks default when no explicit active is set
  assert.equal(getActiveModel(s), 'hybrid');
  // Setting active overrides default
  setActiveModel('stack', s);
  assert.equal(getActiveModel(s), 'stack');
  assert.equal(getDefaultModel(s), 'hybrid');
});

test('R12b: modelToAutofillSource maps to bracket-autofill ids', () => {
  assert.equal(modelToAutofillSource('j5l'), 'model');
  assert.equal(modelToAutofillSource('dt'), 'dt');
  assert.equal(modelToAutofillSource('kalshi'), 'kalshi');
  assert.equal(modelToAutofillSource('hybrid'), 'hybrid');
  assert.equal(modelToAutofillSource('stack'), 'stack');
});

test('R12b: teamAnalytics returns sensible structure for each model', () => {
  const data = {
    teams: { USA: { composite: 75.5, power_rank: 8, fifa_rank: 15 } },
    markets: { tournament_winner: [{ team: 'USA', prob_pct: 5.2 }] },
  };
  const j5l = teamAnalytics('USA', data, 'j5l');
  assert.equal(j5l.primary.label, 'J5L');
  assert.equal(j5l.primary.value, '75.5');
  assert.ok(j5l.secondary.find((r) => r.label === 'Power' && r.value === '#8'));

  const kalshi = teamAnalytics('USA', data, 'kalshi');
  assert.equal(kalshi.primary.label, 'Markets');
  assert.equal(kalshi.primary.value, '5.2%');

  const hybrid = teamAnalytics('USA', data, 'hybrid');
  assert.equal(hybrid.primary.label, 'Hybrid');
  assert.equal(hybrid.primary.value, '40'); // round((75.5 + 5.2)/2) = 40

  // "J5L AI Enhanced" (stack): learned J5L+DT blend; chip shows the J5L composite
  // headline under an "AI Blend" label, and ranks by the stacker strength.
  const stackData = { ...data, stacker: { strengths: { USA: 1.4 } } };
  const stack = teamAnalytics('USA', stackData, 'stack');
  assert.equal(stack.primary.label, 'AI Blend');
  assert.equal(stack.primary.value, '75.5');
});

test('R12b: rankTeamsByModel sorts by chosen signal', () => {
  const data = {
    teams: {
      A: { composite: 80 },
      B: { composite: 60 },
      C: { composite: 90 },
    },
    markets: {
      tournament_winner: [
        { team: 'A', prob_pct: 1 },
        { team: 'B', prob_pct: 50 },
        { team: 'C', prob_pct: 25 },
      ],
    },
  };
  assert.deepEqual(rankTeamsByModel(['A', 'B', 'C'], data, 'j5l'), ['C', 'A', 'B']);
  assert.deepEqual(rankTeamsByModel(['A', 'B', 'C'], data, 'kalshi'), ['B', 'C', 'A']);
});
