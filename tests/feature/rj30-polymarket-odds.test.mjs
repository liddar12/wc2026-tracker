/* rj30-polymarket-odds.test.mjs — RJ30-1: Polymarket per-match W/D/L wired into
   the Parlay of the Day's market precedence (data.polymarketOdds.match_outcomes).
   Pure transform + wiring; no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyLegs } from '../../app/components/parlay.js';

function dataToday({ polymarket = true, reversedKey = false } = {}) {
  const now = new Date().toISOString();
  const d = {
    scheduleFull: [
      { match_id: 'Brazil__vs__Japan', team_a: 'Brazil', team_b: 'Japan', kickoff_utc: now },
    ],
    groupMatchups: { X: { matches: [
      { team_a: 'Brazil', team_b: 'Japan', probabilities: { team_a_wins: 60, draw: 25, team_b_wins: 15 } },
    ] } },
    xg: { a: { team_a: 'Brazil', team_b: 'Japan', team_a_xg: 1.8, team_b_xg: 1.0 } },
    players: [{ name: 'Vinicius', team: 'Brazil', position: 'FWD', scoring: 88 }],
  };
  if (polymarket) {
    const rec = reversedKey
      ? { 'Japan__vs__Brazil': { team_a: 'Japan', team_b: 'Brazil', team_a_prob: 0.15, draw_prob: 0.25, team_b_prob: 0.60 } }
      : { 'Brazil__vs__Japan': { team_a: 'Brazil', team_b: 'Japan', team_a_prob: 0.60, draw_prob: 0.25, team_b_prob: 0.15 } };
    d.polymarketOdds = { source: 'polymarket', match_outcomes: rec };
  }
  return d;
}

test('Polymarket price feeds the Moneyline leg — leg is NOT a model estimate', () => {
  const ml = dailyLegs(dataToday()).find((l) => l.type === 'Moneyline' && /Brazil/.test(l.selection));
  assert.ok(ml, 'a Brazil Moneyline leg exists');
  assert.ok(!ml.estimated, 'marketWDL saw Polymarket, so the leg is not tagged model est.');
});

test('EV is computed from the Polymarket price (ev !== 1) when only Polymarket priced it', () => {
  const ml = dailyLegs(dataToday()).find((l) => l.type === 'Moneyline' && /Brazil/.test(l.selection));
  assert.ok(ml, 'a Brazil Moneyline leg exists');
  assert.notEqual(ml.ev, 1, `EV derived from a real market price (got ${ml.ev})`);
});

test('reversed-orientation key flips so probabilities orient to canonical team_a=Brazil', () => {
  // With the reversed key Japan__vs__Brazil (Japan_prob .15, Brazil_prob .60),
  // outcomeWDL must flip so Brazil's win prob (.60) blends with the model (.60).
  const ml = dailyLegs(dataToday({ reversedKey: true })).find((l) => l.type === 'Moneyline');
  assert.ok(ml, 'a Moneyline leg exists');
  assert.match(ml.selection, /Brazil to win/, 'Brazil is the top outcome after the flip');
  // model .60 + market .60 → ~.60, decisively above a Japan/draw outcome.
  assert.ok(ml.prob > 0.55, `Brazil prob blended ~0.60 (got ${ml.prob})`);
});

test('no polymarketOdds at all → dailyLegs does not throw and the leg is model-estimated', () => {
  let legs;
  assert.doesNotThrow(() => { legs = dailyLegs(dataToday({ polymarket: false })); });
  const ml = legs.find((l) => l.type === 'Moneyline');
  assert.ok(ml, 'still produces a Moneyline leg from the model');
  assert.equal(ml.estimated, true, 'no market price → flagged model est.');
});
