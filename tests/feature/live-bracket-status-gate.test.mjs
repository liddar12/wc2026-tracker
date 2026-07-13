/* live-bracket-status-gate.test.mjs — RCA 2026-07-13 (pre-SF hardening).
 *
 * The Bracket/Projected view's Live mode had its own winnerFor resolver that
 * derived a winner from raw scores with NO status gate (and read a
 * `penalty_winner` field that exists nowhere in the data — pens are recorded
 * as `winner` + method). During a live knockout match the in-memory
 * actualResults record is an in-progress overlay (mergeLiveScores), so a 1-0
 * first-half lead advanced the leader into the next-round card mid-match.
 * Fix: renderLive passes no winnerResolver — advancement comes only from the
 * status-gated lookupActual inside resolveSlots. These tests lock that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSlots } from '../../app/bracket-resolver.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const SF_FINAL_SCHEDULE = () => ([
  { match_number: 101, stage: 'semifinals', team_a: 'France', team_b: 'Spain' },
  { match_number: 102, stage: 'semifinals', team_a: 'England', team_b: 'Argentina' },
  { match_number: 103, stage: 'third_place', team_a: 'L101', team_b: 'L102' },
  { match_number: 104, stage: 'final', team_a: 'W101', team_b: 'W102' },
]);

test('a live in-progress lead does NOT advance the leader into the final slot', () => {
  const ko = SF_FINAL_SCHEDULE();
  const data = { actualResults: { semifinals: {
    'France__vs__Spain': { score_a: 1, score_b: 0, status: 'STATUS_FIRST_HALF' },
    'England__vs__Argentina': { score_a: 0, score_b: 0, status: 'STATUS_SCHEDULED' },
  } } };
  resolveSlots(ko, data);
  assert.equal(ko[0].projected_winner, null, 'first-half 1-0 lead must not be a winner');
  assert.equal(ko[3].resolved_team_a, 'W101', 'final slot stays a placeholder mid-match');
  assert.equal(ko[2].resolved_team_a, 'L101', 'bronze slot stays a placeholder mid-match');
});

test('a 0-0 STATUS_SCHEDULED stub does NOT advance anyone', () => {
  const ko = SF_FINAL_SCHEDULE();
  const data = { actualResults: { semifinals: {
    'France__vs__Spain': { score_a: 0, score_b: 0, status: 'STATUS_SCHEDULED' },
  } } };
  resolveSlots(ko, data);
  assert.equal(ko[0].projected_winner, null);
  assert.equal(ko[3].resolved_team_a, 'W101');
});

test('a STATUS_FINAL_PEN record advances the shootout winner (winner flag, tied score)', () => {
  const ko = SF_FINAL_SCHEDULE();
  const data = { actualResults: { semifinals: {
    'France__vs__Spain': { score_a: 1, score_b: 1, status: 'STATUS_FINAL_PEN', winner: 'Spain', method: 'pens' },
  } } };
  resolveSlots(ko, data);
  assert.equal(ko[0].projected_winner, 'Spain');
  assert.equal(ko[3].resolved_team_a, 'Spain', 'shootout winner fills the final slot');
  assert.equal(ko[2].resolved_team_a, 'France', 'shootout loser fills the bronze slot');
});

test('a STATUS_FULL_TIME record advances the winner into the final slot', () => {
  const ko = SF_FINAL_SCHEDULE();
  const data = { actualResults: { semifinals: {
    'France__vs__Spain': { score_a: 2, score_b: 0, status: 'STATUS_FULL_TIME', winner: 'France' },
  } } };
  resolveSlots(ko, data);
  assert.equal(ko[0].projected_winner, 'France');
  assert.equal(ko[3].resolved_team_a, 'France');
});

// ---- source / wiring --------------------------------------------------------
test('bracket-view-r6 live mode has no ungated winner resolver of its own', () => {
  const s = read('app/views/bracket-view-r6.js');
  assert.match(s, /resolveSlots\(ko, data\);/, 'live mode resolves via the gated lookupActual only');
  assert.doesNotMatch(s, /penalty_winner/, 'no phantom penalty_winner field (pens use `winner`)');
  assert.doesNotMatch(s, /winnerFor/, 'no view-local score-derived winner resolver');
});
