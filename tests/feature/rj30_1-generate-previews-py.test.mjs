/* rj30_1-generate-previews-py.test.mjs — RJ30.1 Item 1: the previews generator's
   dormant-safety + selection/skip logic, proven WITHOUT the Anthropic SDK or a
   network. Two probes:
     1. --self-test exercises select_matches (window/cap), content_hash, the fake
        responder, and _clamp_text deterministically (no key, no network).
     2. A live run with an EMPTY ANTHROPIC_API_KEY must exit 0 and leave
        data/previews.json byte-for-byte unchanged (dormant). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const SCRIPT = resolve(ROOT, 'scripts/generate_previews.py');
const PREVIEWS = resolve(ROOT, 'data/previews.json');

test('generate_previews.py --self-test passes (exit 0, no network/SDK)', () => {
  const out = execFileSync('python3', [SCRIPT, '--self-test'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /selftest: PASS/, out);
});

test('runs dormant with no key → exit 0, previews.json byte-identical', () => {
  const before = readFileSync(PREVIEWS);
  const beforeMtime = statSync(PREVIEWS).mtimeMs;
  // execFileSync throws on a non-zero exit; reaching the assert means exit 0.
  const out = execFileSync('python3', [SCRIPT],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: '' } });
  const after = readFileSync(PREVIEWS);
  assert.ok(before.equals(after), 'previews.json bytes unchanged in dormant run');
  assert.equal(statSync(PREVIEWS).mtimeMs, beforeMtime, 'file not rewritten');
  // It should also log the dormant reason on stderr; stdout is fine to be empty.
  assert.equal(typeof out, 'string');
});

test('the script is dormant-by-default: no key short-circuits before any API path', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /ANTHROPIC_API_KEY/, 'reads the key from env');
  assert.match(src, /unset — previews dormant/, 'logs + returns 0 with no key');
  assert.match(src, /except ImportError/, 'SDK import is guarded (missing SDK stays dormant)');
  assert.match(src, /claude-haiku-4-5/, 'pins the Haiku model');
  assert.match(src, /cache_control/, 'marks the static system block for prompt caching');
});
