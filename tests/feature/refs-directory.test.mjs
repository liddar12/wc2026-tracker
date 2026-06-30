/* refs-directory.test.mjs — RJ30-10: referee directory scraper contract.
   Locks the source-layer rewrite (MediaWiki parse API, not brittle HTML regex),
   the diacritic-stable slug, and the safety contract (ASCII writes, never delete,
   SystemExit(0) on fatal). Pure: no network — the slug check spawns a tiny inline
   Python that imports the module's pure function. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const ROOT = fileURLToPath(root);

test('scrape_referees uses the MediaWiki parse API, not brittle HTML regex', () => {
  const s = read('scripts/scrape_referees.py');
  assert.match(s, /action=parse/, 'hits the MediaWiki parse endpoint');
  assert.match(s, /prop=wikitext/, 'requests raw wikitext (robust), not rendered HTML');
  // The old brittle 3-<td> HTML row regex must be gone.
  assert.doesNotMatch(s, /<tr>\s*<td/, 'old <tr><td> HTML regex is gone');
});

test('slugify folds diacritics for a stable ref_id', () => {
  const py = [
    'import sys',
    `sys.path.insert(0, ${JSON.stringify(`${ROOT}scripts`)})`,
    'import scrape_referees as sr',
    "print(sr.slugify('Szymon Marciniak'))",
    "print(sr.slugify('Szymon Marçiniak'))",
  ].join('\n');
  const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const [plain, accented] = r.stdout.trim().split('\n');
  assert.equal(plain, accented, 'diacritic-folded slug is stable across runs');
  assert.equal(plain, 'szymon_marciniak');
});

test('scraper writes ASCII + preserves the safety contract', () => {
  const s = read('scripts/scrape_referees.py');
  assert.match(s, /ensure_ascii=True/, 'serializes ASCII per repo convention');
  assert.match(s, /raise SystemExit\(0\)/, 'exits 0 on a fatal error (never fails the cron)');
  assert.match(s, /never delete an existing entry/i, 'documents the never-delete safety contract');
});

test('the on-disk referees.json is a dict-or-empty directory with the expected entry shape', () => {
  const refs = JSON.parse(read('data/referees.json'));
  assert.equal(typeof refs, 'object');
  assert.ok(!Array.isArray(refs), 'referees.json is an object map, not a list');
  const ids = Object.keys(refs).filter((k) => k !== '__meta__');
  // A populated directory carries entries with the documented shape; an empty
  // directory (pre-scrape / offline) is also valid and stays graceful.
  for (const id of ids) {
    const r = refs[id];
    assert.equal(r.ref_id, id, `${id}: ref_id matches its key`);
    assert.equal(typeof r.name, 'string', `${id}: has a name`);
    assert.ok('confederation' in r, `${id}: has a confederation field`);
    assert.ok('nationality' in r, `${id}: has a nationality field`);
    assert.ok(Array.isArray(r.history), `${id}: history is an array`);
  }
});
