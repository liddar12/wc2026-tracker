import test from 'node:test';
import assert from 'node:assert/strict';
import { bracketToPickArray } from '../../app/bracket-builder.js';

test('R14: bracketToPickArray converts funnel draft to [{team_a,team_b,choice}]', () => {
  const draft = { picks: {
    '73': { team: 'USA', team_a: 'USA', team_b: 'Mexico' },
    '74': { team: 'Brazil', team_a: 'Argentina', team_b: 'Brazil' },
    '104': { team: 'USA', team_a: 'USA', team_b: 'Brazil' },
  } };
  const arr = bracketToPickArray(draft);
  assert.equal(arr.length, 3);
  assert.deepEqual(arr[0], { team_a: 'USA', team_b: 'Mexico', choice: 'team_a' });
  assert.deepEqual(arr[1], { team_a: 'Argentina', team_b: 'Brazil', choice: 'team_b' });
});

test('R14: bracketToPickArray skips legacy string entries + incomplete pairs', () => {
  const draft = { picks: {
    '73': 'USA',                                   // legacy string — skip
    '74': { team: 'Brazil' },                       // missing pair — skip
    '75': { team: 'France', team_a: 'France', team_b: 'Spain' }, // valid
    '76': { team: 'Ghost', team_a: 'A', team_b: 'B' },           // team not in pair — skip
  } };
  const arr = bracketToPickArray(draft);
  assert.equal(arr.length, 1);
  assert.deepEqual(arr[0], { team_a: 'France', team_b: 'Spain', choice: 'team_a' });
});

test('R14: bracketToPickArray handles empty/missing draft', () => {
  assert.deepEqual(bracketToPickArray(null), []);
  assert.deepEqual(bracketToPickArray({}), []);
  assert.deepEqual(bracketToPickArray({ picks: {} }), []);
});
