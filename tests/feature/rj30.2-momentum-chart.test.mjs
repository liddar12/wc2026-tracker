/* rj30.2-momentum-chart.test.mjs — RJ30.2 Match Intelligence (Wave-1 B).
 *
 * Locks renderMomentum() + buildMomentum() with the same minimal DOM shim (no
 * jsdom). Asserts:
 *   - the momentum strip BUILDS from key_events (shot pressure by minute + goal
 *     markers), reusing the shared sparkline;
 *   - reduced-motion is honored (data-reduced-motion flag on the wrapper);
 *   - ABSENT / event-less data → empty DocumentFragment (NOT an empty-state);
 *   - buildMomentum bucketing is directional (team_a shots push +, team_b −) and
 *     goal markers carry the correct side + minute.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/* ----------------------------- DOM shim ---------------------------------- */
const FRAGMENT_NODE = 11;
const ELEMENT_NODE = 1;
class Style {
  constructor() { this._m = {}; }
  setProperty(k, v) { this._m[k] = String(v); }
  get left() { return this._m.left || ''; } set left(v) { this._m.left = String(v); }
}
class Node {
  constructor() { this.childNodes = []; this._attrs = {}; this._html = ''; this._text = ''; this.style = new Style(); }
  appendChild(child) { this.childNodes.push(child); return child; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  set innerHTML(v) { this._html = String(v); } get innerHTML() { return this._html; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text || this.childNodes.map((c) => c.textContent || '').join(''); }
  get outerHTML() {
    if (this.nodeType === FRAGMENT_NODE) return this.childNodes.map((c) => c.outerHTML || '').join('');
    const attrs = Object.entries(this._attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
    const cls = this.className ? ` class="${this.className}"` : '';
    const styleStr = Object.keys(this.style._m).length
      ? ` style="${Object.entries(this.style._m).map(([k, v]) => `${k}:${v}`).join(';')}"` : '';
    const inner = this._html || this._text || this.childNodes.map((c) => c.outerHTML || '').join('');
    return `<${this.tagName}${cls}${attrs}${styleStr}>${inner}</${this.tagName}>`;
  }
}
class Element extends Node {
  constructor(tag) { super(); this.tagName = tag; this.nodeType = ELEMENT_NODE; this.className = ''; }
}
class DocumentFragment extends Node { constructor() { super(); this.nodeType = FRAGMENT_NODE; } }
globalThis.document = {
  createElement: (tag) => new Element(tag),
  createElementNS: (_ns, tag) => new Element(tag),
  createDocumentFragment: () => new DocumentFragment(),
};

const { renderMomentum, buildMomentum } = await import('../../app/components/momentum-chart.js');

/* ------------------------------ fixtures --------------------------------- */
const MATCH = { team_a: 'Mexico', team_b: 'South Africa' };
const ID = 'Mexico__vs__South Africa';
const KEY_EVENTS = [
  { minute: 12, type: 'shot', team: 'Mexico', text: 'Shot' },
  { minute: 23, type: 'goal', team: 'Mexico', text: 'Goal!' },
  { minute: 40, type: 'shotOnTarget', team: 'South Africa', text: 'Saved' },
  { minute: 58, type: 'shot', team: 'Mexico', text: 'Wide' },
  { minute: 77, type: 'goal', team: 'South Africa', text: 'Equalizer' },
  { minute: 88, type: 'yellow', team: 'Mexico', text: 'Booking' }, // non-shot/goal, ignored by pressure
];
const DATA = { matchStats: { [ID]: { team_a: 'Mexico', team_b: 'South Africa', stats_a: {}, stats_b: {}, key_events: KEY_EVENTS } } };

/* ------------------------------- tests ----------------------------------- */
test('buildMomentum: shot pressure is directional (team_a +, team_b −) and length-stable', () => {
  const { series, goals } = buildMomentum(KEY_EVENTS, 'Mexico');
  assert.equal(series.length, 15, 'fixed 15-bucket strip');
  // Mexico shots at 12 & 58 push +; a South Africa shot at 40 pushes −; goals also count as shots.
  const sum = series.reduce((a, b) => a + b, 0);
  // +1(12 shot) +1(23 goal) −1(40 SA) +1(58 shot) −1(77 SA goal) = +1
  assert.equal(sum, 1, 'net pressure reflects who shot more (Mexico)');
  assert.equal(goals.length, 2, 'both goals captured as markers');
});

test('buildMomentum: goal markers carry side + minute + strip position', () => {
  const { goals } = buildMomentum(KEY_EVENTS, 'Mexico');
  const g1 = goals.find((g) => g.minute === 23);
  const g2 = goals.find((g) => g.minute === 77);
  assert.equal(g1.side, 'a', 'Mexico goal → side a');
  assert.equal(g2.side, 'b', 'South Africa goal → side b');
  assert.ok(g1.pct > 20 && g1.pct < 30, `23′ sits ~25% along the strip (got ${g1.pct})`);
});

test('renders a .home-card momentum strip that reuses the shared sparkline', () => {
  const node = renderMomentum(MATCH, DATA);
  assert.equal(node.nodeType, ELEMENT_NODE, 'a real element');
  assert.match(node.className, /home-card/, 'uses .home-card');
  assert.equal(node.getAttribute('data-testid'), 'momentum');
  const html = node.outerHTML;
  assert.match(html, /class="sparkline mm-spark"/, 'reuses the shared sparkline component');
  assert.match(html, /data-testid="mm-goal"/, 'goal markers rendered');
  // two goal markers, one per side
  assert.ok((html.match(/data-testid="mm-goal"/g) || []).length === 2, 'exactly two goal markers');
  assert.match(html, /aria-label="Momentum:[^"]*2 goals marked"/, 'strip has a descriptive aria-label');
});

test('reduced-motion is honored via a data flag the CSS can key off', () => {
  // window.matchMedia absent in the shim → treated as no-reduce (false), but the
  // flag attribute must always be present so CSS can target it.
  const node = renderMomentum(MATCH, DATA);
  assert.ok(node.getAttribute('data-reduced-motion') != null, 'reduced-motion flag present');
});

test('reduced-motion flag flips to true when matchMedia reports the preference', () => {
  const savedWin = globalThis.window;
  globalThis.window = { matchMedia: (q) => ({ matches: /reduce/.test(q) }) };
  try {
    const node = renderMomentum(MATCH, DATA);
    assert.equal(node.getAttribute('data-reduced-motion'), 'true', 'honors prefers-reduced-motion: reduce');
  } finally {
    if (savedWin === undefined) delete globalThis.window; else globalThis.window = savedWin;
  }
});

test('absent / event-less data → empty DocumentFragment (NOT an empty-state)', () => {
  // no matchStats entry at all
  const a = renderMomentum(MATCH, { matchStats: {} });
  assert.equal(a.nodeType, FRAGMENT_NODE);
  assert.equal(a.childNodes.length, 0);
  assert.ok(!/empty-state/.test(a.outerHTML), 'no empty-state affordance');
  // entry present but key_events empty
  const b = renderMomentum(MATCH, { matchStats: { [ID]: { team_a: 'Mexico', team_b: 'South Africa', key_events: [] } } });
  assert.equal(b.childNodes.length, 0, 'empty timeline → nothing renders');
  // entry with only non-shot/non-goal events → still nothing (no pressure to show)
  const c = renderMomentum(MATCH, { matchStats: { [ID]: { team_a: 'Mexico', team_b: 'South Africa', key_events: [{ minute: 10, type: 'yellow', team: 'Mexico' }] } } });
  assert.equal(c.childNodes.length, 0, 'card/booking-only timeline → nothing renders');
});

test('never throws on malformed events (missing minute / unknown type)', () => {
  const junk = { matchStats: { [ID]: { team_a: 'Mexico', team_b: 'South Africa', key_events: [
    { type: 'goal', team: 'Mexico' },            // no minute
    { minute: 'x', type: 'shot', team: 'Mexico' }, // non-numeric minute
    { minute: 30, type: 'goal', team: 'Mexico' },  // valid → makes it render
  ] } } };
  const node = renderMomentum(MATCH, junk);
  assert.equal(node.nodeType, ELEMENT_NODE, 'the one valid goal still renders a strip');
  assert.match(node.outerHTML, /data-testid="mm-goal"/);
});
