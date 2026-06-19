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
  assert.match(m, /renderProjectedShim/, 'shim renders the enhanced bracket');
  assert.match(m, /projected-bracket-tree\.js/, 'loads the Phase-1 enhanced component');
  assert.match(m, /routeName: 'projected'/, 'keeps controls on the /projected route');
  assert.match(m, /applyHiddenFeatures\(document\)/, 'hiding applied each render');
});

test('BR-6/BR-7: what-if overrides engine + tap-to-override + path highlight', () => {
  const af = read('app/bracket-autofill.js');
  assert.match(af, /opts\.overrides/, 'buildAutofill accepts what-if overrides');
  assert.match(af, /overrides\[matchNumber\]/, 'overrides keyed by matchNumber (actual results still win)');
  const v = read('app/components/projected-bracket-tree.js');
  assert.match(v, /OVERRIDES\[mn\] === team/, 'tap toggles a what-if winner');
  assert.match(v, /buildAutofill\(data, source, \{ overrides: OVERRIDES \}\)/, 'bracket re-cascades from overrides');
  assert.match(v, /data-overridden/, 'overridden node is marked (diff vs model)');
  assert.match(v, /eb-reset/, 'reset-to-model control');
  assert.match(v, /stage: 'r32', team: el\.dataset\.team/, 'GS team tap highlights its R32 path');
});

test('Home Play CTA is gated on the flag', () => {
  const h = read('app/views/home-view.js');
  assert.match(h, /if \(isRouteHidden\('play'\)\) return document\.createDocumentFragment\(\)/, 'Play CTA dropped when hidden');
});

test('Phase-1 enhanced Projected bracket: tree + stage nav + zoom + confidence', () => {
  const v = read('app/components/projected-bracket-tree.js');
  assert.match(v, /buildAutofill/, 'projects winners via the autofill engine');
  assert.match(v, /eb-stage-nav|eb-stages/, 'stage nav (GS/R32/.../F)');
  assert.match(v, /data-zoom="fit"/, 'zoom controls (−/＋/fit)');
  assert.match(v, /function confidence/, 'per-pick confidence from the model');
  assert.match(v, /renderModelPicker/, 'model selector present');
  assert.match(v, /computeGroupStandings/, 'GS view shows standings→seeding');
  assert.match(v, /lo: 73, hi: 88/, 'R32 round');
  assert.match(v, /byNum\.get\(103\)/, '3rd-place game');
  // legacy renderer kept route-aware as the fallback
  assert.match(read('app/views/bracket-view-r6.js'), /params\.routeName \|\| 'bracket'/, 'fallback stays route-aware');
});
