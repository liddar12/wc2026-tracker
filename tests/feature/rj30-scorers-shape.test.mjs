/* rj30-scorers-shape.test.mjs — the on-disk data/scorers.json contract that
   scorers.js (per-team card) consumes: every value except __meta__ is an array
   of {name:string, goals:number(, club)} sorted desc, length ≤ 3.

   derive_scorers.py writes scorers.json from match_events; this test validates
   whatever derive produced (CI runs derive before the feature glob). Pre-tournament
   the file may be __meta__-only, which is also valid. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const scorers = JSON.parse(readFileSync(resolve(ROOT, 'data/scorers.json'), 'utf8'));

test('scorers.json: every team value is a sorted array of {name,goals} (≤3)', () => {
  for (const [team, list] of Object.entries(scorers)) {
    if (team === '__meta__') continue;
    assert.ok(Array.isArray(list), `${team} is an array`);
    assert.ok(list.length <= 3, `${team} has ≤ 3 entries (got ${list.length})`);
    let prev = Infinity;
    for (const p of list) {
      assert.equal(typeof p.name, 'string', `${team} entry name is a string`);
      assert.ok(p.name.length > 0, `${team} entry name non-empty`);
      assert.equal(typeof p.goals, 'number', `${team} entry goals is a number`);
      assert.ok(p.goals >= 1, `${team} ${p.name} has ≥ 1 goal`);
      if ('club' in p) assert.ok(p.club === null || typeof p.club === 'string', `${team} club is null|string`);
      assert.ok(p.goals <= prev, `${team} sorted descending by goals`);
      prev = p.goals;
    }
  }
});

test('scorers.json: __meta__ carries an ISO updated_at (when present)', () => {
  const m = scorers.__meta__;
  if (!m) return; // optional pre-derive
  assert.equal(typeof m.updated_at, 'string');
  assert.ok(!Number.isNaN(Date.parse(m.updated_at)), 'updated_at parses');
});
