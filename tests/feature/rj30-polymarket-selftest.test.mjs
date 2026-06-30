/* rj30-polymarket-selftest.test.mjs — runs the Python scraper's --selftest
   (pure transforms: de-vig, RENAMES, parse_event, canonical flip, drops). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../');

test('scrape_polymarket_odds.py --selftest passes (exit 0)', () => {
  const out = execFileSync('python3', [resolve(ROOT, 'scripts/scrape_polymarket_odds.py'), '--selftest'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /selftest: PASS/, out);
});
