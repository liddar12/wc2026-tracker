/* apifootball.test.mjs — Track-2 data source: API-Football consensus odds +
   injuries. Verifies the integration is wired end-to-end and SAFE BY DEFAULT
   (key-gated: ships green and no-ops until the APIFOOTBALL_KEY secret exists). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const rd = (p) => readFileSync(new URL(p, root), 'utf8');

test('consensus-odds scraper: API-Football host + key header, key-gated, self-tested', () => {
  const s = rd('scripts/scrape_apifootball_odds.py');
  assert.match(s, /v3\.football\.api-sports\.io/, 'direct API-Football host');
  assert.match(s, /x-apisports-key/, 'auth header');
  assert.match(s, /APIFOOTBALL_KEY/, 'reads the key from env');
  assert.match(s, /no APIFOOTBALL_KEY[^\n]*skipping/i, 'no-ops without the key');
  assert.match(s, /--selftest|selftest/, 'has a self-test');
  assert.match(s, /league["']?\s*[:=]\s*1|LEAGUE_ID\s*=\s*1/, 'World Cup league id 1');
});

test('injuries scraper augmented with API-Football (key-gated, throttled, ESPN preserved)', () => {
  const s = rd('scripts/scrape_injuries.py');
  assert.match(s, /APIFOOTBALL_KEY/, 'reads the key');
  assert.match(s, /v3\.football\.api-sports\.io/, 'API-Football host');
  assert.match(s, /AF_THROTTLE_HOURS|should_fetch_af/, 'throttles the API-Football call');
  assert.match(s, /espn_injuries/, 'keeps the ESPN pass');
  assert.match(s, /parse_apifootball_injuries/, 'parses API-Football injuries');
});

test('data-loader exposes consensus_odds.json as data.consensusOdds (optional, graceful)', () => {
  const dl = rd('app/data-loader.js');
  assert.match(dl, /consensus_odds\.json/, 'loads the file');
  assert.match(dl, /consensusOdds/, 'maps to the consensusOdds key');
  // must be OPTIONAL (graceful fallback), never REQUIRED — scope the check to
  // each array's own block, not the whole file.
  // anchor to the array terminator (\n];) — inner `fallback: []` would otherwise
  // close a non-greedy capture prematurely.
  const required = dl.match(/const REQUIRED_FILES = \[([\s\S]*?)\n\];/)?.[1] || '';
  const optional = dl.match(/const OPTIONAL_FILES = \[([\s\S]*?)\n\];/)?.[1] || '';
  assert.ok(!required.includes('consensus_odds'), 'consensus_odds is not a REQUIRED file');
  assert.ok(optional.includes('consensus_odds'), 'consensus_odds is an OPTIONAL file');
});

test('parlay consumes data.consensusOdds for the market term', () => {
  const p = rd('app/components/parlay.js');
  assert.match(p, /consensusOdds/, 'parlay reads consensus odds');
});

test('crons pass APIFOOTBALL_KEY as a secret (never hard-coded)', () => {
  const freq = rd('.github/workflows/frequent_update.yml');
  const pre = rd('.github/workflows/pre_kickoff_update.yml');
  assert.match(freq, /APIFOOTBALL_KEY:\s*\$\{\{\s*secrets\.APIFOOTBALL_KEY\s*\}\}/, 'injuries step uses the secret');
  assert.match(pre, /scrape_apifootball_odds\.py/, 'pre-kickoff runs the odds scraper');
  assert.match(pre, /APIFOOTBALL_KEY:\s*\$\{\{\s*secrets\.APIFOOTBALL_KEY\s*\}\}/, 'odds step uses the secret');
});

test('consensus_odds.json stub is present, valid, and empty by default', () => {
  const co = JSON.parse(rd('data/consensus_odds.json'));
  assert.equal(co.source, 'api-football', 'source tag');
  assert.ok(co.match_outcomes && typeof co.match_outcomes === 'object', 'match_outcomes object');
  assert.equal(Object.keys(co.match_outcomes).length, 0, 'empty until the cron fills it');
});
