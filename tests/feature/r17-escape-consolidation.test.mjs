import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml, escapeAttr } from '../../app/lib/escape.js';

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

test('R17 #5a: escapeHtml/escapeAttr are defined ONLY in app/lib/escape.js', () => {
  const offenders = [];
  for (const f of walk('app')) {
    if (f.endsWith('app/lib/escape.js')) continue;
    const src = readFileSync(f, 'utf8');
    if (/function\s+escapeHtml\b|const\s+escapeHtml\s*=/.test(src)) offenders.push(f + ' (escapeHtml)');
    if (/function\s+escapeAttr\b|const\s+escapeAttr\s*=/.test(src)) offenders.push(f + ' (escapeAttr)');
  }
  assert.deepEqual(offenders, [], `local escaper definitions must be gone: ${offenders.join(', ')}`);
});

test('R17 #5a: any file using escapeHtml imports it from lib/escape.js', () => {
  const missing = [];
  for (const f of walk('app')) {
    if (f.endsWith('app/lib/escape.js')) continue;
    const src = readFileSync(f, 'utf8');
    if (/\bescapeHtml\s*\(/.test(src) && !/from '[^']*lib\/escape\.js'/.test(src)) missing.push(f);
  }
  assert.deepEqual(missing, [], `files using escapeHtml without importing it: ${missing.join(', ')}`);
});

test('R17 #5a: canonical escaper is null-safe + escapes the dangerous chars', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(`<a href="x" o='y'>&`), '&lt;a href=&quot;x&quot; o=&#39;y&#39;&gt;&amp;');
  assert.equal(escapeAttr, escapeHtml, 'escapeAttr aliases escapeHtml');
});
