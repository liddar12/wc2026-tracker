/* knockout-resolution.test.mjs — RCA 2026-06-28: the schedule/predictions froze
   at the end of the group stage because nothing resolved knockout placeholder
   slots (1A/2B/W74/3 ABCDF) into the actual qualified teams. resolve_knockouts.py
   adopts ESPN's resolved fixtures; this verifies it's wired and the data is sane. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const rd = (p) => readFileSync(new URL(p, root), 'utf8');
const KO_STAGES = new Set(['round_of_32', 'round_of_16', 'quarterfinals', 'semifinals', 'third_place', 'final']);
const PLACEHOLDER = /^\d[A-L]$|^[A-L]\d|^3[A-L/]|^3 |^W\d|^L\d|^1[A-L]|^2[A-L]|^RU/i;

test('resolver exists: ESPN-sourced, venue+date match, key-safe behaviors', () => {
  const s = rd('scripts/resolve_knockouts.py');
  assert.match(s, /site\.api\.espn\.com/, 'pulls ESPN scoreboard');
  assert.match(s, /venue_id/, 'matches by venue');
  assert.match(s, /KNOCKOUT_STAGES/, 'scoped to knockout stages');
  assert.match(s, /not in team_names|teams\.json/, 'guards against non-canonical teams');
  assert.match(s, /--selftest/, 'has a self-test');
});

test('both schedule crons run the knockout resolver after reconcile', () => {
  for (const wf of ['daily_update.yml', 'frequent_update.yml']) {
    const y = rd(`.github/workflows/${wf}`);
    assert.match(y, /resolve_knockouts\.py/, `${wf} runs the resolver`);
    // must come AFTER reconcile (reconcile re-times real matches; resolve fills slots)
    assert.ok(y.indexOf('reconcile_schedule.py') < y.indexOf('resolve_knockouts.py'),
      `${wf}: resolver runs after reconcile`);
  }
});

test('schedule_full: R32 fixtures are resolved to real teams (no R32 placeholders)', () => {
  const sched = JSON.parse(rd('data/schedule_full.json'));
  const teams = new Set(Object.keys(JSON.parse(rd('data/teams.json'))));
  const r32 = sched.filter((m) => m.stage === 'round_of_32');
  assert.equal(r32.length, 16, '16 R32 matches');
  for (const m of r32) {
    assert.ok(!PLACEHOLDER.test(String(m.team_a)) && !PLACEHOLDER.test(String(m.team_b)),
      `R32 ${m.match_id} resolved (got ${m.team_a} v ${m.team_b})`);
    // resolved teams must be canonical (in teams.json) or the validator would fail
    assert.ok(teams.has(m.team_a) && teams.has(m.team_b), `R32 ${m.match_id} teams canonical`);
  }
});

test('schedule_full still passes structural invariants (104 matches, unique ids)', () => {
  const sched = JSON.parse(rd('data/schedule_full.json'));
  assert.equal(sched.length, 104, '104 matches');
  assert.equal(new Set(sched.map((m) => m.match_id)).size, 104, 'unique match_ids');
  // later rounds (R16+) legitimately remain placeholders until R32 is played
  const undetermined = sched.filter((m) => KO_STAGES.has(m.stage) && m.stage !== 'round_of_32'
    && (PLACEHOLDER.test(String(m.team_a)) || PLACEHOLDER.test(String(m.team_b))));
  assert.ok(undetermined.length > 0, 'R16+ remain placeholders (sanity — not yet determined)');
});
