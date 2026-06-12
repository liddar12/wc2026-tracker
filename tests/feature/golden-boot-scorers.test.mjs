/* golden-boot-scorers.test.mjs — RCA fix: today's actual goal-scorers must
   ALWAYS appear on the Golden Boot list with odds.
   Chain that broke: goals came only from scorers.json (empty on day 1) →
   currentGoals=0 for everyone; and the contender pool cut anyone whose
   projection fell outside the top-N. Fixes under test:
   1) liveGoalsByPlayer also aggregates match_events.json goals
   2) accent-insensitive name matching (ESPN "Julián" ↔ squads "Julian")
   3) every scorer enters the contender field (and gets Monte-Carlo odds)
   4) the view appends scorers outside the top-20 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveGoalsByPlayer, normPlayerName, goldenBootProjections } from '../../app/lib/golden-boot.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('liveGoalsByPlayer counts goals from match_events when scorers.json is empty', () => {
  const data = {
    scorers: { __meta__: { updated_at: 'x' } },
    matchEvents: {
      'Mexico__vs__South Africa': {
        events: [
          { minute: "9'", type: 'goal', player: 'Julián Quiñones', team: 'Mexico' },
          { minute: "49'", type: 'red', player: 'Sphephelo Sithole', team: 'South Africa' },
          { minute: "67'", type: 'goal', player: 'Raúl Jiménez', team: 'Mexico' },
        ],
      },
      __meta__: { updated_at: 'x' },
    },
  };
  const live = liveGoalsByPlayer(data);
  const byNorm = Object.fromEntries(Object.entries(live).map(([k, v]) => [normPlayerName(k), v]));
  assert.equal(byNorm[normPlayerName('Julián Quiñones')], 1);
  assert.equal(byNorm[normPlayerName('Raúl Jiménez')], 1);
  assert.equal(Object.keys(live).length, 2, 'cards do not count as goals');
});

test('merging takes the max per player (same goals counted by both feeds)', () => {
  const data = {
    scorers: [{ player: 'Raul Jimenez', goals: 2 }], // unaccented variant
    matchEvents: { m: { events: [{ type: 'goal', player: 'Raúl Jiménez', team: 'Mexico' }] } },
  };
  const live = liveGoalsByPlayer(data);
  const total = Object.values(live).reduce((a, b) => a + b, 0);
  assert.equal(total, 2, 'accent variants merge to one player, max wins (no double count)');
});

test('every actual scorer gets odds — even outside the contender pool or squad list', () => {
  // 30 strong strikers + 1 weak player who scored; pool capped at 8.
  const players = [];
  for (let i = 0; i < 30; i++) {
    players.push({ name: `Star ${i}`, team: `T${i % 6}`, position: 'FWD', scoring: 90 - i * 0.5 });
  }
  players.push({ name: 'Julian Quinones', team: 'Mexico', position: 'FWD', scoring: 40 });
  const data = {
    players,
    teams: Object.fromEntries(['T0','T1','T2','T3','T4','T5','Mexico'].map((t) => [t, { composite: 70 }])),
    groupMatchups: {},
    forecast: {},
    matchEvents: { m: { events: [{ type: 'goal', player: 'Julián Quiñones', team: 'Mexico' }] } },
  };
  const out = goldenBootProjections(data, { sims: 500, seed: 1, config: { contenderPool: 8, marketWeight: 0 } });
  const q = out.find((c) => c.player === 'Julian Quinones');
  assert.ok(q, 'low-rated scorer is in the field despite the pool cut');
  assert.equal(q.currentGoals, 1, 'accented ESPN name credited the squad entry');
  assert.ok(Number.isFinite(q.bootPct), 'he has Monte-Carlo odds');
  // scorer entirely missing from the squad list still appears (synthetic)
  const data2 = { ...data, players: players.slice(0, 30), matchEvents: data.matchEvents };
  const out2 = goldenBootProjections(data2, { sims: 500, seed: 1, config: { contenderPool: 8, marketWeight: 0 } });
  const synth = out2.find((c) => normPlayerName(c.player) === normPlayerName('Julián Quiñones'));
  assert.ok(synth, 'unmatched scorer appears as a synthetic contender');
  assert.equal(synth.currentGoals, 1);
});

test('boot view appends scorers beyond the top-20', () => {
  const v = read('app/views/golden-awards-view.js');
  assert.match(v, /extraScorers/, 'computes scorers outside the top 20');
  assert.match(v, /currentGoals > 0 && !shown\.has/, 'appends every un-shown scorer');
});
