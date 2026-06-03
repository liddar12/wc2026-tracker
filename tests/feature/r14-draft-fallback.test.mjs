import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGroupPicks } from '../../app/group-picks-builder.js';
import { loadBracketDraft } from '../../app/bracket-builder.js';

function mockStorage(seed = {}) {
  const s = new Map(Object.entries(seed));
  return { getItem: (k) => (s.has(k) ? s.get(k) : null), setItem: (k, v) => s.set(k, String(v)), removeItem: (k) => s.delete(k), get length() { return s.size; }, key: (i) => [...s.keys()][i] ?? null };
}

test('R14: loadGroupPicks falls back to .local when the pool key is empty', () => {
  globalThis.localStorage = mockStorage({
    'wc26.grouppicks.local': JSON.stringify({ groups: { A: ['x1','x2','x3','x4'] }, best_thirds: ['x3'] }),
  });
  const picks = loadGroupPicks('pool-123');
  assert.deepEqual(picks.groups.A, ['x1','x2','x3','x4']);
  assert.deepEqual(picks.best_thirds, ['x3']);
});

test('R14: loadGroupPicks prefers the pool key when present (no fallback)', () => {
  globalThis.localStorage = mockStorage({
    'wc26.grouppicks.local': JSON.stringify({ groups: { A: ['local1'] }, best_thirds: [] }),
    'wc26.grouppicks.pool-123': JSON.stringify({ groups: { A: ['pool1','pool2','pool3','pool4'] }, best_thirds: [] }),
  });
  const picks = loadGroupPicks('pool-123');
  assert.equal(picks.groups.A[0], 'pool1');
});

test('R14: loadBracketDraft falls back to .local when pool draft is empty', () => {
  globalThis.localStorage = mockStorage({
    'wc26.mybrackets.local': JSON.stringify({ picks: { '104': { team: 'USA', team_a: 'USA', team_b: 'Brazil' } } }),
  });
  const d = loadBracketDraft('pool-9');
  assert.equal(d.picks['104'].team, 'USA');
});

test('R14: loadBracketDraft local (no pool) reads .local directly', () => {
  globalThis.localStorage = mockStorage({
    'wc26.mybrackets.local': JSON.stringify({ picks: { '73': { team: 'A', team_a: 'A', team_b: 'B' } } }),
  });
  const d = loadBracketDraft(null);
  assert.equal(d.picks['73'].team, 'A');
});
