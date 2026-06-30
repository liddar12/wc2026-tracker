/* matchup-detail-wave2-wiring.test.mjs — Wave-2 integration of the RJ30.1
 * components into the SHARED matchup-detail view:
 *   1. the AI preview (match-preview.js) mounts and is DORMANT-safe (renders an
 *      empty DocumentFragment when data.previews has no entry → nothing shows);
 *   2. a Share button is wired into the header star-row (icon button, aria-label,
 *      navigator.share → clipboard via tryShareViaNavigator on the /m/ OG path);
 *   3. directly-rendered headings are localized via t() (escaped, plain-text in →
 *      no double-escape / XSS regression).
 *
 * Source-grep assertions (the repo's house style for view wiring — these tests
 * run under `node --test` with no jsdom) plus a real dormant render of
 * previewSection through the same minimal DOM shim the previews-render spec uses,
 * proving the exact call the view makes returns an empty fragment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// ---- 1. AI preview is mounted, near the model grid -------------------------
test('matchup-detail imports + mounts the AI preview section', () => {
  const md = read('app/views/matchup-detail.js');
  assert.match(md, /import\s*\{\s*previewSection\s*\}\s*from\s*'\.\.\/components\/match-preview\.js'/,
    'imports previewSection from the Wave-1 component');
  assert.match(md, /root\.appendChild\(previewSection\(match,\s*data\)\)/,
    'appends previewSection(match, data) into the detail');
});

// ---- 2. the preview is DORMANT-safe (empty fragment when no entry) ----------
test('previewSection renders an empty fragment when previews is absent (dormant)', async () => {
  // Same minimal DOM shim as rj30_1-previews-render — installed before import.
  const FRAGMENT_NODE = 11;
  const ELEMENT_NODE = 1;
  class Node {
    constructor() { this.childNodes = []; this._attrs = {}; this._html = ''; }
    appendChild(child) { this.childNodes.push(child); return child; }
    setAttribute(k, v) { this._attrs[k] = String(v); }
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
    set innerHTML(v) { this._html = String(v); }
    get innerHTML() { return this._html; }
  }
  class Element extends Node {
    constructor(tag) { super(); this.tagName = tag; this.nodeType = ELEMENT_NODE; this.className = ''; }
  }
  class DocumentFragment extends Node {
    constructor() { super(); this.nodeType = FRAGMENT_NODE; }
  }
  const saved = globalThis.document;
  globalThis.document = {
    createElement: (tag) => new Element(tag),
    createDocumentFragment: () => new DocumentFragment(),
  };
  try {
    const { previewSection } = await import('../../app/components/match-preview.js');
    const match = { team_a: 'Mexico', team_b: 'South Africa' };
    // Dormant: data has no previews (the shipped state until generate_previews.py runs).
    const dormant = previewSection(match, { previews: {} });
    assert.equal(dormant.nodeType, FRAGMENT_NODE, 'returns a DocumentFragment');
    assert.equal(dormant.childNodes.length, 0, 'no children → nothing renders, no VoiceOver noise');
    // …and missing previews key entirely also stays dormant (no throw).
    const dormant2 = previewSection(match, {});
    assert.equal(dormant2.childNodes.length, 0, 'absent previews key still dormant');
  } finally {
    if (saved === undefined) delete globalThis.document; else globalThis.document = saved;
  }
});

// ---- 3. Share button is wired into the header star-row ----------------------
test('matchup-detail wires a Share button on the /m/ OG path', () => {
  const md = read('app/views/matchup-detail.js');
  assert.match(md, /import\s*\{[^}]*buildMatchShareUrl[^}]*tryShareViaNavigator[^}]*\}\s*from\s*'\.\.\/share-match\.js'/,
    'imports buildMatchShareUrl + tryShareViaNavigator from share-match.js');
  assert.match(md, /shareButton\(match\)/, 'mounts a shareButton into the header');
  assert.match(md, /className\s*=\s*'icon-btn'/, 'uses the icon-btn class per the a11y contract');
  assert.match(md, /setAttribute\(\s*'aria-label'\s*,\s*'Share this matchup'\s*\)/,
    'the icon button carries an aria-label (icon-only → label is the accessible name)');
  assert.match(md, /tryShareViaNavigator\([\s\S]*?buildMatchShareUrl\(match\.team_a,\s*match\.team_b\)/,
    'shares the buildMatchShareUrl(/m/<pair>) path via navigator.share → clipboard');
  assert.match(md, /min-width:44px;min-height:44px/,
    'icon button meets the 44px touch-target floor (icon-btn has no project CSS)');
  // The button sits in the star-row alongside the watchlist star.
  assert.match(md, /starRow\.appendChild\(shareButton\(match\)\)/, 'share button added to the star-row');
});

// ---- 4. directly-rendered headings localized via t() (escaped) -------------
test('matchup-detail localizes its direct-render headings via t() (escaped)', () => {
  const md = read('app/views/matchup-detail.js');
  assert.match(md, /import\s*\{\s*t\s*\}\s*from\s*'\.\.\/lib\/i18n\.js'/, 'imports t from i18n');
  assert.match(md, /escapeHtml\(t\('matchup\.yourPick'\)\)/, "Your pick heading via t(), escaped");
  assert.match(md, /escapeHtml\(t\('matchup\.finalResult'\)\)/, "Final result heading via t(), escaped");
  // No bare English literal left for these two direct-render headings.
  assert.doesNotMatch(md, /<h2>Your pick<\/h2>/, 'no hardcoded "Your pick" heading');
  assert.doesNotMatch(md, /<h2>Final result<\/h2>/, 'no hardcoded "Final result" heading');
});

// ---- 5. the catalog actually carries those keys (en + es) ------------------
test('i18n catalogs carry the matchup heading keys used by the view', async () => {
  const { EN, _setCatalogES, t } = await import('../../app/lib/i18n.js');
  assert.equal(EN['matchup.yourPick'], 'Your pick', 'EN catalog key present + byte-identical');
  assert.equal(EN['matchup.finalResult'], 'Final result');
  const { ES } = await import('../../app/lib/strings.es.js');
  assert.ok(ES['matchup.yourPick'], 'ES mirrors the key');
  assert.ok(ES['matchup.finalResult'], 'ES mirrors finalResult');
  // t() resolves es when the ES catalog is injected (test seam).
  _setCatalogES(ES);
  assert.equal(t('matchup.yourPick', undefined, 'es'), ES['matchup.yourPick']);
});
