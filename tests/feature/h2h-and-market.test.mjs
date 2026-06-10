import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const J = (p) => JSON.parse(read(p));

test('per-match market display ×100 (fraction → percent)', () => {
  const bar = read('app/components/market-bar.js');
  assert.match(bar, /team_a_prob \?\? 0\) \* 100/, 'market-bar scales team_a_prob to percent');
  assert.match(bar, /draw_prob \?\? 0\) \* 100/, 'market-bar scales draw_prob');
  const div = read('app/components/model-market-divergence.js');
  assert.match(div, /marketProb \* 100/, 'divergence compares market on the percent scale');
});

test('h2h scraper sources ESPN headToHeadGames (not the empty football-data feed)', () => {
  const s = read('scripts/scrape_h2h.py');
  assert.match(s, /headToHeadGames/, 'reads ESPN headToHeadGames');
  assert.match(s, /\/summary/, 'uses ESPN match summary endpoint');
  assert.doesNotMatch(s, /football-data/, 'no longer uses the club-only football-data source');
});

test('h2h.json is populated with correctly-shaped meetings', () => {
  const h = J('data/h2h.json');
  const pairs = Object.keys(h).filter((k) => k !== '__meta__');
  assert.ok(pairs.length >= 10, `expected many populated pairings, got ${pairs.length}`);
  const usaPar = h['USA__vs__Paraguay'];
  assert.ok(Array.isArray(usaPar) && usaPar.length, 'USA vs Paraguay has meetings');
  const r = usaPar[0];
  for (const f of ['date', 'score_a', 'score_b', 'winner']) assert.ok(f in r, `row has ${f}`);
  assert.ok(['USA', 'Paraguay', 'draw'].includes(r.winner), 'winner is a canonical name or draw');
});
