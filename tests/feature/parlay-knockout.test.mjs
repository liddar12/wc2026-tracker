/* parlay-knockout.test.mjs — Epic C. Parlay of the Day must work in the
   KNOCKOUT stage. The model W/D/L used to scan only data.groupMatchups, which
   is empty once the tournament leaves groups → no Moneyline legs → no parlay.
   modelWDL() must ALSO read data.knockoutMatchups (the flat ARRAY cross-epic
   contract), and xgFor() must resolve the knockout pair keys in data.xg, so
   today's knockout matches yield >=3 legs and parlayOfTheDay renders. When
   today HAS real-team games but nothing is priced yet, renderParlayOfDay must
   surface an empty-state node (not a blank fragment). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parlayOfTheDay, dailyLegs, renderParlayOfDay } from '../../app/components/parlay.js';

// Minimal DOM shim — node:test has no `document`, and the repo carries no DOM
// library (DOM rendering is otherwise covered by Playwright). renderParlayOfDay
// only needs createElement / createDocumentFragment + the attribute & tree ops
// below, plus a querySelector that can resolve '[data-testid=empty-state]'.
class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.dataset = {}; this._text = ''; this._html = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'data-testid') this.dataset.testid = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  set className(v) { this.attrs.class = String(v); } get className() { return this.attrs.class || ''; }
  set textContent(v) { this._text = String(v ?? ''); this.children = []; } get textContent() { return this._text; }
  set innerHTML(v) { this._html = String(v ?? ''); } get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  matches(sel) {
    const m = sel.match(/^\[data-testid=([^\]]+)\]$/);
    if (m) return (this.attrs['data-testid'] || '') === m[1].replace(/^['"]|['"]$/g, '');
    return false;
  }
  querySelector(sel) {
    for (const c of this.children) {
      if (c.matches && c.matches(sel)) return c;
      const found = c.querySelector && c.querySelector(sel);
      if (found) return found;
    }
    return null;
  }
}
class Frag extends El { constructor() { super('#fragment'); } }
globalThis.document = {
  createElement: (t) => new El(t),
  createDocumentFragment: () => new Frag(),
};

// Three of TODAY's knockout matches, priced via the knockout cross-epic contract:
//   data.knockoutMatchups = ARRAY of match rows (probabilities, advance_pct_*)
//   data.xg               = "TeamA__vs__TeamB" keys (same shape as group keys)
function dataKnockoutToday() {
  const now = new Date().toISOString();
  return {
    scheduleFull: [
      { match_id: 'Argentina__vs__France', team_a: 'Argentina', team_b: 'France', kickoff_utc: now, stage: 'round_of_16' },
      { match_id: 'Spain__vs__Brazil', team_a: 'Spain', team_b: 'Brazil', kickoff_utc: now, stage: 'round_of_16' },
      { match_id: 'Portugal__vs__Croatia', team_a: 'Portugal', team_b: 'Croatia', kickoff_utc: now, stage: 'round_of_16' },
    ],
    // NO groupMatchups — we are in the knockout stage. This is the bug: the old
    // modelWDL() only scanned groupMatchups and so returned no Moneyline legs.
    knockoutMatchups: [
      { team_a: 'Argentina', team_b: 'France', is_knockout: true, stage: 'round_of_16', match_id: 'Argentina__vs__France',
        probabilities: { team_a_wins: 58, draw: 22, team_b_wins: 20 }, advance_pct_a: 62, advance_pct_b: 38 },
      { team_a: 'Spain', team_b: 'Brazil', is_knockout: true, stage: 'round_of_16', match_id: 'Spain__vs__Brazil',
        probabilities: { team_a_wins: 64, draw: 20, team_b_wins: 16 }, advance_pct_a: 67, advance_pct_b: 33 },
      { team_a: 'Portugal', team_b: 'Croatia', is_knockout: true, stage: 'round_of_16', match_id: 'Portugal__vs__Croatia',
        probabilities: { team_a_wins: 71, draw: 17, team_b_wins: 12 }, advance_pct_a: 74, advance_pct_b: 26 },
    ],
    xg: {
      a: { team_a: 'Argentina', team_b: 'France', team_a_xg: 1.7, team_b_xg: 1.1 },
      b: { team_a: 'Spain', team_b: 'Brazil', team_a_xg: 1.9, team_b_xg: 1.0 },
      c: { team_a: 'Portugal', team_b: 'Croatia', team_a_xg: 2.1, team_b_xg: 0.8 },
    },
  };
}

test('knockout: each priced knockout match yields >=3 legs (ML from knockoutMatchups + O/U + BTTS from xg)', () => {
  const legs = dailyLegs(dataKnockoutToday());
  const byMid = (mid) => legs.filter((l) => l.mid === mid);
  for (const mid of ['Argentina__vs__France', 'Spain__vs__Brazil', 'Portugal__vs__Croatia']) {
    const ml = byMid(mid).filter((l) => l.type === 'Moneyline');
    assert.equal(ml.length, 1, `${mid} has a Moneyline leg (from data.knockoutMatchups)`);
    assert.ok(byMid(mid).length >= 3, `${mid} yields >=3 legs (got ${byMid(mid).length})`);
  }
});

test('knockout: moneyline reads the knockoutMatchups probabilities (Argentina 58% → top ML pick)', () => {
  const ml = dailyLegs(dataKnockoutToday()).find((l) => l.type === 'Moneyline' && l.mid === 'Argentina__vs__France');
  assert.ok(ml, 'a moneyline leg exists for the knockout pair');
  assert.match(ml.selection, /Argentina to win/, `picks the favorite (got "${ml.selection}")`);
  assert.ok(Math.abs(ml.prob - 0.58) < 1e-9, `prob from knockoutMatchups (got ${ml.prob})`);
});

test('knockout: parlayOfTheDay returns three 3-leg parlays', () => {
  const r = parlayOfTheDay(dataKnockoutToday());
  assert.ok(r, 'returns a result in the knockout stage');
  assert.equal(r.parlays.length, 3, 'Most likely / Safe / Best value');
  for (const p of r.parlays) assert.equal(p.legs.length, 3, `${p.name} has 3 legs`);
});

test('empty-state: games today but nothing priced → renderParlayOfDay returns an empty-state node', () => {
  // Today HAS real-team knockout games, but no knockoutMatchups / xg → no legs.
  const data = {
    scheduleFull: [
      { match_id: 'Argentina__vs__France', team_a: 'Argentina', team_b: 'France', kickoff_utc: new Date().toISOString(), stage: 'round_of_16' },
    ],
  };
  assert.equal(parlayOfTheDay(data), null, 'no priced data → no parlay');
  const node = renderParlayOfDay(data);
  assert.ok(node, 'returns a node');
  assert.ok(node.querySelector('[data-testid=empty-state]'), 'surfaces an empty-state instead of a blank fragment');
});

test('no games today → renderParlayOfDay still returns an empty fragment (no empty-state)', () => {
  const node = renderParlayOfDay({ scheduleFull: [] });
  assert.ok(node, 'returns a node');
  assert.equal(node.querySelector?.('[data-testid=empty-state]') || null, null, 'no empty-state when there are no games at all');
});

// ---- schedule-view: resolved knockout fixtures are clickable (RCA bug 21) ----
// The active card path links via largeMatchCard's onTap, gated on isSlotPlaceholder
// for BOTH teams (so a resolved tie like Argentina v France links regardless of
// stage). The card helper's href gate must use the same placeholder test, not the
// old `stage === 'group'` gate that left every knockout tie un-clickable.
test('schedule-view: links any fixture with real teams, regardless of stage', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../app/views/schedule-view.js', import.meta.url), 'utf8');
  // The onTap handler gates the matchup link on isSlotPlaceholder for both teams.
  assert.match(src, /onTap:[\s\S]*?!isSlotPlaceholder\(match\.team_a\)[\s\S]*?!isSlotPlaceholder\(match\.team_b\)[\s\S]*?#\/matchup\/team_a/,
    'onTap links resolved fixtures to the matchup route');
  // The card-href gate no longer hard-codes the group stage.
  assert.ok(!/stage === 'group' && match\.team_a/.test(src), 'no stage==="group" gate left on the card href');
  assert.match(src, /!isSlotPlaceholder\(match\.team_a\) && !isSlotPlaceholder\(match\.team_b\)/,
    'card href gated on isSlotPlaceholder, not stage');
});

test('schedule-view: isSlotPlaceholder flags real knockout slots but passes resolved names', async () => {
  // Mirror the in-file predicate to assert its behavior against real schedule slots.
  const isSlotPlaceholder = (s) => { if (typeof s !== 'string') return true; return /^\d[A-L]$|^3 [A-L]+$|^W\d+$|^L\d+$/.test(s); };
  for (const p of ['W74', 'W101', 'L102', '3 ABC', '1A']) assert.equal(isSlotPlaceholder(p), true, `${p} is a slot`);
  for (const r of ['Argentina', 'France', "Cote d'Ivoire", 'Bosnia and Herzegovina', 'DR Congo']) {
    assert.equal(isSlotPlaceholder(r), false, `${r} is a real team`);
  }
});
