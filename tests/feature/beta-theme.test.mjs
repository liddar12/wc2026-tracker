import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Beta Soccer theme guards — assert the theme is wired end-to-end so a
// regression that drops any touch-point fails here. Map 1:1 to the 4 wiring
// touch-points in docs/BETA-THEME-PLAN.md.
const read = (p) => readFileSync(p, 'utf8');

test('Settings picker offers a Beta option labelled "Beta"', () => {
  const s = read('app/views/settings-view.js');
  assert.match(s, /\['auto',\s*'light',\s*'dark',\s*'beta'\]/, 'picker array includes beta');
  assert.match(s, /===\s*'beta'\s*\?\s*'Beta'|:\s*'Beta'/, 'beta label resolves to "Beta"');
});

test('applyTheme + theme.js handle the beta preference', () => {
  const s = read('app/views/settings-view.js');
  assert.match(s, /theme\s*===\s*'beta'[\s\S]{0,80}setAttribute\(\s*'data-theme'\s*,\s*'beta'\s*\)/,
    'applyTheme sets data-theme=beta');
  const t = read('app/theme.js');
  assert.match(t, /pref\s*===\s*'beta'/, 'theme.js effective() passes beta through (not resolved to light/dark)');
});

test('styles.css defines the Beta token block + The Goal menu', () => {
  const css = read('app/styles.css');
  assert.match(css, /\[data-redesign="v2"\]\[data-theme='beta'\]/,
    'beta token re-bind compounds with v2 to win specificity');
  assert.match(css, /:root\[data-theme='beta'\]/, 'beta palette/semantic tokens declared');
  assert.match(css, /\.goalmenu/, 'The Goal full-screen menu CSS present');
  assert.match(css, /\.beta-goal-fab/, 'goal-FAB CSS present');
  // re-bind must point primary/accent at lime
  assert.match(css, /--primary:\s*var\(--lime\)/, 'primary re-bound to lime');
});

test('beta-nav wires the router + menu toggle + theme gate', () => {
  const js = read('app/beta-nav.js');
  assert.match(js, /import\s*\{[^}]*setRoute[^}]*\}\s*from\s*'\.\/state\.js'/, 'imports setRoute');
  assert.match(js, /setRoute\(/, 'navchips call setRoute');
  assert.match(js, /classList\.(add|remove|toggle)\(\s*'menu-open'/, "toggles body 'menu-open'");
  assert.match(js, /getAttribute\(\s*'data-theme'\s*\)\s*===\s*'beta'/, 'gated on data-theme=beta');
  assert.match(js, /MutationObserver/, 'reacts to theme attribute changes');
  // every nav route must be a real router view (spot-check the set)
  ['home', 'matches', 'play', 'bracket', 'my-picks', 'pools', 'my-brackets', 'golden-boot', 'schedule', 'leaderboard', 'venues', 'settings']
    .forEach((r) => assert.match(js, new RegExp(`route:\\s*'${r}'`), `nav has route ${r}`));
});

test('main.js boots beta-nav', () => {
  const m = read('app/main.js');
  assert.match(m, /import\s*\{\s*initBetaNav\s*\}\s*from\s*'\.\/beta-nav\.js'/, 'imports initBetaNav');
  assert.match(m, /initBetaNav\(\)/, 'calls initBetaNav() at boot');
});
