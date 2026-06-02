import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyPicks,
  setRankForGroup,
  toggleBestThird,
  isStage1Complete,
  isStage2Complete,
  groupsComplete,
  stage1WhatsLeft,
  stage2WhatsLeft,
  listThirdsCandidates,
  GROUP_LETTERS,
  REQUIRED_THIRDS,
  reorderBestThirds,
  isThirdsCandidate,
  clearRankForGroup,
} from '../../app/group-picks-builder.js';

test('empty picks: all 12 groups exist with 4 empty slots, no thirds', () => {
  const p = emptyPicks();
  assert.equal(Object.keys(p.groups).length, 12);
  for (const l of GROUP_LETTERS) {
    assert.deepEqual(p.groups[l], [null, null, null, null]);
  }
  assert.deepEqual(p.best_thirds, []);
  assert.equal(isStage1Complete(p), false);
  assert.equal(isStage2Complete(p), false);
});

test('setRankForGroup places team at rank and removes prior placement', () => {
  let p = emptyPicks();
  p = setRankForGroup(p, 'A', 1, 'Mexico');
  assert.equal(p.groups.A[0], 'Mexico');
  // Re-rank same team at 2 → slot 1 cleared
  p = setRankForGroup(p, 'A', 2, 'Mexico');
  assert.equal(p.groups.A[0], null);
  assert.equal(p.groups.A[1], 'Mexico');
});

test('isStage1Complete requires all 12 groups ordered 1-4 with no dupes', () => {
  let p = emptyPicks();
  // Fill 11 groups
  for (const l of GROUP_LETTERS.slice(0, 11)) {
    p = setRankForGroup(p, l, 1, `${l}1`);
    p = setRankForGroup(p, l, 2, `${l}2`);
    p = setRankForGroup(p, l, 3, `${l}3`);
    p = setRankForGroup(p, l, 4, `${l}4`);
  }
  assert.equal(isStage1Complete(p), false);
  // Fill the 12th
  p = setRankForGroup(p, 'L', 1, 'L1');
  p = setRankForGroup(p, 'L', 2, 'L2');
  p = setRankForGroup(p, 'L', 3, 'L3');
  p = setRankForGroup(p, 'L', 4, 'L4');
  assert.equal(isStage1Complete(p), true);
  assert.equal(stage1WhatsLeft(p), null);
});

test('stage1WhatsLeft reports number of missing groups', () => {
  let p = emptyPicks();
  p = setRankForGroup(p, 'A', 1, 'A1');
  p = setRankForGroup(p, 'A', 2, 'A2');
  p = setRankForGroup(p, 'A', 3, 'A3');
  p = setRankForGroup(p, 'A', 4, 'A4');
  const left = stage1WhatsLeft(p);
  assert.match(left, /11 groups unordered/);
});

test('toggleBestThird only accepts teams that hold rank 3 in some group', () => {
  let p = emptyPicks();
  p = setRankForGroup(p, 'A', 3, 'Aussies');
  p = setRankForGroup(p, 'B', 3, 'Berlin');
  // Aussies is a candidate; non-listed team is not
  p = toggleBestThird(p, 'Aussies');
  assert.deepEqual(p.best_thirds, ['Aussies']);
  p = toggleBestThird(p, 'NonexistentTeam');
  assert.deepEqual(p.best_thirds, ['Aussies']);
  // Berlin is a candidate
  p = toggleBestThird(p, 'Berlin');
  assert.deepEqual(p.best_thirds, ['Aussies', 'Berlin']);
});

test('isStage2Complete requires exactly 8 valid thirds', () => {
  let p = emptyPicks();
  for (let i = 0; i < REQUIRED_THIRDS; i++) {
    const l = GROUP_LETTERS[i];
    p = setRankForGroup(p, l, 3, `${l}_third`);
    p = toggleBestThird(p, `${l}_third`);
  }
  assert.equal(isStage2Complete(p), true);
  // Remove one to break completeness
  p = toggleBestThird(p, 'A_third');
  assert.equal(isStage2Complete(p), false);
  assert.equal(stage2WhatsLeft(p), 'Stage 2: 7/8 thirds ranked');
});

test('toggleBestThird caps at REQUIRED_THIRDS', () => {
  let p = emptyPicks();
  for (let i = 0; i < 12; i++) {
    const l = GROUP_LETTERS[i];
    p = setRankForGroup(p, l, 3, `${l}_third`);
    p = toggleBestThird(p, `${l}_third`);
  }
  assert.equal(p.best_thirds.length, REQUIRED_THIRDS);
});

test('reorderBestThirds moves entries without losing them', () => {
  let p = emptyPicks();
  for (let i = 0; i < 4; i++) {
    const l = GROUP_LETTERS[i];
    p = setRankForGroup(p, l, 3, `${l}_third`);
    p = toggleBestThird(p, `${l}_third`);
  }
  const before = [...p.best_thirds];
  p = reorderBestThirds(p, 0, 2);
  assert.equal(p.best_thirds.length, before.length);
  assert.equal(p.best_thirds[2], before[0]);
});

test('clearing 3rd-place rank removes orphaned best_third', () => {
  let p = emptyPicks();
  p = setRankForGroup(p, 'A', 3, 'A_third');
  p = toggleBestThird(p, 'A_third');
  assert.deepEqual(p.best_thirds, ['A_third']);
  p = clearRankForGroup(p, 'A', 3);
  // Best thirds rebuilt; A_third is no longer a candidate
  assert.equal(isThirdsCandidate('A_third', p), false);
  assert.deepEqual(p.best_thirds, []);
});

test('groupsComplete returns only fully-ordered group letters', () => {
  let p = emptyPicks();
  p = setRankForGroup(p, 'A', 1, 'a1');
  p = setRankForGroup(p, 'A', 2, 'a2');
  p = setRankForGroup(p, 'A', 3, 'a3');
  p = setRankForGroup(p, 'A', 4, 'a4');
  p = setRankForGroup(p, 'B', 1, 'b1'); // partial
  const done = groupsComplete(p);
  assert.deepEqual(done, ['A']);
});

test('listThirdsCandidates returns one row per group that has a 3rd-place pick', () => {
  let p = emptyPicks();
  p = setRankForGroup(p, 'A', 3, 'A_third');
  p = setRankForGroup(p, 'C', 3, 'C_third');
  const cs = listThirdsCandidates(p);
  assert.equal(cs.length, 2);
  assert.deepEqual(cs.map((c) => c.group), ['A', 'C']);
});
