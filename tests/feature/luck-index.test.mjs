/* luck-index.test.mjs — 2026-07-13 luck analysis (display-only by design).
 *
 * Backtest verdict (docs/LUCK_ANALYSIS.md): a luck weighting adds no predictive
 * value over the stack model from the R32 (permutation p≈0.28; strictly worse
 * once strength is partialled out). So the luck index is DESCRIPTIVE ONLY:
 * these tests lock the metric math, the remaining-teams gate, and — critically
 * — that no projection path ever imports it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeLuckIndex, remainingKnockoutTeams, luckChips } from '../../app/lib/luck-index.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

/* 4-team fixture: A is showered in luck (pen scored, corners, whistle, cards,
 * opponent own-goal), B is its mirror-image victim; C/D are neutral filler. */
function fixture() {
  const F = 'STATUS_FULL_TIME';
  const stats = (k, ca, fa, cb, fb) => [k, { team_a: k.split('__vs__')[0], team_b: k.split('__vs__')[1], stats_a: { corners: ca, fouls: fa }, stats_b: { corners: cb, fouls: fb } }];
  return {
    scheduleFull: [
      { stage: 'group', team_a: 'A', team_b: 'B' }, { stage: 'group', team_a: 'C', team_b: 'D' },
      { stage: 'group', team_a: 'A', team_b: 'C' }, { stage: 'group', team_a: 'B', team_b: 'D' },
      { stage: 'semifinals', match_number: 101, team_a: 'A', team_b: 'D' },
    ],
    matchStats: Object.fromEntries([
      stats('A__vs__B', 10, 2, 2, 12),  // A: corner + whistle edge
      stats('C__vs__D', 5, 8, 5, 8),
      stats('A__vs__C', 8, 4, 4, 8),
      stats('B__vs__D', 3, 10, 6, 4),
    ]),
    matchEvents: {
      'A__vs__B': { events: [
        { type: 'pen-goal', team: 'A' },
        { type: 'yellow', team: 'B' }, { type: 'red', team: 'B' },
        { type: 'own-goal', team: 'B' },   // gifts a goal to A
      ] },
      'C__vs__D': { events: [] },
      'A__vs__C': { events: [] },
      'B__vs__D': { events: [] },
    },
    xg: {},
    actualResults: { group_stage: {
      'A__vs__B': { score_a: 3, score_b: 0, status: F },
      'C__vs__D': { score_a: 1, score_b: 1, status: F },
      'A__vs__C': { score_a: 1, score_b: 0, status: F },
      'B__vs__D': { score_a: 0, score_b: 1, status: F },
    } },
  };
}

test('lucky team indexes above its mirror-image victim (all component signs)', () => {
  const { teams } = computeLuckIndex(fixture());
  assert.ok(teams.A && teams.B && teams.C && teams.D, 'all 4 teams profiled');
  assert.ok(teams.A.index > 0, `A is net lucky (${teams.A.index.toFixed(2)})`);
  assert.ok(teams.B.index < 0, `B is net unlucky (${teams.B.index.toFixed(2)})`);
  assert.ok(teams.A.index > teams.C.index, 'luck ranks above neutral filler');
  // component signs: pen for A is +lucky, pen against B is −lucky
  assert.ok(teams.A.z.pens_for > 0 && teams.A.z.own_goal_gifts > 0 && teams.A.z.card_diff > 0);
  assert.ok(teams.B.z.pens_against < 0 && teams.B.z.card_diff < 0);
});

test('luckChips surfaces only strong components with lucky/unlucky labels', () => {
  const { teams } = computeLuckIndex(fixture());
  const chips = luckChips(teams.A, { max: 3, minZ: 0.8 });
  assert.ok(chips.length >= 1 && chips.length <= 3);
  for (const c of chips) assert.ok(Math.abs(c.z) >= 0.8 && c.label);
  const neutral = luckChips({ z: { pens_for: 0.1, foul_diff: -0.2 } });
  assert.equal(neutral.length, 0, 'weak signals produce no chips');
});

test('remainingKnockoutTeams: unplayed named KO matches only', () => {
  const data = fixture();
  assert.deepEqual(remainingKnockoutTeams(data).sort(), ['A', 'D'], 'SF pairing still alive');
  // once the SF has a FINAL result, nobody is "remaining" (no later named match)
  data.actualResults.semifinals = { 'A__vs__D': { score_a: 2, score_b: 0, status: 'STATUS_FULL_TIME', winner: 'A' } };
  assert.deepEqual(remainingKnockoutTeams(data), []);
  // an in-progress record keeps both teams alive (not decided yet)
  data.actualResults.semifinals = { 'A__vs__D': { score_a: 1, score_b: 0, status: 'STATUS_FIRST_HALF' } };
  assert.deepEqual(remainingKnockoutTeams(data).sort(), ['A', 'D']);
});

test('too small a field → no z-scores, empty profile (no noise from tiny samples)', () => {
  const data = fixture();
  data.matchStats = Object.fromEntries(Object.entries(data.matchStats).slice(0, 1));
  assert.deepEqual(computeLuckIndex(data).teams, {});
});

test('matchLuckLedger: live per-match luck events for both sides', async () => {
  const { matchLuckLedger } = await import('../../app/lib/luck-index.js');
  const data = {
    matchEvents: { 'A__vs__B': { events: [
      { type: 'pen-goal', team: 'A' },
      { type: 'red', team: 'B' },
      { type: 'own-goal', team: 'B' },
    ] } },
    matchStats: { 'A__vs__B': { team_a: 'A', team_b: 'B', stats_a: { corners: 9, fouls: 3 }, stats_b: { corners: 2, fouls: 9 } } },
    xg: { 'A__vs__B': { team_a: 'A', team_b: 'B', team_a_xg: 0.5, team_b_xg: 1.5 } },
    actualResults: { semifinals: { 'A__vs__B': { score_a: 2, score_b: 0, status: 'STATUS_FIRST_HALF' } } },
  };
  const led = matchLuckLedger(data, { team_a: 'A', team_b: 'B', stage: 'semifinals' });
  assert.ok(led, 'ledger present once signals exist');
  const labels = (t) => led[t].map((r) => r.label);
  assert.ok(labels('A').includes('pen awarded'));
  assert.ok(labels('A').includes('own-goal gift'));
  assert.ok(labels('A').includes('card edge') && labels('B').includes('card burden'));
  assert.ok(labels('A').includes('corner edge'));
  assert.ok(labels('A').includes('friendly whistle') && labels('B').includes('harsh whistle'));
  // live score 2-0 vs xG 0.5/1.5 → A hot (+1.5), B cold (−1.5) — updates in-play
  assert.ok(labels('A').includes('hot finishing'));
  assert.ok(labels('B').includes('cold finishing'));
  assert.ok(led.A.every((r) => r.lucky !== undefined));
});

test('matchLuckLedger: null before any signal (scheduled stub, no events/stats)', async () => {
  const { matchLuckLedger } = await import('../../app/lib/luck-index.js');
  const data = {
    matchEvents: {}, matchStats: {}, xg: { 'A__vs__B': { team_a: 'A', team_b: 'B', team_a_xg: 1, team_b_xg: 1 } },
    actualResults: { semifinals: { 'A__vs__B': { score_a: 0, score_b: 0, status: 'STATUS_SCHEDULED' } } },
  };
  assert.equal(matchLuckLedger(data, { team_a: 'A', team_b: 'B', stage: 'semifinals' }), null);
});

// ---- source / wiring --------------------------------------------------------
test('luck is display-only: no projection path imports luck-index', () => {
  for (const f of ['app/bracket-autofill.js', 'app/lib/model-pick.js', 'app/bracket-resolver.js', 'app/hybrid-model.js', 'app/stack-model.js']) {
    assert.ok(!read(f).includes('luck-index'), `${f} must not consume the luck index`);
  }
});

test('the Projected tab renders the luck card from the lib', () => {
  const s = read('app/components/projected-bracket-tree.js');
  assert.match(s, /luck-index\.js/, 'imports the lib');
  assert.match(s, /eb-luck-card/, 'renders the card testid');
});

test('the matchup page mounts the Luck check after the model grid', () => {
  const v = read('app/views/matchup-detail.js');
  assert.match(v, /luckCheckSection/, 'matchup view mounts the section');
  const c = read('app/components/luck-check.js');
  assert.match(c, /matchup-luck-ledger/, 'component renders the live this-match ledger');
  assert.match(c, /never adjusts projections/, 'display-only disclaimer is part of the contract');
});
