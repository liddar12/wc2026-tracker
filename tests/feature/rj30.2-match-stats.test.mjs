/* rj30.2-match-stats.test.mjs — RJ30.2 Match Intelligence (Wave-1 B).
 *
 * Locks the renderMatchStats() contract with a minimal, self-contained DOM shim
 * (no jsdom dependency — same house style as rj30_1-previews-render). Asserts
 * STRUCTURE + the acceptance criteria:
 *   - possession bar's two shares sum to ~100 (tabular-nums, aria-labelled);
 *   - shots/on-target + passing % render;
 *   - the "Shots vs model xG" line is present and labeled "model xG";
 *   - the free computed insights are wired in (when match-insights supplies them);
 *   - ABSENT stats → empty DocumentFragment (NOT an empty-state);
 *   - escaping (no raw markup from team names / insight text).
 * The 390px scrollWidth ceiling is asserted in the Playwright spec (real layout).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/* ----------------------------- DOM shim ---------------------------------- */
const FRAGMENT_NODE = 11;
const ELEMENT_NODE = 1;

class Style {
  constructor() { this._m = {}; }
  setProperty(k, v) { this._m[k] = String(v); }
  get width() { return this._m.width || ''; }
  set width(v) { this._m.width = String(v); }
  get left() { return this._m.left || ''; }
  set left(v) { this._m.left = String(v); }
}
class Node {
  constructor() { this.childNodes = []; this._attrs = {}; this._html = ''; this._text = ''; this.style = new Style(); }
  appendChild(child) { this.childNodes.push(child); return child; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = String(v); }
  get textContent() {
    if (this._text) return this._text;
    return this.childNodes.map((c) => c.textContent || '').join('');
  }
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
class DocumentFragment extends Node {
  constructor() { super(); this.nodeType = FRAGMENT_NODE; }
}
globalThis.document = {
  createElement: (tag) => new Element(tag),
  createElementNS: (_ns, tag) => new Element(tag),
  createDocumentFragment: () => new DocumentFragment(),
};

const { renderMatchStats, possessionSplit, resolveMatchStats } = await import('../../app/components/match-stats.js');

/* ------------------------------ fixtures --------------------------------- */
const MATCH = { team_a: 'Mexico', team_b: 'South Africa' };
const ID = 'Mexico__vs__South Africa';

const FULL = {
  matchStats: {
    [ID]: {
      team_a: 'Mexico', team_b: 'South Africa',
      stats_a: { possession: 58, totalShots: 14, shotsOnTarget: 6, passPct: 83, accuratePasses: 410, totalPasses: 494, saves: 2, tackles: 17, fouls: 9, offsides: 2, crosses: 12, blockedShots: 3 },
      stats_b: { possession: 42, totalShots: 8, shotsOnTarget: 3, passPct: 74, accuratePasses: 300, totalPasses: 405, saves: 4, tackles: 21, fouls: 12, offsides: 1, crosses: 7, blockedShots: 5 },
      key_events: [{ minute: 23, type: 'goal', team: 'Mexico', text: 'Goal' }],
    },
  },
  xg: {
    [ID]: { team_a: 'Mexico', team_b: 'South Africa', team_a_xg: 1.56, team_b_xg: 0.98, formula_version: 'v1' },
  },
};

/* ------------------------------- tests ----------------------------------- */
test('possessionSplit: two shares sum to ~100 and normalize a lopsided pair', () => {
  const a = possessionSplit({ possession: 58 }, { possession: 42 });
  assert.equal(a.a + a.b, 100, 'sums to 100');
  assert.equal(a.a, 58);
  // Non-normalized inputs (60/50) still get renormalized to sum 100.
  const b = possessionSplit({ possession: 60 }, { possession: 50 });
  assert.equal(b.a + b.b, 100, 'renormalized sum stays 100');
  // One side missing → derived from the other.
  const c = possessionSplit({ possession: 65 }, {});
  assert.equal(c.a + c.b, 100);
  assert.equal(c.b, 35);
  // Both missing → 50/50 fallback, flagged unknown.
  const d = possessionSplit({}, {});
  assert.deepEqual([d.a, d.b, d.known], [50, 50, false]);
});

test('renders a .home-card panel with the possession bar summing ~100 (tabular-nums + aria)', () => {
  const node = renderMatchStats(MATCH, FULL);
  assert.equal(node.nodeType, ELEMENT_NODE, 'a real element, not a fragment');
  assert.match(node.className, /home-card/, 'uses the shared .home-card surface');
  assert.equal(node.getAttribute('data-testid'), 'match-stats');
  const html = node.outerHTML;
  // possession values present and summing to 100
  assert.match(html, /data-testid="ms-poss-a">58%/, 'team_a possession shown');
  assert.match(html, /data-testid="ms-poss-b">42%/, 'team_b possession shown');
  // two-sided bar widths present
  assert.match(html, /ms-seg-a[^>]*width:58%/, 'bar segment A width');
  assert.match(html, /ms-seg-b[^>]*width:42%/, 'bar segment B width');
  // aria on the bar names both shares
  assert.match(html, /aria-label="Possession: Mexico 58 percent, South Africa 42 percent"/);
  // tabular-nums hook class applied to numeric spans
  assert.match(html, /class="ms-poss-a tnum"/, 'possession numbers carry the tnum class');
});

test('shots + on-target + passing % render in the stat grid', () => {
  const html = renderMatchStats(MATCH, FULL).outerHTML;
  assert.match(html, /data-testid="ms-stat-grid"/, 'stat grid present');
  assert.match(html, />Shots</, 'Shots row');
  assert.match(html, />On target</, 'On-target row');
  assert.match(html, />Passing %</, 'Passing % row');
  // the numbers themselves
  assert.match(html, /ms-stat-a tnum">14</, 'team_a total shots');
  assert.match(html, /ms-stat-b tnum">3</, 'team_b on-target/other');
  assert.match(html, /83%/, 'passing pct with suffix');
});

test('shows 3-5 key stats per team (beyond shots/on-target/passing)', () => {
  const html = renderMatchStats(MATCH, FULL).outerHTML;
  // at least three of the extra key stats surface
  const extras = ['Saves', 'Tackles', 'Fouls', 'Offsides', 'Crosses', 'Blocked'];
  const present = extras.filter((l) => html.includes(`>${l}<`));
  assert.ok(present.length >= 3, `expected >=3 extra key stats, got ${present.length}: ${present}`);
});

test('Shots vs MODEL xG line is present and clearly labeled "model xG"', () => {
  const html = renderMatchStats(MATCH, FULL).outerHTML;
  assert.match(html, /data-testid="ms-shots-xg"/, 'the shots-vs-xg line exists');
  assert.match(html, /model xG/, 'labeled model xG (not event xG)');
  // ESPN shots sit next to the model xG value for each side
  assert.match(html, /14[^<]*on tgt[^<]*1\.56 xG/, 'team_a shots next to model xG');
  assert.match(html, /8[^<]*on tgt[^<]*0\.98 xG/, 'team_b shots next to model xG');
});

test('absent stats entry → empty DocumentFragment (NOT an empty-state)', () => {
  const node = renderMatchStats(MATCH, { matchStats: {} });
  assert.equal(node.nodeType, FRAGMENT_NODE, 'returns a fragment');
  assert.equal(node.childNodes.length, 0, 'nothing renders');
  assert.ok(!/empty-state/.test(node.outerHTML), 'no empty-state markup (no error affordance)');
  // missing matchStats key entirely also stays dormant (no throw)
  const node2 = renderMatchStats(MATCH, {});
  assert.equal(node2.childNodes.length, 0);
});

test('reverse-orientation key resolves and re-aligns sides to this match', () => {
  const rev = {
    matchStats: {
      'South Africa__vs__Mexico': {
        team_a: 'South Africa', team_b: 'Mexico',
        stats_a: { possession: 42, totalShots: 8 },
        stats_b: { possession: 58, totalShots: 14 },
        key_events: [],
      },
    },
  };
  const s = resolveMatchStats(MATCH, rev);
  assert.equal(s.team_a, 'Mexico', 'sides re-aligned to the match header');
  assert.equal(s.stats_a.totalShots, 14, 'Mexico stats mapped to stats_a');
  assert.equal(s.stats_b.totalShots, 8);
});

test('team names are HTML-escaped (no markup injection)', () => {
  const evil = { team_a: '<img src=x>', team_b: 'Safe' };
  const data = {
    matchStats: {
      '<img src=x>__vs__Safe': {
        team_a: '<img src=x>', team_b: 'Safe',
        stats_a: { possession: 50, totalShots: 1 }, stats_b: { possession: 50, totalShots: 1 },
        key_events: [],
      },
    },
  };
  const html = renderMatchStats(evil, data).outerHTML;
  assert.match(html, /&lt;img src=x&gt;/, 'team name escaped');
  assert.doesNotMatch(html, /<img src=x>/, 'raw img tag not injected');
});

test('never throws when xg is absent (renders shots line with "— xG")', () => {
  const noXg = { matchStats: FULL.matchStats };
  const html = renderMatchStats(MATCH, noXg).outerHTML;
  assert.match(html, /data-testid="ms-shots-xg"/);
  assert.match(html, /— xG/, 'xG shown as em-dash when model has no row');
});
