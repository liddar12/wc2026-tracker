import test from 'node:test';
import assert from 'node:assert/strict';
import { computeResultsHealth, phaseAt, LOCK_BOUNDS } from '../../netlify/functions/_lib/results-health-core.mjs';

const PRE = Date.parse('2026-06-01T00:00:00Z');
const GROUP_LIVE = Date.parse('2026-06-15T20:00:00Z');
const GAP = Date.parse('2026-06-28T10:00:00Z'); // after group end (+2h), before first R32
const R32_LIVE = Date.parse('2026-06-29T00:00:00Z');

const emptyResults = {
  group_stage: {}, round_of_32: {}, round_of_16: {}, quarterfinals: {},
  semifinals: {}, third_place: {}, final: {}, last_updated: null,
};

test('R15b #44: phaseAt mirrors deriveLockState boundaries', () => {
  assert.equal(phaseAt(PRE), 'pre-tournament');
  assert.equal(phaseAt(GROUP_LIVE), 'group-stage-live');
  assert.equal(phaseAt(GAP), 'between-group-and-r32');
  assert.equal(phaseAt(R32_LIVE), 'r32-live');
  // exact boundary: first group kickoff is live
  assert.equal(phaseAt(LOCK_BOUNDS.firstGroupKickoff), 'group-stage-live');
});

test('R15b #44: pre-tournament is healthy even with empty results + no timestamp', () => {
  const h = computeResultsHealth({ data_version: null }, emptyResults, PRE);
  assert.equal(h.ok, true);
  assert.equal(h.phase, 'pre-tournament');
  assert.equal(h.stale, false);
  assert.equal(h.emptyDuringLive, false);
});

test('R15b #44: live + empty results flags emptyDuringLive', () => {
  const meta = { data_version: new Date(GROUP_LIVE - 3600_000).toISOString() }; // 1h old → fresh
  const h = computeResultsHealth(meta, { ...emptyResults }, GROUP_LIVE);
  assert.equal(h.ok, false);
  assert.equal(h.emptyDuringLive, true);
  assert.equal(h.stale, false, 'fresh timestamp should not be stale');
  assert.ok(h.reasons.some((r) => r.includes('group_stage')));
});

test('R15b #44: live + stale timestamp flags stale', () => {
  const meta = { data_version: new Date(GROUP_LIVE - 20 * 3600_000).toISOString() }; // 20h old
  const results = { ...emptyResults, group_stage: { 'M1': { home: 1, away: 0 } } };
  const h = computeResultsHealth(meta, results, GROUP_LIVE);
  assert.equal(h.stale, true);
  assert.equal(h.emptyDuringLive, false, 'group_stage is populated');
  assert.equal(h.ok, false);
  assert.equal(h.counts.group_stage, 1);
});

test('R15b #44: live + fresh + populated current stage is healthy', () => {
  const meta = { data_version: new Date(R32_LIVE - 3600_000).toISOString() };
  const results = {
    ...emptyResults,
    group_stage: { M1: { home: 2, away: 1 }, M2: { home: 0, away: 0 } },
    round_of_32: { M73: { home: 1, away: 0 } },
    last_updated: new Date(R32_LIVE - 1800_000).toISOString(), // last_updated wins over meta
  };
  const h = computeResultsHealth(meta, results, R32_LIVE);
  assert.equal(h.ok, true);
  assert.equal(h.phase, 'r32-live');
  assert.equal(h.counts.round_of_32, 1);
  assert.ok(h.ageHours < 1, 'should use last_updated (30min) not meta');
});

test('R15b #44: gap window requires no results but still checks freshness', () => {
  // between-group-and-r32 is "live" for freshness but has no expected stage.
  const fresh = { data_version: new Date(GAP - 3600_000).toISOString() };
  const h = computeResultsHealth(fresh, emptyResults, GAP);
  assert.equal(h.phase, 'between-group-and-r32');
  assert.equal(h.emptyDuringLive, false, 'no stage required during the gap');
  assert.equal(h.ok, true);
});
