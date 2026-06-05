import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  goldenBootProjections, projectPlayer, buildContext, mulberry32, liveGoalsByPlayer, GB_CONFIG,
} from '../../app/lib/golden-boot.js';

const synth = () => ({
  players: [
    { name: 'Striker', team: 'Strong', group: 'A', position: 'FWD', scoring: 95 },
    { name: 'Mid', team: 'Strong', group: 'A', position: 'MID', scoring: 80 },
    { name: 'Keeper', team: 'Strong', group: 'A', position: 'GK', scoring: 10 },
    { name: 'WeakFwd', team: 'Weak', group: 'A', position: 'FWD', scoring: 60 },
  ],
  teams: {
    Strong: { name: 'Strong', group: 'A', composite: 90, position_ratings: { def: 80 } },
    Weak: { name: 'Weak', group: 'A', composite: 50, position_ratings: { def: 45 } },
  },
  groupMatchups: { A: { teams: ['Strong', 'Weak'] } },
  xg: {}, scorers: {},
});

test('R19 GB: mulberry32 is deterministic for a seed', () => {
  const a = mulberry32(42), b = mulberry32(42);
  assert.equal(a(), b());
  assert.equal(a(), b());
});

test('R19 GB: GKs excluded; FWD outprojects MID; strong-team striker leads', () => {
  const data = synth();
  const out = goldenBootProjections(data, { sims: 3000, seed: 7 });
  assert.equal(out.find((c) => c.player === 'Keeper'), undefined, 'GK excluded');
  assert.equal(out[0].player, 'Striker', 'elite striker on strong team ranks #1');
  const mid = out.find((c) => c.player === 'Mid');
  const striker = out.find((c) => c.player === 'Striker');
  assert.ok(striker.projGoals > mid.projGoals, 'FWD > MID');
  const sum = out.reduce((a, c) => a + c.bootPct, 0);
  assert.ok(sum > 95 && sum < 105, `boot% sums ~100 (got ${sum})`);
});

test('R19 GB: deterministic — same seed → identical odds', () => {
  const r1 = goldenBootProjections(synth(), { sims: 2000, seed: 99 });
  const r2 = goldenBootProjections(synth(), { sims: 2000, seed: 99 });
  assert.deepEqual(r1.map((c) => [c.player, c.bootPct]), r2.map((c) => [c.player, c.bootPct]));
});

test('R19 GB: live goals blend in — a leader with goals scored jumps', () => {
  const base = goldenBootProjections(synth(), { sims: 4000, seed: 5 });
  const baseWeak = base.find((c) => c.player === 'WeakFwd').bootPct;
  const data = synth();
  data.scorers = { WeakFwd: 6 }; // already bagged 6
  const live = goldenBootProjections(data, { sims: 4000, seed: 5 });
  const liveWeak = live.find((c) => c.player === 'WeakFwd');
  assert.equal(liveWeak.currentGoals, 6, 'live goals counted');
  assert.ok(liveWeak.bootPct > baseWeak, 'scoring 6 boosts boot odds');
});

test('R19 GB: deep-run scales with team composite; weak-opp defense raises factor', () => {
  const ctx = buildContext(synth());
  assert.ok(ctx.expectedMatches.Strong > ctx.expectedMatches.Weak, 'stronger team → more matches');
  // Strong faces Weak (def 45 < league avg) → oppDefFactor > 1
  assert.ok(ctx.oppDefFactor.Strong > 1, 'facing a weak defense raises the factor');
});

test('R19 GB: projectPlayer returns null for GK', () => {
  const ctx = buildContext(synth());
  const gk = synth().players.find((p) => p.position === 'GK');
  assert.equal(projectPlayer(gk, ctx, {}, GB_CONFIG, {}), null);
});

test('R19 GB: runs on the real dataset and ranks elite strikers up top', () => {
  const rd = (f) => JSON.parse(readFileSync('data/' + f, 'utf8'));
  const data = { players: rd('players.json'), teams: rd('teams.json'), groupMatchups: rd('group_matchups.json'), xg: rd('xg.json'), scorers: rd('scorers.json') };
  const out = goldenBootProjections(data, { sims: 3000, seed: 1 });
  assert.ok(out.length > 50, 'a real contender pool');
  const top5 = out.slice(0, 5).map((c) => c.player);
  assert.ok(top5.includes('Kylian Mbappe') || top5.includes('Harry Kane'), `expected an elite striker in top 5 (got ${top5.join(', ')})`);
});
