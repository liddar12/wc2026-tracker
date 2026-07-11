/* r18b-momentum-persistence.test.mjs — R18.1: the live Match Momentum sampler
 * must SURVIVE the ~30s `data:live-refresh` view re-renders.
 *
 * Locks the exact defect from the July 10 QFs: momentumSection() used to bind
 * the sampler to its card (tick() stopped when the card left the DOM) and keep
 * the tracker in a per-render closure — every refresh killed the sampler and
 * wiped the per-minute extremes, so the panel never accumulated more than a
 * couple of bars. The sampler is now a per-match module-level singleton:
 *   - one sampler per team pair, reused across renders
 *   - the ESPN event id is resolved ONCE per match, not once per render
 *   - a re-render repaints the FULL accumulated series into the new card
 *   - a FINAL match keeps its series (chart stays up after full time)
 *   - a failed event-id resolution retires the entry so the next render retries
 * DOM-free via the same minimal shim style as rj30-winprob-render.test.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- minimal DOM shim ------------------------------------------------------
const ELEMENT_NODE = 1;
class Element {
  constructor(tag) {
    this.tagName = tag; this.nodeType = ELEMENT_NODE;
    this.childNodes = []; this._attrs = {}; this._html = '';
    this.className = ''; this.style = {}; this._text = ''; this.title = '';
  }
  appendChild(c) { this.childNodes.push(c); return c; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  // Real innerHTML assignment clears children — the shim must too, or repeated
  // paints would double-count bars.
  set innerHTML(v) { this._html = String(v); this.childNodes = []; }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = String(v); }
  get textContent() {
    const own = this._text || this._html.replace(/<[^>]+>/g, '');
    return own + this.childNodes.map((c) => c.textContent || '').join('');
  }
  findByClass(cls) {
    if (String(this.className || '').split(/\s+/).includes(cls)) return this;
    for (const c of this.childNodes) {
      const hit = c.findByClass && c.findByClass(cls);
      if (hit) return hit;
    }
    return null;
  }
  countClass(cls) {
    let n = String(this.className || '').split(/\s+/).includes(cls) ? 1 : 0;
    for (const c of this.childNodes) if (c.countClass) n += c.countClass(cls);
    return n;
  }
}
globalThis.document = {
  createElement: (tag) => new Element(tag),
  createElementNS: (_ns, tag) => new Element(tag),
  body: { contains: () => true },   // hosts are "attached" unless a test says otherwise
};
globalThis.window = { matchMedia: () => ({ matches: false }) };

// ---- fetch stub: scoreboard (event resolution) + evolving summaries ---------
let scoreboardCalls = 0;
let summaryCalls = 0;
let scoreboardEvents = [];   // events returned by ?dates= queries
let summaryPayload = null;   // current ESPN summary

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/scoreboard')) {
    scoreboardCalls += 1;
    return { ok: true, json: async () => ({ events: scoreboardEvents }) };
  }
  if (u.includes('/summary')) {
    summaryCalls += 1;
    return { ok: true, json: async () => summaryPayload };
  }
  return { ok: false, json: async () => null };
};

function espnSummary({ statsA, statsB, clock = "63'", status = 'STATUS_IN_PROGRESS', scoreA = 0, scoreB = 0 }) {
  const teamBlock = (name, stats) => ({
    team: { displayName: name },
    statistics: Object.entries(stats).map(([n, v]) => ({ name: n, displayValue: String(v) })),
  });
  return {
    boxscore: { teams: [teamBlock('France', statsA), teamBlock('Morocco', statsB)] },
    header: { competitions: [{
      status: { type: { name: status }, displayClock: clock },
      competitors: [
        { team: { displayName: 'France' }, score: String(scoreA) },
        { team: { displayName: 'Morocco' }, score: String(scoreB) },
      ],
    }] },
  };
}

const liveEvent = {
  id: '731999',
  competitions: [{ competitors: [
    { team: { displayName: 'France' } }, { team: { displayName: 'Morocco' } },
  ] }],
};

const { momentumSection, _samplers } = await import('../../app/live-momentum.js');

const MATCH = { team_a: 'France', team_b: 'Morocco', stage: 'semifinal' };
const DATA = { scheduleFull: [{
  team_a: 'France', team_b: 'Morocco',
  kickoff_utc: new Date(Date.now() - 60 * 60 * 1000).toISOString(),  // kicked off 1h ago
}] };
const KEY = 'France__vs__Morocco';

function stopAll() {
  for (const s of _samplers().values()) s.stop && s.stop();
  _samplers().clear();
}

test('sampler is a singleton: re-render reuses it, keeps the series, resolves the event id once', async () => {
  stopAll();
  scoreboardCalls = 0; summaryCalls = 0;
  scoreboardEvents = [liveEvent];
  summaryPayload = espnSummary({
    statsA: { totalShots: 5, shotsOnTarget: 3, possessionPct: 60, redCards: 0 },
    statsB: { totalShots: 1, shotsOnTarget: 0, possessionPct: 40, redCards: 0 },
  });

  const card1 = momentumSection(MATCH, DATA);
  assert.equal(card1.getAttribute('data-testid'), 'momentum-live');
  const s = _samplers().get(KEY);
  assert.ok(s, 'sampler registered under the pair key');
  await s.ready;                                   // event resolved + first tick done
  assert.ok(s.tracker.series().length >= 1, 'first sample recorded');
  const boardCallsAfterFirst = scoreboardCalls;

  // ---- the 30s data:live-refresh re-render: a brand-new card, same sampler ----
  const card2 = momentumSection(MATCH, DATA);
  const s2 = _samplers().get(KEY);
  assert.equal(s2, s, 'the SAME sampler survives the re-render (the July 10 defect)');
  assert.equal(_samplers().size, 1, 'no second sampler spawned');
  assert.equal(scoreboardCalls, boardCallsAfterFirst, 'event id NOT re-resolved per render');

  // the new card is painted immediately from the accumulated series
  const host2 = card2.findByClass('mm-live-host');
  assert.ok(host2.findByClass('mm-live-bars'), 're-rendered card shows bars instantly');
  assert.ok(!host2.findByClass('mm-live-wait'), 'no "Sampling…" reset after a re-render');
  assert.equal(s.host, host2, 'sampler paints into the newest host');

  // legend identifies the sides (markup lives in the card's innerHTML)
  assert.match(card2.innerHTML, /mm-legend is-a/, 'team A legend present');
  assert.match(card2.innerHTML, /mm-legend is-b/, 'team B legend present');
  stopAll();
});

test('FINAL stops the sampler but keeps the series for post-match renders', async () => {
  stopAll();
  scoreboardEvents = [liveEvent];
  summaryPayload = espnSummary({
    statsA: { totalShots: 12, shotsOnTarget: 6, possessionPct: 55, redCards: 0 },
    statsB: { totalShots: 4, shotsOnTarget: 2, possessionPct: 45, redCards: 0 },
    clock: "90'", status: 'STATUS_FULL_TIME', scoreA: 2, scoreB: 0,
  });

  momentumSection(MATCH, DATA);
  const s = _samplers().get(KEY);
  await s.ready;
  assert.equal(s.stopped, true, 'FINAL stops the ticking');
  assert.equal(s.timer, null, 'no interval left running');
  assert.ok(_samplers().has(KEY), 'finished sampler entry is KEPT');

  const cardAfter = momentumSection(MATCH, DATA);
  assert.equal(_samplers().get(KEY), s, 'post-FT render reuses the finished sampler');
  const host = cardAfter.findByClass('mm-live-host');
  assert.ok(host.findByClass('mm-live-bars'), 'series still painted after full time');
  stopAll();
});

test('event-id resolution failure retires the entry so the next render retries', async () => {
  stopAll();
  scoreboardEvents = [];   // match not on the scoreboard yet
  momentumSection(MATCH, DATA);
  const s = _samplers().get(KEY);
  await s.ready;
  assert.equal(_samplers().has(KEY), false, 'failed resolution removed from the registry');

  // next re-render tries again — and this time the event exists
  scoreboardEvents = [liveEvent];
  summaryPayload = espnSummary({
    statsA: { totalShots: 2, shotsOnTarget: 1, possessionPct: 50, redCards: 0 },
    statsB: { totalShots: 2, shotsOnTarget: 1, possessionPct: 50, redCards: 0 },
  });
  momentumSection(MATCH, DATA);
  const s2 = _samplers().get(KEY);
  assert.ok(s2 && s2 !== s, 'a fresh sampler is created on retry');
  await s2.ready;
  assert.ok(s2.tracker.series().length >= 1, 'retry samples normally');
  stopAll();
});

test('no-signal minutes render as neutral zero-ticks, not colored blips', async () => {
  const { drawExtremes } = await import('../../app/live-momentum.js');
  const host = new Element('div');
  drawExtremes(host, [
    { minute: 10, value: 0 },      // first-sample minute: no delta yet
    { minute: 11, value: 0.6 },    // France burst
    { minute: 12, value: -0.4 },   // Morocco push
  ], 'France', 'Morocco');
  assert.equal(host.countClass('is-zero'), 1, 'exactly the flat minute is a zero-tick');
  assert.equal(host.countClass('is-a'), 2, 'zero-tick keeps side class for layout');
  assert.equal(host.countClass('is-b'), 1);
  const bars = host.findByClass('mm-live-bars');
  assert.ok(bars, 'bars row rendered');
});
