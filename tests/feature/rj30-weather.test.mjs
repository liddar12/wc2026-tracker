/* rj30-weather.test.mjs — RJ30-4 weather pipeline contract (no network).
 *
 * Locks the scrape_weather.py rewrite (one batched range request per venue,
 * venue-local TZ keying), the weather.json cell shape, and the UI/scraper key
 * agreement (weather.js reads kickoff_local_venue, same as the scraper). The
 * Python --selftest (pure transforms) must exit 0 with no network.
 *
 * Integrator-owned assertions (validate_data coverage check) are marked
 * { skip } below until the Wave-2 integrator wires them — see INTEGRATOR NEEDS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

test('scrape_weather.py: venue-local TZ keying (kickoff_local_venue, not UTC date)', () => {
  const s = read('scripts/scrape_weather.py');
  assert.match(s, /kickoff_local_venue/, 'must date fixtures by the venue-local day');
});

test('scrape_weather.py: ONE batched range request per venue (start_date..end_date from min/max)', () => {
  const s = read('scripts/scrape_weather.py');
  assert.match(s, /start_date=.*end_date=/s, 'URL must carry a date range, not a single date');
  // Range endpoints derive from min/max of the venue's wanted date set.
  assert.match(s, /min\(\s*wanted\s*\)|sorted\(\s*dates\s*\)\[0\]|min\(\s*dates\s*\)/,
    'start_date must come from min() of the date set');
  assert.match(s, /max\(\s*wanted\s*\)|max\(\s*dates\s*\)/,
    'end_date must come from max() of the date set');
});

test('scrape_weather.py: timezone uses a venue field (not hard-coded UTC only)', () => {
  const s = read('scripts/scrape_weather.py');
  assert.match(s, /&timezone=/, 'URL builds a timezone param');
  assert.match(s, /v\.get\("timezone"\)|v\["timezone"\]|venue.*timezone/,
    'timezone must derive from the venue, falling back to UTC');
});

test('scrape_weather.py: one venue failure continues (does not abort the run)', () => {
  const s = read('scripts/scrape_weather.py');
  assert.match(s, /except \(ScrapeError, ValueError\)/,
    'per-venue fetch must be wrapped so a 429/5xx skips that venue only');
  assert.match(s, /continue/, 'failed venue must continue, not raise');
});

test('scrape_weather.py: exposes a --selftest path', () => {
  const s = read('scripts/scrape_weather.py');
  assert.match(s, /--selftest|selftest/);
});

test('scrape_weather.py --selftest passes with no network (exit 0)', () => {
  const out = execFileSync('python3', [resolve(ROOT, 'scripts/scrape_weather.py'), '--selftest'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /selftest: PASS/, out);
});

test('weather.js reads the venue-local key (UI + scraper agree on the key)', () => {
  const s = read('app/components/weather.js');
  assert.match(s, /kickoff_local_venue/,
    'weather.js must key the cell by the venue-local day, same as the scraper (AC-4.3)');
});

test('weather.json: every value is a dict; every populated cell is fully numeric', () => {
  const w = JSON.parse(read('data/weather.json'));
  let cells = 0;
  for (const [vid, block] of Object.entries(w)) {
    if (vid === '__meta__') continue;
    assert.equal(typeof block, 'object', `${vid} block must be a dict`);
    for (const [date, cell] of Object.entries(block)) {
      cells += 1;
      for (const k of ['temp_c', 'condition_code', 'humidity_pct', 'wind_kph']) {
        assert.equal(typeof cell[k], 'number',
          `${vid}/${date}.${k} must be numeric, got ${typeof cell[k]}`);
      }
    }
  }
  // The pipeline populated real cells (not the all-empty dark state).
  assert.ok(cells >= 1, 'weather.json must have at least one populated venue-day cell');
});

test('weather.json: populated for MULTIPLE venues (not the single-cell dark state)', () => {
  const w = JSON.parse(read('data/weather.json'));
  const populated = Object.entries(w)
    .filter(([k, v]) => k !== '__meta__' && v && Object.keys(v).length > 0).length;
  assert.ok(populated >= 2,
    `expected ≥2 venues with forecasts (AC-4.1), got ${populated}`);
});

/* INTEGRATOR-OWNED (scripts/validate_data.py is Wave-2 integrator territory).
 * Unskips once check_weather_coverage() lands (warn-only). See INTEGRATOR NEEDS. */
test('validate_data.py has a warn-only weather coverage check', { skip: 'integrator wires validate_data.py' }, () => {
  const s = read('scripts/validate_data.py');
  assert.match(s, /check_weather_coverage|weather.*coverage/);
  assert.match(s, /self\.warnings\.append/);
});
