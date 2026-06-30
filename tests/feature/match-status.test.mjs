/* match-status.test.mjs — Phase 0 foundation lib (RCA 2026-06-30).
 *
 * Locks the shared status contract that the knockout fixes depend on: method of
 * victory (FT/AET/pens), winner derivation (explicit winner for ties, score for
 * regulation), and STATUS-FIRST mode classification (a past-kickoff match with no
 * record is 'pending', never a phantom 'final'/'live'). Also smoke-tests the
 * tournament-phase helper against the real data files (today = knockout stage).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FINAL_STATUSES, LIVE_STATUSES, isFinalStatus, isLiveStatus,
  methodOfVictory, winnerFromRecord, deriveMode,
} from '../../app/lib/match-status.js';
import { currentPhase } from '../../app/lib/phase.js';

const root = new URL('../../', import.meta.url);
const readJson = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

test('FINAL_STATUSES includes the knockout-only resolutions (AET/PEN)', () => {
  assert.ok(FINAL_STATUSES.has('STATUS_FINAL_AET'));
  assert.ok(FINAL_STATUSES.has('STATUS_FINAL_PEN'));
  assert.ok(FINAL_STATUSES.has('STATUS_FULL_TIME'));
  assert.ok(!LIVE_STATUSES.has('STATUS_FINAL_PEN'));
});

test('isFinalStatus / isLiveStatus', () => {
  assert.equal(isFinalStatus({ status: 'STATUS_FULL_TIME' }), true);
  assert.equal(isFinalStatus({ status: 'STATUS_FINAL_PEN' }), true);
  assert.equal(isFinalStatus({}), true, 'legacy record with no status reads final');
  assert.equal(isFinalStatus({ status: 'STATUS_FIRST_HALF' }), false);
  assert.equal(isLiveStatus({ status: 'STATUS_FIRST_HALF' }), true);
  assert.equal(isLiveStatus({ status: 'STATUS_SHOOTOUT' }), true);
  assert.equal(isLiveStatus({ status: 'STATUS_SCHEDULED' }), false);
});

test('methodOfVictory maps status → method/label/suffix', () => {
  assert.deepEqual(methodOfVictory({ status: 'STATUS_FULL_TIME' }),
    { method: 'reg', label: 'FT', suffix: '', shootout: null });
  assert.equal(methodOfVictory({ status: 'STATUS_FINAL_AET' }).method, 'aet');
  assert.equal(methodOfVictory({ status: 'STATUS_FINAL_AET' }).label, 'AET');

  const pen = methodOfVictory({ status: 'STATUS_FINAL_PEN', shootout_a: 2, shootout_b: 4 });
  assert.equal(pen.method, 'pens');
  assert.equal(pen.label, 'pens');
  assert.equal(pen.suffix, ' (4–2)', 'high–low, en-dash');
  assert.deepEqual(pen.shootout, { a: 2, b: 4 });

  assert.equal(methodOfVictory({ status: 'STATUS_FIRST_HALF' }).method, null,
    'a live match has no method yet');
});

test('winnerFromRecord prefers explicit winner, else derives from score', () => {
  // Penalty tie: only the explicit winner is correct (1-1 score is a draw).
  assert.equal(
    winnerFromRecord({ status: 'STATUS_FINAL_PEN', winner: 'Morocco', score_a: 1, score_b: 1 }),
    'Morocco');
  // Regulation knockout win with no explicit winner → derive from the score.
  assert.equal(
    winnerFromRecord({ status: 'STATUS_FULL_TIME', score_a: 2, score_b: 1 }, 'Brazil', 'Japan'),
    'Brazil');
  // Draw with no winner → null.
  assert.equal(
    winnerFromRecord({ status: 'STATUS_FULL_TIME', score_a: 1, score_b: 1 }, 'A', 'B'), null);
  // Live → null.
  assert.equal(
    winnerFromRecord({ status: 'STATUS_FIRST_HALF', score_a: 1, score_b: 0 }, 'A', 'B'), null);
});

test('deriveMode is STATUS-FIRST with a stage-aware clock fallback', () => {
  const now = Date.parse('2026-06-30T20:00:00Z');
  const kHr = (h) => new Date(now - h * 3600 * 1000).toISOString();

  // Status decides outright, regardless of the clock.
  assert.equal(deriveMode({ status: 'STATUS_FULL_TIME' }, kHr(10), { now }), 'final');
  assert.equal(deriveMode({ status: 'STATUS_SECOND_HALF' }, kHr(10), { now }), 'live');

  // No record → clock fallback.
  assert.equal(deriveMode(null, new Date(now + 3600 * 1000).toISOString(), { now }), 'upcoming');
  // Knockout 3h window: 2h after kickoff with no record is still live...
  assert.equal(deriveMode(null, kHr(2), { stage: 'round_of_32', now }), 'live');
  // ...but past the 3h knockout window with no record it is 'pending', NOT 'final'.
  assert.equal(deriveMode(null, kHr(4), { stage: 'round_of_32', now }), 'pending');
  // Group window is shorter (2h): 2.5h past kickoff is already 'pending'.
  assert.equal(deriveMode(null, kHr(2.5), { stage: 'group', now }), 'pending');
  // A STATUS_SCHEDULED stub whose kickoff just passed is NOT 'live' forever — it
  // follows the same clock fallback (within window → live placeholder).
  assert.equal(deriveMode({ status: 'STATUS_SCHEDULED' }, kHr(0.5), { stage: 'round_of_32', now }), 'live');
});

test('currentPhase reports the knockout stage from the real data files', () => {
  const data = {
    scheduleFull: readJson('data/schedule_full.json'),
    actualResults: readJson('data/actual_results.json'),
  };
  // A fixed instant during the R32 window (deterministic, calendar-independent).
  const p = currentPhase(data, Date.parse('2026-06-30T18:00:00Z'));
  assert.equal(p.isKnockout, true, 'on 2026-06-30 the tournament is in the knockout phase');
  assert.equal(p.phase, 'knockout');
  assert.ok(['round_of_32', 'round_of_16', 'quarterfinals', 'semifinals', 'final'].includes(p.round));
});

test('currentPhase returns pre / complete at the boundaries', () => {
  assert.equal(currentPhase({ scheduleFull: [], actualResults: {} }).phase, 'pre');
  const complete = currentPhase({
    scheduleFull: [], actualResults: { final: { x: { status: 'STATUS_FULL_TIME', score_a: 1, score_b: 0 } } },
  });
  assert.equal(complete.phase, 'complete');
});
