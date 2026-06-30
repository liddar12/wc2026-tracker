/* strict-validate-fields.test.mjs — RJ30-9e. A fast node-test mirror of
 * validate_data.check_players so a squad-refresh regression is caught in
 * `node --test` before the authoritative Python `--strict` gate. Every row must
 * carry a truthy name, a team that exists in teams.json, and a position in the
 * canonical {GK,DEF,MID,FWD} set — exactly what the Golden Boot / Awards depend
 * on after refresh_players.py runs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const players = JSON.parse(read('data/players.json'));
const teamKeys = new Set(Object.keys(JSON.parse(read('data/teams.json'))));
const VALID = new Set(['GK', 'DEF', 'MID', 'FWD']);

test('every players.json row satisfies the validator contract (team/name/position)', () => {
  assert.ok(Array.isArray(players) && players.length > 0, 'non-empty list');
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    assert.equal(typeof p, 'object', `players[${i}] is an object`);
    assert.ok(p.name, `players[${i}] has a truthy name`);
    assert.ok(teamKeys.has(p.team), `players[${i}].team ${p.team} ∈ teams.json`);
    assert.ok(VALID.has(p.position), `players[${i}].position ${p.position} ∈ {GK,DEF,MID,FWD}`);
  }
});
