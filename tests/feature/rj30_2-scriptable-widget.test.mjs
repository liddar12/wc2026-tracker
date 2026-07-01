/* rj30_2-scriptable-widget.test.mjs — RJ30.2 (iOS widget). Proves the pure
   data-shaping of widget/scriptable-wc26.js WITHOUT any Scriptable runtime:
     1. `node --check` parses the file clean (it's a paste-into-Scriptable script).
     2. nextMatch() picks LIVE over upcoming, the SOONEST upcoming otherwise,
        skips FINAL matches, flattens the nested-by-round actual_results.json,
        and returns null when there is nothing to show — with a fixed `now`.
   The file is loaded in a node:vm CommonJS sandbox where the Scriptable globals
   (ListWidget/Request/config/Script) are UNDEFINED, so the runtime `run()` path
   never executes and only the pure helpers are exported. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const WIDGET = resolve(ROOT, 'widget/scriptable-wc26.js');

// Load the widget as CommonJS in a sandbox with NO Scriptable globals.
function loadWidget() {
  const src = readFileSync(WIDGET, 'utf8');
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, console, Date };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: WIDGET });
  return module.exports;
}

const NOW = new Date('2026-06-15T12:00:00Z');

// Nested-by-round actual_results.json shape (matches the real file).
const RESULTS = {
  group_stage: {
    'Mexico__vs__South Africa': { score_a: 2, score_b: 0, status: 'STATUS_FULL_TIME' },
    'Spain__vs__Cabo Verde': { score_a: 1, score_b: 0, status: 'STATUS_IN_PROGRESS', minute: '67' },
  },
  round_of_32: {},
  last_updated: '2026-06-15T11:59:00+00:00',
};

const SCHEDULE = [
  // Already final → must be skipped.
  { match_id: 'Mexico__vs__South Africa', team_a: 'Mexico', team_b: 'South Africa',
    kickoff_utc: '2026-06-11T19:00Z', stage: 'group', group: 'A' },
  // Live (in-progress record) → should win over any upcoming.
  { match_id: 'Spain__vs__Cabo Verde', team_a: 'Spain', team_b: 'Cabo Verde',
    kickoff_utc: '2026-06-15T11:30Z', stage: 'group', group: 'H' },
  // Upcoming (soonest future).
  { match_id: 'Belgium__vs__Egypt', team_a: 'Belgium', team_b: 'Egypt',
    kickoff_utc: '2026-06-15T19:00Z', stage: 'group', group: 'F' },
  // Upcoming (later).
  { match_id: 'Iran__vs__New Zealand', team_a: 'Iran', team_b: 'New Zealand',
    kickoff_utc: '2026-06-16T01:00Z', stage: 'group', group: 'F' },
];

test('widget script parses clean (node --check)', () => {
  execFileSync('node', ['--check', WIDGET], { cwd: ROOT });
});

test('widget exports the pure helpers (no Scriptable runtime executed)', () => {
  const w = loadWidget();
  assert.equal(typeof w.nextMatch, 'function', 'nextMatch exported');
  assert.equal(typeof w.flattenResults, 'function');
  assert.equal(typeof w.parseKickoff, 'function');
});

test('nextMatch: LIVE match beats upcoming and carries score', () => {
  const { nextMatch } = loadWidget();
  const pick = nextMatch(SCHEDULE, RESULTS, NOW);
  assert.ok(pick, 'a pick is returned');
  assert.equal(pick.state, 'live');
  assert.equal(pick.match_id, 'Spain__vs__Cabo Verde');
  assert.equal(pick.score_a, 1);
  assert.equal(pick.score_b, 0);
  assert.equal(pick.minute, '67');
  assert.ok(!('kickoffDate' in pick), 'internal Date field stripped from output');
});

test('nextMatch: no live → soonest UPCOMING (final skipped)', () => {
  const { nextMatch } = loadWidget();
  // Drop the live record so only upcoming remain.
  const results = { group_stage: {
    'Mexico__vs__South Africa': { score_a: 2, score_b: 0, status: 'STATUS_FULL_TIME' },
  } };
  const pick = nextMatch(SCHEDULE, results, NOW);
  assert.ok(pick);
  assert.equal(pick.state, 'upcoming');
  assert.equal(pick.match_id, 'Belgium__vs__Egypt', 'soonest future kickoff');
  assert.equal(pick.team_a, 'Belgium');
  assert.equal(pick.kickoff, '2026-06-15T19:00Z');
});

test('nextMatch: returns null when nothing to show', () => {
  const { nextMatch } = loadWidget();
  // Everything is final.
  const results = { group_stage: {
    'Belgium__vs__Egypt': { score_a: 1, score_b: 1, status: 'STATUS_FULL_TIME' },
    'Iran__vs__New Zealand': { score_a: 2, score_b: 2, status: 'STATUS_FULL_TIME' },
    'Spain__vs__Cabo Verde': { score_a: 0, score_b: 0, status: 'STATUS_FULL_TIME' },
    'Mexico__vs__South Africa': { score_a: 2, score_b: 0, status: 'STATUS_FULL_TIME' },
  } };
  assert.equal(nextMatch(SCHEDULE, results, NOW), null);
});

test('nextMatch: handles no/garbage data gracefully (no throw)', () => {
  const { nextMatch } = loadWidget();
  assert.equal(nextMatch(null, null, NOW), null);
  assert.equal(nextMatch([], {}, NOW), null);
  assert.equal(nextMatch(undefined, undefined, NOW), null);
  // A schedule with a future match but empty results → that upcoming match.
  const pick = nextMatch(
    [{ match_id: 'A__vs__B', team_a: 'A', team_b: 'B', kickoff_utc: '2026-06-20T19:00Z' }],
    {}, NOW);
  assert.equal(pick.match_id, 'A__vs__B');
  assert.equal(pick.state, 'upcoming');
});

test('flattenResults: flattens nested rounds and ignores scalar keys', () => {
  const { flattenResults } = loadWidget();
  const flat = flattenResults(RESULTS);
  assert.ok(flat['Mexico__vs__South Africa'], 'group_stage record flattened');
  assert.ok(flat['Spain__vs__Cabo Verde']);
  assert.ok(!('last_updated' in flat), 'scalar bookkeeping key ignored');
});

test('parseKickoff: tolerant of missing-seconds ISO', () => {
  const { parseKickoff } = loadWidget();
  const d = parseKickoff('2026-06-11T19:00Z');
  assert.ok(d instanceof Date && !isNaN(d.getTime()));
  assert.equal(d.toISOString(), '2026-06-11T19:00:00.000Z');
  assert.equal(parseKickoff(''), null);
  assert.equal(parseKickoff(null), null);
});
