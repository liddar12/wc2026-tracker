/* live-minute-persist.test.mjs — RJ30-9c. scrape_live_results.py now persists the
 * live game clock as rec.minute for in-progress matches (stripped of ESPN's
 * trailing apostrophe), so a fan loading the page before the client poller fires
 * still sees the minute from the committed record. This guards the CONSUMER
 * contract on data/actual_results.json: any minute present is an apostrophe-free
 * clock string, and FINAL records never carry a minute. The Python parse_result
 * logic itself is locked by `python3 scripts/scrape_live_results.py --self-test`
 * (run from tests/smoke.sh). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const actual = JSON.parse(readFileSync(new URL('data/actual_results.json', root), 'utf8'));

const LIVE = new Set([
  'STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD',
  'STATUS_FIRST_HALF', 'STATUS_SECOND_HALF',
]);
const FINAL = new Set([
  'STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_END_OF_FULL_TIME',
  'STATUS_FINAL_AET', 'STATUS_FINAL_PEN',
]);
const STAGES = ['group_stage', 'round_of_32', 'round_of_16', 'quarterfinals', 'semifinals', 'third_place', 'final'];

function* records() {
  for (const stage of STAGES) {
    const tier = actual[stage];
    if (!tier || typeof tier !== 'object') continue;
    for (const [key, rec] of Object.entries(tier)) yield [stage, key, rec];
  }
}

test('any persisted minute is an apostrophe-free clock string', () => {
  for (const [stage, key, rec] of records()) {
    if (rec && rec.minute != null) {
      assert.equal(typeof rec.minute, 'string', `${stage}/${key} minute is a string`);
      assert.ok(!rec.minute.endsWith("'"), `${stage}/${key} minute has no trailing apostrophe`);
    }
  }
});

test('FINAL records never carry a minute (cards show FT/method, not a clock)', () => {
  for (const [stage, key, rec] of records()) {
    if (rec && FINAL.has(rec.status)) {
      assert.ok(!('minute' in rec), `${stage}/${key} final record has no minute`);
    }
  }
});

test('the scrape_live_results parse_result contract is documented + minute-aware', () => {
  const py = readFileSync(new URL('scripts/scrape_live_results.py', root), 'utf8');
  // The scraper must pass the display clock into parse_result and gate minute on
  // the in-progress status set (never on a FINAL record).
  assert.match(py, /display_clock/, 'parse_result receives the display clock');
  assert.match(py, /rec\["minute"\]\s*=\s*minute/, 'persists rec["minute"]');
  assert.match(py, /STATUS_IN_PROGRESS/, 'gates minute on in-progress statuses');
});
