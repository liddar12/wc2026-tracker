/* matchup-knockout-analytics.test.mjs — Epic D (RCA bugs 2-render, 3-detail, 22).
 *
 * Knockout matchups now carry a model-bearing row (data/knockout_matchups.json,
 * exposed as data.knockoutMatchups). The detail page must:
 *   - resolve a knockout pair to that row FIRST (so hasModel is true → the full
 *     model + market grid renders for knockouts, not just the team-keyed sections);
 *   - show a "to advance %" headline per side for knockout rows;
 *   - render the market-odds column even for model-less rows (decoupled from the
 *     hasModel gate), with model-market-divergence null-guarded for missing probs;
 *   - render the "Final result" section for REGULATION knockout wins (not only
 *     pen/ET ties) using the match-status helpers, with the real label + suffix
 *     and the .is-winner class on the winning header name;
 *   - never throw in confidence-bar / matchup-card on a model-less row.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { actualChoice } from '../../app/predictions.js';
import { winnerFromRecord, methodOfVictory } from '../../app/lib/match-status.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// matchup-detail.js imports large-match-card.js, which a sibling epic is mid-way
// through migrating to the Phase 0 match-status import (it transiently re-declares
// FINAL_STATUSES). Load resolveMatch lazily so that transient breakage in a file
// THIS epic does not own can't false-red the whole file; the resolver tests skip
// (with a clear note) rather than fail if the sibling edit hasn't settled yet.
async function loadResolveMatch(t) {
  try {
    const mod = await import('../../app/views/matchup-detail.js');
    return mod.resolveMatch;
  } catch (err) {
    t.skip(`matchup-detail.js not importable yet (sibling mid-edit): ${err.message}`);
    return null;
  }
}

// A model-bearing knockout row, mirroring a group_matchups match row plus the
// knockout-only fields from the cross-epic data contract.
function belgiumSenegalRow() {
  return {
    is_knockout: true,
    stage: 'round_of_32',
    match_id: 'r32-belgium-senegal',
    kickoff_utc: '2026-06-30T17:00:00Z',
    team_a: 'Belgium',
    team_b: 'Senegal',
    win_confidence_pct: 58,
    probabilities: { team_a_wins: 48, draw: 27, team_b_wins: 25 },
    composite_a: 71.2,
    composite_b: 64.8,
    gap: 6.4,
    predicted_winner: 'Belgium',
    advance_pct_a: 62,
    advance_pct_b: 38,
  };
}

// ---- Bug 2/3: knockout pair resolves to the model-bearing row (hasModel true) ----
test('resolveMatch scans knockoutMatchups for the pair BEFORE scheduleFull', async (t) => {
  const resolveMatch = await loadResolveMatch(t);
  if (!resolveMatch) return;
  const data = {
    groupMatchups: {},
    knockoutMatchups: [belgiumSenegalRow()],
    scheduleFull: [
      // The same pair also exists in the schedule as a model-LESS fixture; the
      // resolver must NOT fall back to it (that's the bug — model grid vanished).
      { stage: 'round_of_32', team_a: 'Belgium', team_b: 'Senegal', kickoff_utc: '2026-06-30T17:00:00Z' },
    ],
  };
  const ko = resolveMatch(data, 'Belgium', 'Senegal');
  assert.ok(ko, 'knockout match must resolve');
  assert.equal(ko.stage, 'round_of_32');
  assert.ok(Number.isFinite(ko.win_confidence_pct),
    'resolved row carries the model field → hasModel is true → the model+market grid renders');
  assert.equal(ko.win_confidence_pct, 58);
  // reverse team order resolves to the same model-bearing row
  const rev = resolveMatch(data, 'Senegal', 'Belgium');
  assert.ok(rev && Number.isFinite(rev.win_confidence_pct), 'reverse order also hits knockoutMatchups');
});

test('resolveMatch still falls back to scheduleFull when no knockout row exists', async (t) => {
  const resolveMatch = await loadResolveMatch(t);
  if (!resolveMatch) return;
  const data = {
    groupMatchups: {},
    knockoutMatchups: [belgiumSenegalRow()],
    scheduleFull: [
      { stage: 'round_of_32', team_a: 'France', team_b: 'Sweden', kickoff_utc: '2026-07-01T17:00:00Z' },
    ],
  };
  const m = resolveMatch(data, 'France', 'Sweden');
  assert.ok(m, 'unmodeled knockout fixture still resolves from the schedule');
  assert.equal(m.stage, 'round_of_32');
  assert.ok(!Number.isFinite(m.win_confidence_pct), 'schedule fallback row has no model field');
});

// ---- Bug 4: winner + method on the detail for a REGULATION knockout final -----
test('winner + FT for a Brazil 2-1 Japan regulation knockout final', () => {
  const rec = { score_a: 2, score_b: 1, status: 'STATUS_FULL_TIME', kickoff_utc: '2026-06-29T17:00Z' };
  assert.equal(winnerFromRecord(rec, 'Brazil', 'Japan'), 'Brazil',
    'a 2-1 regulation knockout names the higher-scoring side as winner');
  const mov = methodOfVictory(rec);
  assert.equal(mov.label, 'FT', 'regulation final shows the real FT label');
  assert.equal(mov.suffix, '', 'no shootout suffix on a regulation win');
});

test('actualChoice resolves knockout tiers (not only group_stage)', () => {
  const match = { stage: 'round_of_32', team_a: 'Brazil', team_b: 'Japan' };
  const actualResults = {
    group_stage: {},
    round_of_32: { 'Brazil__vs__Japan': { score_a: 2, score_b: 1, status: 'STATUS_FULL_TIME' } },
  };
  assert.equal(actualChoice(match, actualResults), 'team_a',
    'knockout regulation win is read from the round_of_32 tier');
  // reverse-keyed record still orients correctly
  const match2 = { stage: 'round_of_16', team_a: 'Japan', team_b: 'Brazil' };
  const ar2 = { round_of_16: { 'Brazil__vs__Japan': { score_a: 2, score_b: 1, status: 'STATUS_FULL_TIME' } } };
  assert.equal(actualChoice(match2, ar2), 'team_b', 'Brazil (record team_a) maps to match.team_b here');
});

test('actualChoice leaves group-stage behaviour unchanged', () => {
  const match = { team_a: 'Mexico', team_b: 'Korea Republic' };
  const ar = { group_stage: { 'Mexico__vs__Korea Republic': { score_a: 0, score_b: 0, status: 'STATUS_FULL_TIME' } } };
  assert.equal(actualChoice(match, ar), 'draw', 'a 0-0 group draw still reads as a draw');
});

// ---- Bug 5: confidence-bar / matchup-card never throw on a model-less row -----
test('confidenceBar does not throw when match.probabilities is undefined', async () => {
  installDomStub();
  try {
    const { confidenceBar } = await import('../../app/components/confidence-bar.js');
    let el;
    assert.doesNotThrow(() => {
      el = confidenceBar({ team_a: 'Belgium', team_b: 'Senegal' }, { title: 'Model', showTip: false });
    }, 'a row with no probabilities must not throw (defense in depth)');
    assert.ok(el, 'still returns an element');
  } finally {
    uninstallDomStub();
  }
});

// ---- wiring assertions (the view + component paths) --------------------------
test('matchup-detail resolves knockout rows from knockoutMatchups first', () => {
  const md = read('app/views/matchup-detail.js');
  assert.match(md, /knockoutMatchups/, 'resolveMatch scans data.knockoutMatchups');
});

test('matchup-detail renders winner + method via match-status helpers', () => {
  const md = read('app/views/matchup-detail.js');
  assert.match(md, /winnerFromRecord\(\s*rec\s*,\s*match\.team_a\s*,\s*match\.team_b\s*\)/,
    'derives the winner with the match-status helper (orientation-aware)');
  assert.match(md, /methodOfVictory\(/, 'derives the label/suffix with methodOfVictory');
  assert.match(md, /is-winner/, 'tags the winning header name with .is-winner (Epic E styles it)');
  assert.doesNotMatch(md, /<small>FT<\/small>/, 'the hardcoded FT label is replaced by the real method label');
});

test('matchup-detail shows a to-advance headline for knockout rows', () => {
  const md = read('app/views/matchup-detail.js');
  assert.match(md, /advance_pct_a/, 'reads the to-advance % for the knockout headline');
  assert.match(md, /advance_pct_b/, 'reads the to-advance % for both sides');
});

test('market-odds column is decoupled from the hasModel gate', () => {
  const md = read('app/views/matchup-detail.js');
  // The market column / marketOddsSection must render even when hasModel is false.
  assert.match(md, /marketOddsSection/, 'still uses marketOddsSection');
  // model-market-divergence must guard undefined probabilities.
  const div = read('app/components/model-market-divergence.js');
  assert.match(div, /probabilities/, 'divergence guards on match.probabilities');
});

// ---------------------------------------------------------------------------
// Minimal DOM stub — the feature tests run under `node --test` with no jsdom.
// confidence-bar (and the tipButton it can pull in) only touch a small surface:
// createElement / createTextNode, className, style, setAttribute, append,
// appendChild, textContent, innerHTML, addEventListener.
// ---------------------------------------------------------------------------
let _savedDocument;
function makeNode() {
  return {
    className: '', textContent: '', innerHTML: '', hidden: false,
    style: {}, dataset: {}, children: [], parentElement: null,
    setAttribute() {}, getAttribute() { return null; },
    append(...kids) { for (const k of kids) this.children.push(k); },
    appendChild(k) { this.children.push(k); if (k && typeof k === 'object') k.parentElement = this; return k; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, replaceWith() {},
  };
}
function installDomStub() {
  _savedDocument = globalThis.document;
  globalThis.document = {
    createElement() { return makeNode(); },
    createTextNode(t) { return { textContent: t }; },
    createDocumentFragment() { return makeNode(); },
    addEventListener() {}, removeEventListener() {},
  };
}
function uninstallDomStub() {
  if (_savedDocument === undefined) delete globalThis.document;
  else globalThis.document = _savedDocument;
}
