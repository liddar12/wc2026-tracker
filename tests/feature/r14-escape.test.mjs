import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, escapeAttr } from '../../app/lib/escape.js';

test('R14: escapeHtml neutralizes HTML metacharacters', () => {
  assert.equal(escapeHtml('a<b>&"\''), 'a&lt;b&gt;&amp;&quot;&#39;');
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('R14: escapeHtml is null-safe', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(false), 'false');
});

test('R14: escapeAttr aliases escapeHtml', () => {
  assert.equal(escapeAttr('"x"'), '&quot;x&quot;');
});
