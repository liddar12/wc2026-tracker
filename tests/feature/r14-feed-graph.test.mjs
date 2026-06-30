import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildKnockoutFeeds, computeRounds, setPickFor, clearDownstream, getPickFor } from '../../app/bracket-builder.js';

const data = { scheduleFull: JSON.parse(fs.readFileSync('data/schedule_full.json', 'utf8')) };

test('R14: buildKnockoutFeeds parses the real W-feed graph from the schedule', () => {
  const f = buildKnockoutFeeds(data);
  assert.ok(f, 'feeds should parse');
  // R16 M89 = W74 + W77 (NOT index-adjacent 73+74)
  const m89 = f.R16.find((x) => x.match_number === 89);
  assert.deepEqual([m89.feedA, m89.feedB], [74, 77]);
  const m90 = f.R16.find((x) => x.match_number === 90);
  assert.deepEqual([m90.feedA, m90.feedB], [73, 75]);
  // QF M97 = W89 + W90
  const m97 = f.QF.find((x) => x.match_number === 97);
  assert.deepEqual([m97.feedA, m97.feedB], [89, 90]);
  // Final M104 = W101 + W102
  assert.deepEqual([f.Final[0].feedA, f.Final[0].feedB], [101, 102]);
});

test('R14: feed graph still parses after an R16 fixture resolves to real teams (id is the stable source)', () => {
  // Regression: resolve_knockouts overwrites team_a/team_b with the advancing
  // team once a KO game finishes, erasing its "W##" slots. Parsing feeds from
  // team_a/team_b made buildKnockoutFeeds return null the moment any R16 game
  // was decided; the stable match_id must keep the graph intact.
  const resolved = JSON.parse(fs.readFileSync('data/schedule_full.json', 'utf8')).map((m) =>
    m.match_number === 89 ? { ...m, team_a: 'Brazil', team_b: 'Japan' } : m);
  const f = buildKnockoutFeeds({ scheduleFull: resolved });
  assert.ok(f, 'feeds parse even when M89 has resolved to real team names');
  const m89 = f.R16.find((x) => x.match_number === 89);
  assert.deepEqual([m89.feedA, m89.feedB], [74, 77], 'feeds from the stable match_id, not the resolved teams');
});

test('R14: computeRounds(data) wires R16 from the real feeders, not index pairs', () => {
  const r32 = [];
  for (let mn = 73; mn <= 88; mn++) r32.push({ match_number: mn, team_a: `A${mn}`, team_b: `B${mn}` });
  const draft = { picks: {} };
  // Pick team_a in every R32 match so each match's winner is "A<mn>"
  for (let mn = 73; mn <= 88; mn++) setPickFor(draft, mn, `A${mn}`, { team_a: `A${mn}`, team_b: `B${mn}` });
  const rounds = computeRounds(r32, draft, data);
  const r16 = rounds.find((r) => r.key === 'R16');
  // M89 must feed from winners of 74 and 77 -> A74 vs A77
  const m89 = r16.matches.find((m) => m.match_number === 89);
  assert.equal(m89.team_a, 'A74');
  assert.equal(m89.team_b, 'A77');
  // M90 -> winners of 73 and 75
  const m90 = r16.matches.find((m) => m.match_number === 90);
  assert.equal(m90.team_a, 'A73');
  assert.equal(m90.team_b, 'A75');
});

test('R14: clearDownstream now clears the 3rd-place game (103) on SF-or-earlier change', () => {
  const draft = { picks: {} };
  setPickFor(draft, 73, 'X');   // R32
  setPickFor(draft, 101, 'Y');  // SF
  setPickFor(draft, 103, 'Z');  // 3rd place
  setPickFor(draft, 104, 'W');  // Final
  // Change an R32 pick -> everything downstream incl. 103 must clear
  clearDownstream(draft, 73);
  assert.equal(getPickFor(draft, 103), null, '3rd-place must be cleared');
  assert.equal(getPickFor(draft, 104), null, 'final must be cleared');
  assert.equal(getPickFor(draft, 73), 'X', 'the changed match itself is untouched');
});

test('R14: clearDownstream from a SF match clears 103 (SF losers changed)', () => {
  const draft = { picks: {} };
  setPickFor(draft, 101, 'A');
  setPickFor(draft, 103, 'B');
  clearDownstream(draft, 101);
  assert.equal(getPickFor(draft, 103), null);
});
