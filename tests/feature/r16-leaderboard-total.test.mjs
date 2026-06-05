import test from 'node:test';
import assert from 'node:assert/strict';
import { combineLeaderboardEntries } from '../../app/leaderboard-core.js';

// R16 Phase 2: combined leaderboard = group (max 84) + knockout (max 96) = 180.
// Stub scorers make the sum/union/ranking deterministic without actual_results.
// Stubs read a number off the pick fixture so each user's score is predictable.
const deps = {
  scoreBracketWeighted: (picks) => ({
    score: picks?.k || 0,
    breakdown: {}, lastRoundCorrect: false, championCorrect: false,
  }),
  scoreGroupPredictions: (picks) => ({ score: picks?.g || 0 }),
};

const names = { u1: 'Alice', u2: 'Bob', u3: 'Carol' };

test('R16 #L1: total = group + knockout', () => {
  const out = combineLeaderboardEntries(
    [{ user_id: 'u1', picks: { k: 40 }, updated_at: '2026-06-10T00:00:00Z' }],
    [{ user_id: 'u1', picks: { g: 60 }, updated_at: '2026-06-10T01:00:00Z' }],
    names, null, deps
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].groupScore, 60);
  assert.equal(out[0].knockoutScore, 40);
  assert.equal(out[0].score, 100, 'total must be 100, not 40 (the old knockout-only bug)');
  assert.equal(out[0].username, 'Alice');
  assert.equal(out[0].updatedAt, '2026-06-10T01:00:00Z', 'keeps the latest of the two timestamps');
});

test('R16 #L2: unions users present in only one table', () => {
  const out = combineLeaderboardEntries(
    [{ user_id: 'u1', picks: { k: 10 } }],                 // bracket only
    [{ user_id: 'u2', picks: { g: 20 } }],                 // group only
    names, null, deps
  );
  const byName = Object.fromEntries(out.map((e) => [e.username, e]));
  assert.ok(byName.Alice && byName.Bob, 'both users appear');
  assert.equal(byName.Alice.score, 10, 'bracket-only user: group half defaults to 0');
  assert.equal(byName.Alice.groupScore, 0);
  assert.equal(byName.Bob.score, 20, 'group-only user: knockout half defaults to 0');
  assert.equal(byName.Bob.knockoutScore, 0);
});

test('R16 #L3: ranks by combined total (group can change the order)', () => {
  // Bob wins on group despite a lower knockout score than Alice.
  const out = combineLeaderboardEntries(
    [{ user_id: 'u1', picks: { k: 50 } }, { user_id: 'u2', picks: { k: 30 } }],
    [{ user_id: 'u1', picks: { g: 10 } }, { user_id: 'u2', picks: { g: 80 } }],
    names, null, deps
  );
  assert.equal(out[0].username, 'Bob', 'Bob (110) ranks above Alice (60)');
  assert.equal(out[0].score, 110);
  assert.equal(out[1].score, 60);
});

test('R16 #L4: max combined total is 84 + 96 = 180', () => {
  const out = combineLeaderboardEntries(
    [{ user_id: 'u3', picks: { k: 96 } }],
    [{ user_id: 'u3', picks: { g: 84 } }],
    names, null, deps
  );
  assert.equal(out[0].score, 180);
});

test('R16 #L5: ignores rows without a user_id', () => {
  const out = combineLeaderboardEntries(
    [{ picks: { k: 99 } }, { user_id: 'u1', picks: { k: 5 } }],
    [],
    names, null, deps
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].username, 'Alice');
});
