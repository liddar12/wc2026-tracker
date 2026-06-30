/* rj30-derive-scorers.test.mjs — runs derive_scorers.py --selftest (pure tally:
   own-goal/card excluded, pen-goal counted, accent-merge). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../');

test('derive_scorers.py --selftest passes (exit 0)', () => {
  const out = execFileSync('python3', [resolve(ROOT, 'scripts/derive_scorers.py'), '--selftest'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /selftest: PASS/, out);
});
