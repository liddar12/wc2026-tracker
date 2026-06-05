import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// R15b (#40): app JS must not import code from a runtime CDN. Vendored deps
// live in vendor/ and are imported by relative path. (flag-icons CSS + Google
// Fonts in index.html are CSS/links, out of scope — see vendor/README.md.)
const CDN_RE = /(?:import|from)\s*\(?\s*['"]https?:\/\/(?:esm\.sh|cdn\.jsdelivr\.net|unpkg\.com|cdn\.skypack\.dev|cdnjs\.cloudflare\.com)/;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

test('R15b #40: no CDN JS imports remain anywhere under app/', () => {
  const offenders = [];
  for (const file of walk('app')) {
    const src = readFileSync(file, 'utf8');
    if (CDN_RE.test(src)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `CDN imports found in: ${offenders.join(', ')}`);
});

test('R15b #40: vendored supabase-js exists and is self-contained', () => {
  const src = readFileSync('vendor/supabase-js.js', 'utf8');
  assert.ok(src.length > 50_000, 'supabase bundle looks too small');
  assert.equal(CDN_RE.test(src), false, 'vendored bundle must not reference a CDN');
  assert.match(src, /createClient/, 'bundle should expose createClient');
});

test('R15b #40: competition.js + play-view.js import the vendored paths', () => {
  const comp = readFileSync('app/competition.js', 'utf8');
  const play = readFileSync('app/views/play-view.js', 'utf8');
  assert.match(comp, /from '\.\.\/vendor\/supabase-js\.js'/, 'competition.js should import vendored supabase-js');
  assert.match(play, /import\('\.\.\/\.\.\/vendor\/sortablejs\.js'\)/, 'play-view.js should import vendored sortablejs');
});
