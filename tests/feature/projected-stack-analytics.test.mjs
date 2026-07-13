/* projected-stack-analytics.test.mjs — 2026-07-13 Projected-tab model audit.
 *
 * J5L AI Enhanced ('stack') is the primary model for all projections. Two gaps:
 * 1. projected-bracket-tree's strengthMap had no 'stack' case, so the per-pick
 *    confidence % silently fell back to the J5L composite — the badge was
 *    computed from a different model than the one making the pick.
 * 2. The bracket source dropdown still offered "Public consensus", which is no
 *    longer used (and silently fell back to composite picks because the view
 *    never passes a consensus map).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAutofill } from '../../app/bracket-autofill.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('stack autofill picks from stacker strengths, not the composite', () => {
  const data = {
    scheduleFull: [{ match_number: 104, stage: 'final', team_a: 'France', team_b: 'Spain' }],
    // Composite disagrees with the learned blend — the stack pick must win.
    teams: { France: { composite: 95 }, Spain: { composite: 90 } },
    stacker: { strengths: { France: 1.8, Spain: 2.0 } },
    actualResults: {},
  };
  const picks = buildAutofill(data, 'stack');
  assert.equal(picks.length, 1);
  assert.equal(picks[0].team, 'Spain', 'learned blend strength decides, composite does not');
});

// ---- source / wiring --------------------------------------------------------
test('projected tree confidence reads stacker strengths for the stack model', () => {
  const s = read('app/components/projected-bracket-tree.js');
  assert.match(s, /source === 'stack'[\s\S]{0,120}stacker\?\.strengths/,
    'strengthMap has a stack branch backed by data.stacker.strengths');
});

test('the bracket source dropdown no longer offers Public consensus', () => {
  const s = read('app/views/bracket-view-r6.js');
  assert.doesNotMatch(s, /consensus/i, 'consensus source removed from the Projected/Bracket view');
});
