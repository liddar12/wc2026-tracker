import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isSlotPlaceholder, projectWinner, computeGroupStandings, resolveThirdSlot,
} from '../../app/bracket-resolver.js';

const groupMatchups = JSON.parse(fs.readFileSync('data/group_matchups.json', 'utf8'));

test('R14: isSlotPlaceholder detects 1A / 2B / "3 ABC" / W74 forms', () => {
  assert.equal(isSlotPlaceholder('1A'), true);
  assert.equal(isSlotPlaceholder('2B'), true);
  assert.equal(isSlotPlaceholder('3 ABCDF'), true);
  assert.equal(isSlotPlaceholder('W74'), true);
  assert.equal(isSlotPlaceholder('USA'), false);
});

test('R14: projectWinner uses composite; falls back without throwing', () => {
  const data = { teams: { A: { composite: 80 }, B: { composite: 60 }, C: {} } };
  assert.equal(projectWinner(data, 'A', 'B'), 'A');
  assert.equal(projectWinner(data, 'B', 'A'), 'A');
  // missing composite -> returns first team (documented fallback), no throw
  assert.equal(projectWinner(data, 'C', 'A'), 'C');
  // placeholders -> null
  assert.equal(projectWinner(data, '1A', 'B'), null);
  // single side
  assert.equal(projectWinner(data, 'A', null), 'A');
});

test('R14: computeGroupStandings returns null until a group is fully played', () => {
  // No actual results -> not fully played -> null
  const data = { groupMatchups, actualResults: { group_stage: {} } };
  const letter = Object.keys(groupMatchups)[0];
  assert.equal(computeGroupStandings(data, letter), null);
});

test('R14: computeGroupStandings ranks by points then GD then GF when complete', () => {
  // Build a synthetic 4-team group fully played: A beats all, B 2nd, etc.
  const teams = ['A','B','C','D'];
  const matches = [];
  const pairs = [['A','B'],['A','C'],['A','D'],['B','C'],['B','D'],['C','D']];
  for (const [x,y] of pairs) matches.push({ team_a: x, team_b: y });
  const gm = { Z: { teams, matches } };
  const gs = {};
  // A wins all 3, B wins 2 (beats C,D), C wins 1 (beats D), D loses all
  const score = (x,y) => {
    const order = { A:4, B:3, C:2, D:1 };
    return order[x] > order[y] ? { score_a: 2, score_b: 0 } : { score_a: 0, score_b: 2 };
  };
  for (const [x,y] of pairs) gs[`${x}__vs__${y}`] = score(x,y);
  const data = { groupMatchups: gm, actualResults: { group_stage: gs } };
  const standings = computeGroupStandings(data, 'Z');
  assert.ok(standings, 'should be complete');
  assert.deepEqual(standings.map((r) => r.team), ['A','B','C','D']);
  assert.equal(standings[0].points, 9);
});
