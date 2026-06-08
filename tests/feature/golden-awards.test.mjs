import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goldenBall, goldenGlove, youngPlayer } from '../../app/lib/golden-awards.js';
const j = (p) => JSON.parse(readFileSync(p, 'utf8'));
const read = (p) => readFileSync(p, 'utf8');
const data = () => ({ players: j('data/players.json'), teams: j('data/teams.json'), forecast: j('data/forecast.json'), markets: j('data/markets.json') });

test('scrape_kalshi fetches the three award markets', () => {
  const s = read('scripts/scrape_kalshi.py');
  assert.match(s, /KXWCAWARD-26GBALL/); assert.match(s, /KXWCAWARD-26GGLOVE/); assert.match(s, /KXWCAWARD-26BYP/);
  assert.match(s, /"awards"/, 'writes awards into markets.json');
  const a = j('data/markets.json').awards || {};
  for (const k of ['golden_ball', 'golden_glove', 'young_player']) assert.ok(Array.isArray(a[k]) && a[k].length, `${k} populated`);
});

test('Golden Ball: blended, sums ~100, attackers favoured', () => {
  const c = goldenBall(data(), {});
  assert.ok(c.length > 0); assert.equal(c.blendedWithMarket, true);
  const sum = c.reduce((s, x) => s + x.awardPct, 0);
  assert.ok(sum > 90 && sum < 115, `sum ~100 (${sum.toFixed(0)})`);
  assert.notEqual(c[0].position, 'GK', 'a GK does not lead the Ball');
  assert.ok(c.filter((x) => x.marketPct > 0).length >= 15, 'market matched');
});

test('Golden Glove: goalkeepers only, one per team', () => {
  const c = goldenGlove(data(), {});
  assert.ok(c.length > 0);
  assert.ok(c.every((x) => x.position === 'GK'), 'all contenders are GKs');
  const teams = new Set(c.map((x) => x.team));
  assert.equal(teams.size, c.length, 'one GK per team');
});

test('Young Player: only age <= 21', () => {
  const c = youngPlayer(data(), {});
  assert.ok(c.length > 0);
  assert.ok(c.every((x) => x.age != null && x.age <= 21), 'all U21');
});
