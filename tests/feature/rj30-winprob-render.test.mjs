/* rj30-winprob-render.test.mjs — DOM render contract for the redesigned live
   win-probability widget (app/components/win-probability.js):
     - GROUP: 3-way win/draw/win bar (seg-d present).
     - KNOCKOUT: 2-segment "to advance" bar (NO draw seg/label), + et-pk line.
     - BOTH: two stacked "Now (live)" / "Pre-match (model)" bars.
     - LARGER labeled trend with a 50% baseline + goal markers.
     - empty DocumentFragment unless live + prior.
   DOM-free via a minimal self-contained shim (createElement / createElementNS /
   createDocumentFragment / style / children / setAttribute / textContent), plus a
   window.matchMedia stub. Installed before the component import. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- minimal DOM shim ------------------------------------------------------
const FRAGMENT_NODE = 11;
const ELEMENT_NODE = 1;

class Node {
  constructor() {
    this.childNodes = []; this._attrs = {}; this._html = '';
    this.className = ''; this.style = {}; this._text = '';
  }
  appendChild(child) { this.childNodes.push(child); return child; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = String(v); }
  get textContent() {
    const own = this._text || this._html.replace(/<[^>]+>/g, '');
    return own + this.childNodes.map((c) => c.textContent || '').join('');
  }
  // element-only children (mirrors HTMLCollection).
  get children() { return this.childNodes.filter((c) => c.nodeType === ELEMENT_NODE); }
  // Deep query by class token (enough for the assertions here).
  hasClassDeep(cls) {
    if (this._hasClass(cls)) return true;
    return this.childNodes.some((c) => c.hasClassDeep && c.hasClassDeep(cls));
  }
  _hasClass(cls) {
    const list = String(this.className || '').split(/\s+/);
    if (list.includes(cls)) return true;
    return String(this._attrs.class || '').split(/\s+/).includes(cls);
  }
  countClassDeep(cls) {
    let n = this._hasClass(cls) ? 1 : 0;
    for (const c of this.childNodes) if (c.countClassDeep) n += c.countClassDeep(cls);
    return n;
  }
  findByTestId(id) {
    if (this._attrs['data-testid'] === id) return this;
    for (const c of this.childNodes) {
      const hit = c.findByTestId && c.findByTestId(id);
      if (hit) return hit;
    }
    return null;
  }
  get outerHTML() {
    if (this.nodeType === FRAGMENT_NODE) return this.childNodes.map((c) => c.outerHTML || '').join('');
    const attrs = Object.entries(this._attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
    const cls = this.className ? ` class="${this.className}"` : '';
    const kids = this.childNodes.map((c) => c.outerHTML || '').join('');
    return `<${this.tagName}${cls}${attrs}>${this._html}${this._text}${kids}</${this.tagName}>`;
  }
}
class Element extends Node {
  constructor(tag) { super(); this.tagName = tag; this.nodeType = ELEMENT_NODE; }
}
class DocumentFragment extends Node {
  constructor() { super(); this.nodeType = FRAGMENT_NODE; }
}
globalThis.document = {
  createElement: (tag) => new Element(tag),
  createElementNS: (_ns, tag) => new Element(tag),
  createDocumentFragment: () => new DocumentFragment(),
};
globalThis.window = { matchMedia: () => ({ matches: false }) };

const { liveWinProbability } = await import('../../app/components/win-probability.js');

const LIVE = (score_a, score_b, minute) => ({ mode: 'live', actual: { score_a, score_b, minute } });

test('not live → empty DocumentFragment (nothing renders)', () => {
  const match = { probabilities: { team_a_wins: 50, draw: 25, team_b_wins: 25 } };
  const node = liveWinProbability(match, { mode: 'final', actual: { score_a: 1, score_b: 0 } });
  assert.equal(node.nodeType, FRAGMENT_NODE);
  assert.equal(node.childNodes.length, 0);
});

test('no prior → empty DocumentFragment', () => {
  const node = liveWinProbability({ stage: 'group' }, LIVE(0, 0, 20));
  assert.equal(node.nodeType, FRAGMENT_NODE);
  assert.equal(node.childNodes.length, 0);
});

test('GROUP: renders a 3-way bar with a draw segment', () => {
  const match = { team_a: 'Mexico', team_b: 'Canada', stage: 'group', probabilities: { team_a_wins: 50, draw: 25, team_b_wins: 25 } };
  const node = liveWinProbability(match, LIVE(1, 1, 60));
  assert.equal(node.nodeType, ELEMENT_NODE);
  assert.equal(node.getAttribute('data-testid'), 'live-win-prob');
  assert.ok(node.hasClassDeep('seg-d'), 'group bar has a draw segment');
  assert.match(node.outerHTML, /draw/, 'group labels mention draw');
  assert.equal(node.findByTestId('et-pk'), null, 'no ET/PK line for group');
});

test('KNOCKOUT: 2-way "to advance" bar — NO draw segment, no "draw" label', () => {
  const match = { team_a: 'Brazil', team_b: 'Japan', stage: 'round_of_32', advance_pct_a: 62, advance_pct_b: 38 };
  const node = liveWinProbability(match, LIVE(0, 0, 70));
  assert.equal(node.getAttribute('data-testid'), 'live-win-prob');
  assert.ok(!node.hasClassDeep('seg-d'), 'no draw segment in a knockout bar');
  assert.doesNotMatch(node.outerHTML, /draw/i, 'no "draw" copy for knockout');
  assert.match(node.outerHTML, /to advance/, 'knockout shows a "to advance" caption');
});

test('BOTH: two stacked Now/Pre-match bars are present', () => {
  const match = { team_a: 'Brazil', team_b: 'Japan', stage: 'round_of_32', advance_pct_a: 62, advance_pct_b: 38 };
  const node = liveWinProbability(match, LIVE(1, 0, 55));
  assert.ok(node.hasClassDeep('wp-stacks'), 'has the stacked-bars container');
  assert.equal(node.countClassDeep('wp-stack-row'), 2, 'exactly two stacked bars (live + pre-match)');
  assert.match(node.outerHTML, /Now \(live\)/);
  assert.match(node.outerHTML, /Pre-match \(model\)/);
});

test('KNOCKOUT: ET/PK line renders with data-testid="et-pk" when non-zero', () => {
  // Level scoreline late ⇒ high ET ⇒ the line renders.
  const match = { team_a: 'Brazil', team_b: 'Japan', stage: 'round_of_16', advance_pct_a: 55, advance_pct_b: 45 };
  const node = liveWinProbability(match, LIVE(1, 1, 88));
  const etpk = node.findByTestId('et-pk');
  assert.ok(etpk, 'et-pk line present');
  assert.match(etpk.textContent, /extra time/);
  assert.match(etpk.textContent, /penalties/);
});

test('LIVE indicator emits clean red text (no red pill) — component side', () => {
  const match = { team_a: 'Mexico', team_b: 'Canada', stage: 'group', probabilities: { team_a_wins: 50, draw: 25, team_b_wins: 25 } };
  const node = liveWinProbability(match, LIVE(1, 0, 16));
  assert.match(node.outerHTML, /class="live-indicator">LIVE 16'/, 'LIVE 16\' indicator emitted');
});

test('TREND: larger labeled sparkline with a 50% baseline + goal markers', () => {
  const match = { team_a: 'Mexico', team_b: 'Canada', stage: 'group', probabilities: { team_a_wins: 50, draw: 25, team_b_wins: 25 } };
  // Seed a persisted series with a sharp jump so a goal marker is drawn.
  globalThis.window.__wc26WinProbSeries = {
    'Mexico__Canada': [40, 42, 41, 78, 80],
    'Mexico__Canada__m': 60,
  };
  const node = liveWinProbability({ ...match, match_id: undefined }, LIVE(1, 0, 61));
  assert.match(node.outerHTML, /Win probability since kickoff/, 'trend is titled');
  assert.ok(node.hasClassDeep('win-prob-baseline'), '50% baseline reference drawn');
  assert.ok(node.hasClassDeep('win-prob-goal-mark'), 'goal marker drawn at the jump');
  assert.ok(node.hasClassDeep('win-prob-spark'), 'the trajectory sparkline is drawn');
});
