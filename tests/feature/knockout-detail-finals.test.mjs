/* knockout-detail-finals.test.mjs — RCA 2026-06-30.
 *
 * After resolve_knockouts.py populated REAL teams into the knockout rows of
 * schedule_full.json, two latent bugs surfaced (both only reachable once
 * knockouts stopped being slot placeholders):
 *
 *  Bug 1 — penalty / extra-time finals (ESPN STATUS_FINAL_PEN / STATUS_FINAL_AET)
 *          were not recognised as FINAL, so a finished knockout card showed a
 *          bare "vs" with no kickoff time and no score. Penalty/ET finals never
 *          occur in the group stage, so the status was never exercised before.
 *
 *  Bug 2 — matchup-detail looked the match up ONLY in data.groupMatchups (group
 *          stage, keyed by group letter). Tapping a knockout match (e.g.
 *          Netherlands vs Morocco) found nothing AND describePrediction threw on
 *          the model-less row, so the sheet read "Matchup not found".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { actualForCard } from '../../app/components/large-match-card.js';
import { describePrediction } from '../../app/predictions.js';
import { resolveMatch } from '../../app/views/matchup-detail.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// ---- Bug 1: penalty / extra-time finals are FINAL (score + time show) -------
test('actualForCard treats STATUS_FINAL_PEN as a final result', () => {
  const ar = { round_of_32: { 'Netherlands__vs__Morocco': { score_a: 1, score_b: 1, status: 'STATUS_FINAL_PEN' } } };
  const got = actualForCard(ar, { stage: 'round_of_32', team_a: 'Netherlands', team_b: 'Morocco' });
  assert.ok(got, 'a penalty-shootout final must produce a displayable result (not null → bare "vs")');
  assert.equal(got.mode, 'final');
  assert.deepEqual(got.actual, { score_a: 1, score_b: 1 });
});

test('actualForCard treats STATUS_FINAL_AET as a final result', () => {
  const ar = { round_of_32: { 'France__vs__Sweden': { score_a: 2, score_b: 1, status: 'STATUS_FINAL_AET' } } };
  const got = actualForCard(ar, { stage: 'round_of_32', team_a: 'France', team_b: 'Sweden' });
  assert.ok(got && got.mode === 'final', 'an extra-time final must display');
});

test('actualForCard still excludes scheduled 0-0 stubs (no false finals)', () => {
  const ar = { round_of_32: { 'A__vs__B': { score_a: 0, score_b: 0, status: 'STATUS_SCHEDULED' } } };
  assert.equal(actualForCard(ar, { stage: 'round_of_32', team_a: 'A', team_b: 'B' }), null);
});

// ---- Bug 2: knockout matchup resolves + renders without throwing ------------
test('resolveMatch finds a knockout fixture from scheduleFull (not just group matchups)', () => {
  const data = {
    groupMatchups: { A: { matches: [{ team_a: 'Mexico', team_b: 'Korea Republic', group: 'A', win_confidence_pct: 55 }] } },
    scheduleFull: [
      { stage: 'group', team_a: 'Mexico', team_b: 'Korea Republic' },
      { stage: 'round_of_32', team_a: 'Netherlands', team_b: 'Morocco', kickoff_utc: '2026-06-30T01:00:00Z' },
    ],
  };
  const ko = resolveMatch(data, 'Netherlands', 'Morocco');
  assert.ok(ko, 'knockout match must be found (else "Matchup not found")');
  assert.equal(ko.stage, 'round_of_32');
  assert.ok(resolveMatch(data, 'Morocco', 'Netherlands'), 'reverse team order resolves too');
  const grp = resolveMatch(data, 'Mexico', 'Korea Republic');
  assert.ok(grp && grp.group === 'A' && Number.isFinite(grp.win_confidence_pct),
    'group matches still resolve from groupMatchups with their model fields');
});

test('describePrediction does not throw on a model-less knockout row', () => {
  const m = { stage: 'round_of_32', team_a: 'Netherlands', team_b: 'Morocco' };
  let out;
  assert.doesNotThrow(() => { out = describePrediction(m, {}); }, 'must not throw on a row with no win_confidence_pct');
  assert.equal(typeof out, 'string');
});

// ---- wiring assertions (the view + card paths) -----------------------------
test('matchup-detail gates the model grid + reads the row stage for the score', () => {
  const md = read('app/views/matchup-detail.js');
  assert.match(md, /resolveMatch/, 'uses resolveMatch (group + knockout lookup)');
  assert.match(md, /hasModel/, 'gates model-prediction sections behind a hasModel guard');
  assert.doesNotMatch(md, /actualForCard\(data\.actualResults,\s*\{\s*stage:\s*'group'/,
    'detail score must use the match stage, not a hardcoded group tier');
});

test('penalty/extra-time finals are recognised in the card status set', () => {
  const lmc = read('app/components/large-match-card.js');
  assert.match(lmc, /STATUS_FINAL_PEN/, 'card recognises penalty finals');
  assert.match(lmc, /STATUS_FINAL_AET/, 'card recognises extra-time finals');
});
