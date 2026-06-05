import test from 'node:test';
import assert from 'node:assert/strict';
import { winnerRank, topNHit, brier, logLoss, goalMAE, backtestTournament } from '../../scripts/golden-boot-backtest.mjs';

const predicted = [
  { player: 'A', bootPct: 40, projGoals: 6 },
  { player: 'B', bootPct: 25, projGoals: 5 },
  { player: 'C', bootPct: 10, projGoals: 4 },
];

test('R19 BT: winnerRank + topN', () => {
  assert.equal(winnerRank(predicted, 'B'), 2);
  assert.equal(winnerRank(predicted, 'Z'), Infinity);
  assert.equal(topNHit(predicted, 'B', 3), true);
  assert.equal(topNHit(predicted, 'C', 2), false);
});

test('R19 BT: brier + logLoss reward a confident correct call', () => {
  const right = brier(predicted, 'A');   // favorite won
  const wrong = brier(predicted, 'C');   // longshot won
  assert.ok(right < wrong, 'lower Brier when the favorite wins');
  assert.ok(logLoss(predicted, 'A') < logLoss(predicted, 'C'), 'lower log-loss when favorite wins');
});

test('R19 BT: goalMAE compares projected vs actual', () => {
  const mae = goalMAE(predicted, { A: 7, B: 4, C: 4 }, 3); // |6-7|+|5-4|+|4-4| = 2 → /3
  assert.ok(Math.abs(mae - (2 / 3)) < 1e-9);
});

test('R19 BT: end-to-end on a synthetic tournament ranks the favorite high', () => {
  const teams = { Strong: { name: 'Strong', group: 'A', composite: 92, position_ratings: { def: 80 } },
                  Weak: { name: 'Weak', group: 'A', composite: 52, position_ratings: { def: 45 } } };
  const data = {
    players: [
      { name: 'Ace', team: 'Strong', group: 'A', position: 'FWD', scoring: 96 },
      { name: 'Joe', team: 'Weak', group: 'A', position: 'FWD', scoring: 62 },
    ],
    teams, groupMatchups: { A: { teams: ['Strong', 'Weak'] } }, xg: {}, scorers: {},
  };
  const r = backtestTournament(data, { name: 'syn', winner: 'Ace', goals: { Ace: 6 } }, { sims: 2000 });
  assert.equal(r.winnerRank, 1);
  assert.equal(r.top3, true);
  assert.ok(r.brier >= 0 && r.brier <= 1);
});
