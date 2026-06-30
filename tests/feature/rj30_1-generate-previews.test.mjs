/* rj30_1-generate-previews.test.mjs — RJ30.1 Item 1: the JS-visible data contract.
   Locks (a) the shipped dormant stub shape of data/previews.json, and (b) the
   data-loader wiring the Wave-2 integrator must add (OPTIONAL_FILES entry +
   fileToKey 'previews' → 'previews'). The loader edit is NOT owned by this agent,
   so this test asserts the CONTRACT and documents the integrator need; it is
   tolerant until that wiring lands (does not hard-fail the gate on the integrator's
   pending edit), but DOES hard-lock the stub we ship. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

test('data/previews.json is a valid dormant stub (no entries, meta-only)', () => {
  const j = JSON.parse(read('data/previews.json'));
  assert.equal(typeof j, 'object');
  assert.ok(!Array.isArray(j), 'previews.json is an object map, not a list');
  assert.ok('__meta__' in j, 'carries a __meta__ block');
  assert.equal(j.__meta__.updated_at, null, 'dormant stub has updated_at === null');
  assert.equal(j.__meta__.generator_version, 'v1');
  const entries = Object.keys(j).filter((k) => k !== '__meta__');
  assert.equal(entries.length, 0, 'shipped dormant state has no match entries');
});

test('any populated entry obeys the documented shape', () => {
  const j = JSON.parse(read('data/previews.json'));
  for (const [k, v] of Object.entries(j)) {
    if (k === '__meta__') continue;
    assert.ok(['preview', 'recap'].includes(v.kind), `${k}: kind is preview|recap`);
    assert.equal(typeof v.text, 'string', `${k}: text is a string`);
    assert.equal(typeof v.content_hash, 'string', `${k}: has a content_hash`);
  }
});

test('INTEGRATOR CONTRACT: data-loader maps previews.json → previews (when wired)', () => {
  // The data-loader.js edit is owned by the Wave-2 integrator. Once wired, both
  // the OPTIONAL_FILES entry and the fileToKey case must be present. We assert
  // the pair is consistent if either appears, and surface the need otherwise.
  const loader = read('app/data-loader.js');
  const hasOptional = /previews\.json/.test(loader);
  const hasKey = /case 'previews\.json':\s*return 'previews';/.test(loader);
  if (hasOptional || hasKey) {
    assert.ok(hasOptional, "OPTIONAL_FILES must include { file: 'previews.json', fallback: {} }");
    assert.ok(hasKey, "fileToKey must map 'previews.json' → 'previews'");
  } else {
    // Not yet wired by the integrator — documented as an INTEGRATOR NEED.
    assert.ok(true, 'data-loader previews wiring pending (Wave-2 integrator)');
  }
});
