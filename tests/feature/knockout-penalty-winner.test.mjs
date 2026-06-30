/* knockout-penalty-winner.test.mjs — RCA 2026-06-30 (Tier 2).
 *
 * Knockout matches decided in a penalty shootout (ESPN STATUS_FINAL_PEN) carry a
 * REGULATION score of 1-1 — the advancing team is only in ESPN's competitor
 * `winner` flag / `shootoutScore`, never derivable from the score. The pipeline
 * derived the winner from the score (None for 1-1) and the bracket/scoring gates
 * didn't treat PEN/AET as final, so penalty knockouts neither advanced the
 * bracket nor scored a correct pick. ESPN: Morocco beat Netherlands 3-2 on pens.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseScoreboard } from '../../live-api/api/live.js';
import { mergeLiveScores } from '../../app/live-scores.js';
import { lookupActual } from '../../app/bracket-resolver.js';
import { scoreBracketWeighted } from '../../app/competition-scoring.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// ESPN-shaped penalty-shootout event: NED 1-1 MAR, Morocco win 3-2 on pens.
const ESPN_PEN = { events: [{ competitions: [{
  status: { type: { name: 'STATUS_FINAL_PEN', state: 'post' } },
  competitors: [
    { team: { displayName: 'Netherlands' }, score: '1', shootoutScore: 2, winner: false },
    { team: { displayName: 'Morocco' }, score: '1', shootoutScore: 3, winner: true },
  ],
}] }] };

test('parseScoreboard carries the shootout winner (+ pens) for a penalty final', () => {
  const board = parseScoreboard(ESPN_PEN);
  assert.equal(board.length, 1);
  const e = board[0];
  assert.equal(e.status, 'STATUS_FINAL_PEN');
  assert.equal(e.winner, 'Morocco', 'winner is the shootout winner, not score-derived (1-1)');
  assert.ok(e.shootout, 'shootout tally present for display');
  assert.equal(e.shootout['Morocco'], 3);
  assert.equal(e.shootout['Netherlands'], 2);
});

test('mergeLiveScores writes the shootout winner into the result record', () => {
  const data = { scheduleFull: [{ stage: 'round_of_32', team_a: 'Netherlands', team_b: 'Morocco', kickoff_utc: '2026-06-30T01:00:00Z' }], actualResults: {} };
  mergeLiveScores(data, parseScoreboard(ESPN_PEN));
  const rec = data.actualResults.round_of_32['Netherlands__vs__Morocco'];
  assert.ok(rec, 'record merged into round_of_32');
  assert.equal(rec.winner, 'Morocco');
  assert.equal(rec.status, 'STATUS_FINAL_PEN');
});

test('lookupActual advances the shootout winner for a STATUS_FINAL_PEN record', () => {
  const data = { actualResults: { round_of_32: { 'Netherlands__vs__Morocco': { score_a: 1, score_b: 1, status: 'STATUS_FINAL_PEN', winner: 'Morocco' } } } };
  const got = lookupActual(data, 'round_of_32', 'Netherlands', 'Morocco');
  assert.ok(got, 'record found');
  assert.equal(got.winner, 'Morocco', 'penalty winner must advance (was null: PEN not gated final)');
});

test('lookupActual still ignores an in-progress (non-final) record', () => {
  const data = { actualResults: { round_of_32: { 'A__vs__B': { score_a: 1, score_b: 0, status: 'STATUS_FIRST_HALF' } } } };
  assert.equal(lookupActual(data, 'round_of_32', 'A', 'B').winner, null);
});

test('a correct penalty-shootout bracket pick scores points', () => {
  const data = { actualResults: { round_of_32: { 'Netherlands__vs__Morocco': { score_a: 1, score_b: 1, status: 'STATUS_FINAL_PEN', winner: 'Morocco' } } } };
  const picks = [{ team_a: 'Netherlands', team_b: 'Morocco', choice: 'team_b' }];
  const res = scoreBracketWeighted(picks, data);
  assert.ok(res.score > 0, 'a correct pen pick must score (was 0: PEN not gated final → not scored)');
});

// ---- source / wiring --------------------------------------------------------
test('the bracket + scoring gates recognise penalty/extra-time finals', () => {
  for (const f of ['app/bracket-resolver.js', 'app/competition-scoring.js']) {
    const s = read(f);
    assert.match(s, /STATUS_FINAL_PEN/, `${f} gates penalty finals`);
    assert.match(s, /STATUS_FINAL_AET/, `${f} gates extra-time finals`);
  }
});

test('scrape_live_results.py (the durable writer) records the winner flag + shootout, gating PEN/AET as complete', () => {
  const s = read('scripts/scrape_live_results.py');
  assert.match(s, /STATUS_FINAL_PEN/, 'penalty finals counted as complete');
  assert.match(s, /STATUS_FINAL_AET/, 'extra-time finals counted as complete');
  assert.match(s, /winner/, 'reads ESPN competitor winner flag');
  assert.match(s, /shootout/i, 'captures shootout tally');
});

test('live-scores.js parseScoreboard mirrors the winner extraction (board contract)', () => {
  const s = read('app/live-scores.js');
  assert.match(s, /winner/, 'client board carries winner');
  assert.match(s, /shootout/i, 'client board carries shootout');
});
