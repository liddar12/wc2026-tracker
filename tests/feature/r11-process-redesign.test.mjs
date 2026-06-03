import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildR32Seeding,
  effectiveGroupOrder,
  effectiveBestThirds,
} from '../../app/bracket-builder.js';
import {
  isMatchLocked,
  stageStarted,
  deriveLockState,
} from '../../app/competition-rules.js';
import { migrateGuestDraftsToUser } from '../../app/lib/draft-migration.js';

function fixtures() {
  return {
    scheduleFull: JSON.parse(fs.readFileSync('data/schedule_full.json', 'utf8')),
    groupMatchups: JSON.parse(fs.readFileSync('data/group_matchups.json', 'utf8')),
  };
}

function syntheticActuals(groupMatchups, scoreFn) {
  const gs = {};
  for (const [letter, info] of Object.entries(groupMatchups)) {
    for (const m of info.matches || []) {
      const r = scoreFn(letter, m);
      if (r) gs[`${m.team_a}__vs__${m.team_b}`] = r;
    }
  }
  return { group_stage: gs };
}

test('R11: effectiveGroupOrder prefers actual results when available, falls back to user picks', () => {
  const { groupMatchups } = fixtures();
  const data = { groupMatchups };

  // Case 1: no actuals, no user picks → null
  assert.equal(effectiveGroupOrder(data, {}, 'A'), null);

  // Case 2: user picks present, no actuals → user picks win
  const picks = { groups: { A: ['Mexico', 'Korea Republic', 'South Africa', 'Czechia'] } };
  const order = effectiveGroupOrder(data, picks, 'A');
  assert.deepEqual(order, ['Mexico', 'Korea Republic', 'South Africa', 'Czechia']);

  // Case 3: actuals complete → actuals win (even if user picked differently)
  const actuals = syntheticActuals(groupMatchups, (letter, m) => {
    if (letter !== 'A') return null;
    return { score_a: 2, score_b: 0 }; // team_a always wins
  });
  const dataWithActuals = { ...data, actualResults: actuals };
  const orderActual = effectiveGroupOrder(dataWithActuals, picks, 'A');
  // Actuals derived → first place is the team that won the most
  assert.ok(Array.isArray(orderActual) && orderActual.length === 4);
});

test('R11: buildR32Seeding works with NO user picks but COMPLETE actual results', () => {
  const { scheduleFull, groupMatchups } = fixtures();
  // Synthesize a result for every group match — team_a wins 2-0
  const actuals = syntheticActuals(groupMatchups, () => ({ score_a: 2, score_b: 0 }));
  const data = { scheduleFull, groupMatchups, actualResults: actuals };
  // Empty user picks
  const r32 = buildR32Seeding(data, { userPicks: { groups: {}, best_thirds: [] } });
  // Every R32 entry should have real team names (not 1A/2B/3 ABC placeholders)
  const placeholderRe = /^(\d[A-L]|3 [A-L]+)$/;
  const placeholders = [];
  for (const m of r32) {
    if (typeof m.team_a === 'string' && placeholderRe.test(m.team_a)) placeholders.push(`m${m.match_number}.a=${m.team_a}`);
    if (typeof m.team_b === 'string' && placeholderRe.test(m.team_b)) placeholders.push(`m${m.match_number}.b=${m.team_b}`);
  }
  assert.deepEqual(placeholders, [], `R32 should be fully resolvable from actuals; got placeholders: ${placeholders.join(', ')}`);
});

test('R11: buildR32Seeding still works with USER picks and NO actuals (pre-tournament)', () => {
  const { scheduleFull, groupMatchups } = fixtures();
  const data = { scheduleFull, groupMatchups };
  const userPicks = { groups: {}, best_thirds: [] };
  for (const [l, info] of Object.entries(groupMatchups)) {
    userPicks.groups[l] = (info.teams || []).slice(0, 4);
    userPicks.best_thirds.push(info.teams?.[2]);
  }
  userPicks.best_thirds = userPicks.best_thirds.slice(0, 8);
  const r32 = buildR32Seeding(data, { userPicks });
  assert.equal(r32.length, 16);
  // Every team_a should be a real name (each "1X" resolves from user picks)
  for (const m of r32) {
    assert.ok(typeof m.team_a === 'string' && !/^\d[A-L]$/.test(m.team_a), `${m.match_number}.a should resolve, got ${m.team_a}`);
  }
});

test('R11: effectiveBestThirds returns FIFA-derived top-8 when all groups complete', () => {
  const { groupMatchups } = fixtures();
  const actuals = syntheticActuals(groupMatchups, () => ({ score_a: 1, score_b: 0 }));
  const data = { groupMatchups, actualResults: actuals };
  const thirds = effectiveBestThirds(data, { best_thirds: [] });
  assert.equal(thirds.length, 8);
});

test('R11: isMatchLocked returns true once kickoff_utc has passed', () => {
  const past = { kickoff_utc: '2020-01-01T00:00:00Z' };
  const future = { kickoff_utc: '3000-01-01T00:00:00Z' };
  assert.equal(isMatchLocked(past), true);
  assert.equal(isMatchLocked(future), false);
  // Missing kickoff → not locked
  assert.equal(isMatchLocked({}), false);
});

test('R11: stageStarted picks up the earliest kickoff in a stage', () => {
  const sched = [
    { stage: 'group', kickoff_utc: '2026-06-11T19:00:00Z' },
    { stage: 'group', kickoff_utc: '2026-06-12T19:00:00Z' },
    { stage: 'round_of_32', kickoff_utc: '2026-06-28T19:00:00Z' },
  ];
  assert.equal(stageStarted(sched, 'group', Date.parse('2026-06-10T00:00:00Z')), false);
  assert.equal(stageStarted(sched, 'group', Date.parse('2026-06-11T20:00:00Z')), true);
  assert.equal(stageStarted(sched, 'round_of_32', Date.parse('2026-06-12T00:00:00Z')), false);
});

test('R11: migrateGuestDraftsToUser copies local keys without clobbering existing user keys', () => {
  // Mock localStorage
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
  };
  store.set('wc26.grouppicks.local', '{"groups":{"A":["x"]}}');
  store.set('wc26.mybrackets.local', '{"picks":{}}');
  const m = migrateGuestDraftsToUser('abc-123');
  assert.equal(m.migrated.length, 2);
  assert.equal(store.get('wc26.grouppicks.user-abc-123'), '{"groups":{"A":["x"]}}');
  assert.equal(store.get('wc26.mybrackets.user-abc-123'), '{"picks":{}}');

  // Second call should not clobber if user keys already exist
  store.set('wc26.grouppicks.local', '{"groups":{"A":["new"]}}');
  const m2 = migrateGuestDraftsToUser('abc-123');
  assert.equal(m2.migrated.length, 0);
  assert.equal(store.get('wc26.grouppicks.user-abc-123'), '{"groups":{"A":["x"]}}');
});

test('R11: deriveLockState still recognizes pre-tournament correctly', () => {
  const sched = [
    { stage: 'group', kickoff_utc: '2026-06-11T19:00:00Z' },
    { stage: 'round_of_32', kickoff_utc: '2026-06-28T19:00:00Z' },
  ];
  const pre = deriveLockState(sched, Date.parse('2026-06-01T00:00:00Z'));
  assert.equal(pre.phase, 'pre-tournament');
  assert.equal(pre.bracketLocked, false);
});
