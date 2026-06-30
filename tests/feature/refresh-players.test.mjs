/* refresh-players.test.mjs — RJ30-7. Locks the OUTPUT CONTRACT of the squad
 * refresh (scripts/refresh_players.py) that the Golden Boot / Awards depend on:
 * a non-empty flat list, valid team+position on every row, no duplicate
 * (team, normPlayerName) pairs, and — critically — that players.json.goals is
 * DISPLAY-ONLY and does NOT move the deterministic Boot. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normPlayerName, goldenBootProjections } from '../../app/lib/golden-boot.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const players = JSON.parse(read('data/players.json'));
const teamKeys = new Set(Object.keys(JSON.parse(read('data/teams.json'))));
const VALID = new Set(['GK', 'DEF', 'MID', 'FWD']);

test('players.json is a non-empty flat list with valid name/team/position', () => {
  assert.ok(Array.isArray(players), 'players is an array');
  assert.ok(players.length > 600, `>600 rows (got ${players.length})`);
  for (const p of players) {
    assert.ok(p.name, `row has a truthy name: ${JSON.stringify(p).slice(0, 80)}`);
    assert.ok(teamKeys.has(p.team), `team ${p.team} in teams.json`);
    assert.ok(VALID.has(p.position), `position ${p.position} in {GK,DEF,MID,FWD}`);
  }
});

test('no duplicate (team, normPlayerName) pairs — the merge must not double-insert', () => {
  const seen = new Set();
  for (const p of players) {
    const k = `${p.team}|${normPlayerName(p.name)}`;
    assert.ok(!seen.has(k), `duplicate ${k}`);
    seen.add(k);
  }
});

test('players.json.goals is display-only — bumping it does NOT move the Boot', () => {
  // Build a minimal but realistic data object the Boot can run on.
  const teams = JSON.parse(read('data/teams.json'));
  const base = { teams, players: players.slice(0, 200), forecast: { teams: [] } };
  // Find an attacker the Boot actually scores (posWeight > 0) to mutate.
  const i = base.players.findIndex((p) => p.position === 'FWD' || p.position === 'MID');
  assert.ok(i >= 0, 'have an attacker to mutate');

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const d1 = clone(base);
  const d2 = clone(base);
  d2.players[i].goals = (d2.players[i].goals || 0) + 5; // career-goal bump (display)

  const opts = { seed: 1234567, sims: 2000 };
  const p1 = goldenBootProjections(d1, opts).map((c) => [c.player, c.bootPct]);
  const p2 = goldenBootProjections(d2, opts).map((c) => [c.player, c.bootPct]);
  assert.deepEqual(p2, p1, 'bootPct identical — players.json.goals cannot move odds');
});
