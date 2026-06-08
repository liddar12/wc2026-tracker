import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goldenBootProjections, goalLeaderMarket } from '../../app/lib/golden-boot.js';
const j = (p) => JSON.parse(readFileSync(p, 'utf8'));
const read = (p) => readFileSync(p, 'utf8');

function loadData() {
  return {
    players: j('data/players.json'), teams: j('data/teams.json'),
    groupMatchups: j('data/group_matchups.json'), xg: j('data/xg.json'),
    scorers: j('data/scorers.json'), markets: j('data/markets.json'),
    forecast: j('data/forecast.json'),
  };
}

test('scrape_kalshi pulls the Golden Boot market into markets.goal_leader', () => {
  const s = read('scripts/scrape_kalshi.py');
  assert.match(s, /KXWCGOALLEADER/, 'scrapes the goal-leader event');
  assert.match(s, /"goal_leader"/, 'writes goal_leader into markets.json');
  const gl = j('data/markets.json').goal_leader || [];
  assert.ok(gl.length >= 20, `goal_leader populated (${gl.length} players)`);
  assert.ok(gl.every((r) => r.player && typeof r.prob_pct === 'number'), 'shape ok');
});

test('Golden Boot blends the Kalshi market + uses forecast deep-run', () => {
  const data = loadData();
  assert.ok(goalLeaderMarket(data), 'market parsed');
  const c = goldenBootProjections(data, { sims: 4000 });
  assert.ok(c.length > 0, 'contenders produced');
  assert.equal(c.blendedWithMarket, true, 'blended with market');
  const matched = c.filter((x) => x.marketPct > 0).length;
  assert.ok(matched >= 15, `market matched to contenders (${matched})`);
  c.forEach((x) => assert.ok(typeof x.modelPct === 'number', 'keeps model-only pct'));
  const sum = c.reduce((s, x) => s + x.bootPct, 0);
  assert.ok(sum > 90 && sum < 115, `boot% renormalised to ~100 (${sum.toFixed(0)})`);
  // forecast deep-run can exceed the old 7-match cap (48-team finalist plays 8)
  assert.match(read('app/lib/golden-boot.js'), /forecast\?\.teams/, 'uses forecast for expected matches');
});
