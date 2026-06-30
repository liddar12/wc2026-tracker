import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFormation, assignRows } from '../../app/components/formation-pitch.js';

const J = (p) => JSON.parse(readFileSync(new URL('../../' + p, import.meta.url), 'utf8'));

test('parseFormation: valid formations sum to 10 outfield', () => {
  assert.deepEqual(parseFormation('4-2-3-1'), [4, 2, 3, 1]);
  assert.deepEqual(parseFormation('3-4-2-1'), [3, 4, 2, 1]);
  assert.deepEqual(parseFormation('4-4-2'), [4, 4, 2]);
  assert.deepEqual(parseFormation('4-1-4-1'), [4, 1, 4, 1]);
  assert.deepEqual(parseFormation('5-3-2'), [5, 3, 2]);
});

test('parseFormation: invalid → null (missing, non-numeric, wrong sum)', () => {
  for (const f of [undefined, null, '', 'abc', '4-4-3' /* sum 11 */, '4-4-1' /* sum 9 */, '4--2', '0-0-0']) {
    assert.equal(parseFormation(f), null, `expected null for ${JSON.stringify(f)}`);
  }
});

test('parseFormation: rejects negatives, NaN and >5 rows', () => {
  assert.equal(parseFormation('-4-4-2'), null);
  assert.equal(parseFormation('1-1-1-1-1-1' /* 6 rows summing 6 */), null);
  // a 6-row formation summing to 10 is still rejected (>5 rows)
  assert.equal(parseFormation('2-2-2-2-1-1'), null);
});

test('assignRows: 11 players → GK first, then formation rows', () => {
  const xi = Array.from({ length: 11 }, (_, i) => `P${i}`);
  const rows = assignRows(xi, parseFormation('4-2-3-1'));
  assert.equal(rows.flat().length, 11);
  assert.deepEqual(rows[0], ['P0']); // GK
  assert.deepEqual(rows.slice(1).map((r) => r.length), [4, 2, 3, 1]);
});

test('assignRows: preserves player order within rows', () => {
  const xi = Array.from({ length: 11 }, (_, i) => `P${i}`);
  const rows = assignRows(xi, parseFormation('4-4-2'));
  // GK=P0; defenders P1..P4; mids P5..P8; strikers P9,P10
  assert.deepEqual(rows[1], ['P1', 'P2', 'P3', 'P4']);
  assert.deepEqual(rows[2], ['P5', 'P6', 'P7', 'P8']);
  assert.deepEqual(rows[3], ['P9', 'P10']);
});

test('assignRows: non-11 xi → null (caller falls back to list)', () => {
  assert.equal(assignRows(['only', 'three', 'names'], [4, 4, 2]), null);
  assert.equal(assignRows(null, [4, 4, 2]), null);
});

test('assignRows: null rows → null', () => {
  const xi = Array.from({ length: 11 }, (_, i) => `P${i}`);
  assert.equal(assignRows(xi, null), null);
});

test('every lineups.json formation parses or is a known fallback; xi is 11', () => {
  const d = J('data/lineups.json');
  for (const [k, v] of Object.entries(d)) {
    if (k === '__meta__') continue;
    for (const s of ['team_a', 'team_b']) {
      const side = v[s];
      if (!side) continue;
      const p = parseFormation(side.formation);
      if (p) assert.equal(p.reduce((a, b) => a + b, 0), 10, `${k}/${s} ${side.formation} must sum to 10`);
      assert.equal((side.xi || []).length, 11, `${k}/${s} xi must be 11`);
    }
  }
});

test('component does not import state/router (pure render) and uses escapeHtml', () => {
  const src = readFileSync(new URL('../../app/components/formation-pitch.js', import.meta.url), 'utf8');
  assert.ok(!/from '\.\.\/state\.js'/.test(src), 'no state import');
  assert.ok(!/from '\.\.\/router\.js'/.test(src), 'no router import');
  assert.match(src, /escape\.js/, 'uses escapeHtml');
});
