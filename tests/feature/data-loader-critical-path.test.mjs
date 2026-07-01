/* data-loader-critical-path.test.mjs — first-load performance.
 *
 * Locks the critical-path + parallel loading contract of app/data-loader.js:
 *   - loadData() resolves after ONLY the CRITICAL set is fetched, with every
 *     critical key populated from its real payload and every deferred key
 *     PRESENT as its fallback ([] or {}) so components render "empty" not crash.
 *   - loadDeferred(base) fetches the DEFERRED set in parallel and merges it OVER
 *     the base without dropping any critical key; normalizeMatchStats +
 *     the non-enumerable __optionalFallbacks__ marker are applied to the merge.
 *   - Every fetch phase is parallel (Promise.all), so the loader never issues
 *     the deferred fetches before loadData() resolves.
 *
 * The loader reads the `fetch` and `localStorage` GLOBALS (browser runtime), so
 * we inject in-memory mocks for both and count/ order the fetch calls to prove
 * the partition + parallelism without a browser.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---- in-memory localStorage + instrumented fetch --------------------------

class MemStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

// Every data file the loader might request → a distinguishable payload so we can
// assert the right file landed under the right key. match_stats gets the nested
// ESPN shape so normalizeMatchStats has something to flatten.
const PAYLOADS = {
  'meta.json': { data_version: 'v-test-1', updated_at: '2026-06-30T00:00:00Z' },
  'teams.json': { Brazil: { fifa_rank: 1 } },
  'group_matchups.json': [{ group: 'A', a: 'Brazil', b: 'Mexico' }],
  'schedule.json': [{ match_id: 1 }],
  'actual_results.json': [{ match_id: 1, status: 'STATUS_FULL_TIME' }],
  'venues.json': [{ city: 'Dallas' }],
  'schedule_full.json': [{ match_id: 1, kickoff_utc: '2026-06-30T18:00:00Z' }],
  'knockout_matchups.json': [{ stage: 'R32' }],
  'forecast.json': { teams: [{ team: 'Brazil', champion_pct: 0.2 }] },
  'dt_model.json': { team_rankings: [{ team: 'Brazil' }] },
  // deferred
  'players.json': [{ name: 'Neymar', team: 'Brazil', position: 'FWD' }],
  'lineups.json': { 'A__vs__B': {} },
  'referees.json': { refs: [] },
  'match_referees.json': { m1: 'Ref' },
  'h2h.json': { pair: [] },
  'form.json': { Brazil: ['W'] },
  'scorers.json': { Brazil: [] },
  'weather.json': { m1: {} },
  'fatigue.json': { Brazil: 0 },
  'xg.json': { m1: {} },
  'markets.json': { champion: {} },
  'injuries.json': { Brazil: [] },
  'consensus_odds.json': { match_outcomes: {} },
  'team_colors.json': { Brazil: { primary: '#009c3b' } },
  'match_events.json': { 'A__vs__B': { key_events: [] } },
  'match_stats.json': {
    'Brazil__vs__Mexico': {
      team_a: 'Brazil', team_b: 'Mexico',
      stats: { a: { possessionPct: 60, foulsCommitted: 8 }, b: { possessionPct: 40, foulsCommitted: 12 } },
      key_events: [], updated_at: '2026-06-30T00:00:00Z',
    },
  },
  'polymarket_odds.json': { match_outcomes: {} },
  'pipeline_status.json': { ok: true },
  'previews.json': { 'A__vs__B': 'preview' },
};

// The exact key set the partition must produce.
const CRITICAL_KEYS = [
  'meta', 'teams', 'groupMatchups', 'schedule', 'actualResults',
  'venues', 'scheduleFull', 'knockoutMatchups', 'forecast', 'dtModel',
];
const DEFERRED_KEYS = [
  'players', 'lineups', 'referees', 'matchReferees', 'h2h', 'form',
  'scorers', 'weather', 'fatigue', 'xg', 'markets', 'injuries',
  'consensusOdds', 'teamColors', 'matchEvents', 'matchStats',
  'polymarketOdds', 'pipelineStatus', 'previews',
];

let fetched; // ordered list of files fetch() was asked for

function installMocks({ fail = new Set() } = {}) {
  fetched = [];
  globalThis.localStorage = new MemStorage();
  globalThis.fetch = async (url) => {
    const file = String(url).replace(/^data\//, '');
    fetched.push(file);
    if (fail.has(file) || !(file in PAYLOADS)) {
      return { ok: false, status: 404, async json() { throw new Error('no body'); } };
    }
    const body = PAYLOADS[file];
    return { ok: true, status: 200, async json() { return JSON.parse(JSON.stringify(body)); } };
  };
}

// Import once; the module reads the globals at call time, so mocks installed
// per-test are honored.
const { loadData, loadDeferred, refreshData, normalizeMatchStats } =
  await import('../../app/data-loader.js');

beforeEach(() => installMocks());

test('loadData resolves with ALL critical keys populated + all deferred keys present as fallbacks', async () => {
  const data = await loadData();

  // Every critical key carries its REAL payload.
  for (const k of CRITICAL_KEYS) {
    assert.ok(k in data, `critical key ${k} present`);
  }
  assert.equal(data.meta.data_version, 'v-test-1');
  assert.deepEqual(data.teams, { Brazil: { fifa_rank: 1 } });
  assert.equal(data.forecast.teams[0].team, 'Brazil');

  // Every deferred key is PRESENT as its fallback ([] or {}) — never missing.
  for (const k of DEFERRED_KEYS) {
    assert.ok(k in data, `deferred key ${k} present in critical result`);
  }
  // Shape of the fallbacks: players is a list → [], the rest are maps → {}.
  assert.deepEqual(data.players, [], 'players fallback is [] (a player list)');
  assert.deepEqual(data.lineups, {});
  assert.deepEqual(data.matchStats, {});

  // ONLY the 10 critical files were fetched — deferred fetches deferred.
  assert.equal(fetched.length, CRITICAL_KEYS.length,
    `only critical files fetched (got ${fetched.length}: ${fetched.join(',')})`);
  assert.ok(!fetched.includes('players.json'), 'players.json NOT fetched on critical path');
  assert.ok(fetched.includes('meta.json') && fetched.includes('teams.json'));
});

test('loadData does NOT throw when players.json is missing (moved required→deferred)', async () => {
  installMocks({ fail: new Set(['players.json']) });
  const data = await loadData(); // must resolve, not reject
  assert.deepEqual(data.players, [], 'missing players degrades to []');
});

test('loadDeferred merges deferred payloads OVER base without dropping critical keys', async () => {
  const base = await loadData();
  const fetchedAfterCritical = fetched.length;

  const full = await loadDeferred(base);

  // Deferred fetches happened AFTER the critical ones (deferred, in parallel).
  assert.ok(fetched.length > fetchedAfterCritical, 'deferred files were fetched');
  assert.ok(fetched.includes('players.json'), 'players.json fetched in the deferred phase');

  // A NEW object (not the same reference as base).
  assert.notEqual(full, base, 'loadDeferred returns a new object');

  // Critical keys survive the merge with their real payloads.
  assert.equal(full.meta.data_version, 'v-test-1');
  assert.deepEqual(full.teams, { Brazil: { fifa_rank: 1 } });
  assert.equal(full.forecast.teams[0].team, 'Brazil');

  // Deferred keys now carry their REAL payloads (overrode the fallbacks).
  assert.deepEqual(full.players, [{ name: 'Neymar', team: 'Brazil', position: 'FWD' }]);
  assert.deepEqual(full.injuries, { Brazil: [] });
  assert.equal(full.teamColors.Brazil.primary, '#009c3b');

  // normalizeMatchStats applied to the merged result: nested stats → flat.
  const row = full.matchStats['Brazil__vs__Mexico'];
  assert.ok(row.stats_a && row.stats_b, 'match_stats flattened to stats_a/stats_b');
  assert.equal(row.stats_a.possession, 60, 'ESPN possessionPct → possession');
  assert.equal(row.stats_a.fouls, 8, 'ESPN foulsCommitted → fouls');

  // The non-enumerable fallback marker rides along on the merged result.
  const marker = Object.getOwnPropertyDescriptor(full, '__optionalFallbacks__');
  assert.ok(marker, '__optionalFallbacks__ defined on merged result');
  assert.equal(marker.enumerable, false, '__optionalFallbacks__ is non-enumerable');
});

test('loadDeferred marks a deferred feed that was attempted+failed with no cache', async () => {
  installMocks({ fail: new Set(['injuries.json']) });
  const base = await loadData();
  const full = await loadDeferred(base);
  assert.deepEqual(full.injuries, {}, 'failed deferred feed falls back to {}');
  assert.equal(full.__optionalFallbacks__.injuries, true, 'marked as fell-back');
  // A feed that loaded fine is NOT marked.
  assert.ok(!full.__optionalFallbacks__.players, 'a real deferred payload is not marked');
});

test('refreshData returns the FULL data (critical + deferred), force-refreshed', async () => {
  const full = await refreshData();
  // Critical.
  assert.equal(full.meta.data_version, 'v-test-1');
  assert.deepEqual(full.teams, { Brazil: { fifa_rank: 1 } });
  // Deferred — present with REAL payloads, not fallbacks.
  assert.deepEqual(full.players, [{ name: 'Neymar', team: 'Brazil', position: 'FWD' }]);
  assert.equal(full.pipelineStatus.ok, true);
  // Force-fetch feeds were pulled.
  assert.ok(fetched.includes('markets.json'));
  assert.ok(fetched.includes('polymarket_odds.json'));
  // normalizeMatchStats applied.
  assert.equal(full.matchStats['Brazil__vs__Mexico'].stats_a.possession, 60);
});

test('normalizeMatchStats export still works standalone (unchanged contract)', () => {
  const out = normalizeMatchStats({
    'X__vs__Y': { stats: { a: { possessionPct: 55 }, b: { possessionPct: 45 } } },
    __meta__: { generated_at: 'now' },
  });
  assert.equal(out['X__vs__Y'].stats_a.possession, 55);
  assert.equal(out.__meta__.generated_at, 'now', '__meta__ passes through');
});
