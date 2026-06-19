/* hidden-features.test.mjs — reversible nav hiding + Projected Bracket route.
   Owner hid Play/Bracket/Pools/My Brackets/My Picks (bring-back-able) and added
   Projected Bracket. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HIDDEN_ROUTES, isRouteHidden } from '../../app/lib/hidden-features.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('the five low-use routes are flagged hidden (with aliases), others are not', () => {
  for (const r of ['play', 'bracket', 'brackets', 'pools', 'my-brackets', 'my-picks', 'picks']) {
    assert.ok(isRouteHidden(r), `${r} hidden`);
  }
  for (const r of ['home', 'schedule', 'venues', 'matches', 'projected']) {
    assert.ok(!isRouteHidden(r), `${r} visible`);
  }
});

test('hiding is reversible by construction (flag-driven, routes not deleted)', () => {
  // tabs are hidden at runtime via the flag — the buttons still exist in the
  // shell so removing a route from HIDDEN_ROUTES restores them.
  const html = read('index.html');
  for (const r of ['play', 'bracket', 'pools', 'my-brackets', 'my-picks']) {
    assert.match(html, new RegExp(`data-route="${r}"`), `${r} tab still in shell (runtime-hidden)`);
  }
  const hf = read('app/lib/hidden-features.js');
  assert.match(hf, /tab\.hidden = isRouteHidden/, 'tabs toggle both ways (restore on un-flag)');
});

test('Projected Bracket is wired: tab, route, title, render', () => {
  assert.match(read('index.html'), /data-route="projected"[^>]*>Projected/, 'Projected nav tab');
  const m = read('app/main.js');
  assert.match(m, /case 'projected'/, 'route dispatched');
  assert.match(m, /renderProjectedBracketView/, 'view imported + called');
  assert.match(m, /applyHiddenFeatures\(document\)/, 'hiding applied each render');
});

test('Home Play CTA is gated on the flag', () => {
  const h = read('app/views/home-view.js');
  assert.match(h, /if \(isRouteHidden\('play'\)\) return document\.createDocumentFragment\(\)/, 'Play CTA dropped when hidden');
});

test('Projected view: all 5 models, default hybrid, R32→Final + 3rd, light detail', () => {
  const v = read('app/views/projected-bracket-view.js');
  assert.match(v, /MODELS/, 'iterates all models');
  assert.match(v, /getActiveModel|'hybrid'/, 'defaults to active/hybrid');
  assert.match(v, /buildAutofill/, 'uses the autofill projection engine');
  assert.match(v, /lo: 73, hi: 88/, 'starts at Round of 32');
  assert.match(v, /byNum\.get\(103\)/, '3rd-place game');
  assert.match(v, /byNum\.get\(104\)/, 'Final → champion + runner-up');
  assert.match(v, /MODEL_DESCRIPTIONS/, 'shows model name + one-line description');
});
