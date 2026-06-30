import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarize, biggestWin } from '../../app/components/h2h.js';

const J = (p) => JSON.parse(readFileSync(new URL('../../' + p, import.meta.url), 'utf8'));

test('summarize: USA-oriented W/D/L + goals', () => {
  const oriented = [
    { score_a: 4, score_b: 1, winnerSide: 'a' },
    { score_a: 2, score_b: 1, winnerSide: 'a' },
    { score_a: 1, score_b: 0, winnerSide: 'a' },
    { score_a: 1, score_b: 0, winnerSide: 'a' },
    { score_a: 0, score_b: 1, winnerSide: 'b' },
  ];
  assert.deepEqual(summarize(oriented), { played: 5, w: 4, d: 0, l: 1, gf: 8, ga: 3 });
});

test('summarize: reversed orientation mirrors W/L and goals', () => {
  const rev = [
    { score_a: 1, score_b: 4, winnerSide: 'b' },
    { score_a: 1, score_b: 2, winnerSide: 'b' },
    { score_a: 0, score_b: 1, winnerSide: 'b' },
    { score_a: 0, score_b: 1, winnerSide: 'b' },
    { score_a: 1, score_b: 0, winnerSide: 'a' },
  ];
  assert.deepEqual(summarize(rev), { played: 5, w: 1, d: 0, l: 4, gf: 3, ga: 8 });
});

test('summarize: draws and unknown winnerSide counted as draw/neutral', () => {
  const o = [
    { score_a: 1, score_b: 1, winnerSide: 'draw' },
    { score_a: 2, score_b: 2, winnerSide: '?' },
  ];
  assert.deepEqual(summarize(o), { played: 2, w: 0, d: 2, l: 0, gf: 3, ga: 3 });
});

test('biggestWin picks max margin, null when all draws', () => {
  const o = [
    { score_a: 4, score_b: 1, winnerSide: 'a', comp: 'WC' },
    { score_a: 1, score_b: 0, winnerSide: 'a', comp: 'F' },
  ];
  assert.deepEqual(biggestWin(o, { team_a: 'USA', team_b: 'Paraguay' }), {
    teamName: 'USA',
    score_a: 4,
    score_b: 1,
    comp: 'WC',
  });
  assert.equal(biggestWin([{ score_a: 1, score_b: 1, winnerSide: 'draw' }], { team_a: 'X', team_b: 'Y' }), null);
});

test('biggestWin: opponent win is reported from the opponent perspective', () => {
  // team_a lost 0-3; biggest "win" in the dataset belongs to team_b
  const o = [
    { score_a: 0, score_b: 3, winnerSide: 'b', comp: 'WC' },
    { score_a: 1, score_b: 0, winnerSide: 'a', comp: 'F' },
  ];
  assert.deepEqual(biggestWin(o, { team_a: 'X', team_b: 'Y' }), {
    teamName: 'Y',
    score_a: 0,
    score_b: 3,
    comp: 'WC',
  });
});

test('biggestWin: ties on margin → most recent (first in date-desc input)', () => {
  // both are a-wins by margin 2; the first row (most recent) wins the tie
  const o = [
    { score_a: 3, score_b: 1, winnerSide: 'a', comp: 'NEW' },
    { score_a: 2, score_b: 0, winnerSide: 'a', comp: 'OLD' },
  ];
  assert.equal(biggestWin(o, { team_a: 'X', team_b: 'Y' }).comp, 'NEW');
});

test('biggestWin: empty array → null', () => {
  assert.equal(biggestWin([], { team_a: 'X', team_b: 'Y' }), null);
});

test('h2h.json shape lock: every value is an array of {date,score_a,score_b,winner}', () => {
  const h = J('data/h2h.json');
  for (const [k, rows] of Object.entries(h)) {
    if (k === '__meta__') continue;
    assert.ok(Array.isArray(rows), `${k} is an array`);
    const [a, b] = k.split('__vs__');
    for (const r of rows) {
      for (const f of ['date', 'score_a', 'score_b', 'winner']) assert.ok(f in r, `${k} row has ${f}`);
      assert.ok([a, b, 'draw'].includes(r.winner), `${k} winner ${r.winner} is a/b/draw`);
    }
  }
});

test('h2h.js exports summarize/biggestWin and imports escapeHtml + emptyState', () => {
  const src = readFileSync(new URL('../../app/components/h2h.js', import.meta.url), 'utf8');
  assert.match(src, /export function summarize/, 'exports summarize');
  assert.match(src, /export function biggestWin/, 'exports biggestWin');
  assert.match(src, /escape\.js/, 'imports escapeHtml');
  assert.match(src, /empty-state\.js/, 'imports emptyState');
});
