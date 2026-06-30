/* rj30_1-previews-render.test.mjs — RJ30.1 Item 1: previewSection() render
   contract, DOM-free via a minimal self-contained shim (no jsdom dependency).
   The shim covers exactly what app/components/match-preview.js uses:
   createElement / createDocumentFragment / className / setAttribute / innerHTML /
   appendChild / childNodes / nodeType. Full visual rendering is asserted in the
   Playwright spec; this locks the structure + the dormant empty-fragment path +
   escaping. Installed before the component import so its module-eval sees it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- minimal DOM shim ------------------------------------------------------
const FRAGMENT_NODE = 11;
const ELEMENT_NODE = 1;

class Node {
  constructor() { this.childNodes = []; this._attrs = {}; this._html = ''; }
  appendChild(child) { this.childNodes.push(child); return child; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  // outerHTML approximates tag + attrs + innerHTML for assertion purposes.
  get outerHTML() {
    if (this.nodeType === FRAGMENT_NODE) {
      return this.childNodes.map((c) => c.outerHTML || '').join('');
    }
    const attrs = Object.entries(this._attrs)
      .map(([k, v]) => ` ${k}="${v}"`).join('');
    const cls = this.className ? ` class="${this.className}"` : '';
    return `<${this.tagName}${cls}${attrs}>${this._html}</${this.tagName}>`;
  }
}
class Element extends Node {
  constructor(tag) { super(); this.tagName = tag; this.nodeType = ELEMENT_NODE; this.className = ''; }
}
class DocumentFragment extends Node {
  constructor() { super(); this.nodeType = FRAGMENT_NODE; }
}
globalThis.document = {
  createElement: (tag) => new Element(tag),
  createDocumentFragment: () => new DocumentFragment(),
};

const { previewSection } = await import('../../app/components/match-preview.js');

const MATCH = { team_a: 'Mexico', team_b: 'South Africa' };
const ID = 'Mexico__vs__South Africa';

test('no preview entry → empty DocumentFragment (dormant, not an empty-state)', () => {
  const node = previewSection(MATCH, { previews: {} });
  assert.equal(node.nodeType, FRAGMENT_NODE, 'returns a DocumentFragment');
  assert.equal(node.childNodes.length, 0, 'fragment has no children → nothing renders');
  assert.ok(!/data-testid="ai-preview"/.test(node.outerHTML), 'no ai-preview node');
});

test('missing previews key entirely → empty fragment (no throw)', () => {
  const node = previewSection(MATCH, {});
  assert.equal(node.nodeType, FRAGMENT_NODE);
  assert.equal(node.childNodes.length, 0);
});

test('preview entry → Preview heading + escaped text + caption', () => {
  const previews = {
    [ID]: {
      kind: 'preview', text: '<b>x</b> Mexico edge it',
      model: 'claude-haiku-4-5', generated_at: '2026-06-30T16:33:05+00:00',
    },
  };
  const node = previewSection(MATCH, { previews });
  assert.equal(node.nodeType, ELEMENT_NODE, 'a real section element');
  assert.equal(node.getAttribute('data-testid'), 'ai-preview');
  assert.equal(node.getAttribute('data-kind'), 'preview');
  const html = node.outerHTML;
  assert.match(html, /Preview/, 'heading reads Preview');
  assert.doesNotMatch(html, /Recap/, 'not labeled Recap');
  // The <b> must be escaped, not a live element.
  assert.match(html, /&lt;b&gt;/, 'untyped text is HTML-escaped');
  assert.doesNotMatch(html, /<b>x<\/b> Mexico/, 'raw <b> tag not injected');
  assert.match(html, /AI-generated · claude-haiku-4-5/, 'caption shows model');
});

test('recap entry → Recap heading + data-kind=recap', () => {
  const previews = {
    [ID]: { kind: 'recap', text: 'Mexico won 2-0.', model: 'claude-haiku-4-5',
            generated_at: '2026-06-30T16:33:05+00:00' },
  };
  const node = previewSection(MATCH, { previews });
  assert.equal(node.getAttribute('data-kind'), 'recap');
  assert.match(node.outerHTML, /Recap/, 'heading reads Recap');
  assert.doesNotMatch(node.outerHTML, />Preview</, 'not labeled Preview');
});

test('reverse-orientation match_id resolves', () => {
  // Entry keyed B__vs__A; match is A vs B.
  const previews = {
    'South Africa__vs__Mexico': {
      kind: 'preview', text: 'A tight opener.', model: 'claude-haiku-4-5',
      generated_at: '2026-06-30T16:33:05+00:00',
    },
  };
  const node = previewSection(MATCH, { previews });
  assert.equal(node.getAttribute('data-testid'), 'ai-preview', 'reverse key resolves');
  assert.match(node.outerHTML, /A tight opener/);
});

test('entry with empty text → empty fragment (treated as absent)', () => {
  const previews = { [ID]: { kind: 'preview', text: '' } };
  const node = previewSection(MATCH, { previews });
  assert.equal(node.nodeType, FRAGMENT_NODE);
  assert.equal(node.childNodes.length, 0);
});
