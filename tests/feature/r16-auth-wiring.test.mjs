import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// R16 Phase 1: guard the auth-modal wiring so the four root-caused bugs can't
// silently regress. These are source-level invariants (the UI behavior itself
// is covered by tests/ux/r16-auth-modal.spec.mjs).

const read = (p) => readFileSync(p, 'utf8');

test('R16: auth-modal exports openAuth + closeAuth and reuses renderAuthPanel', () => {
  const src = read('app/auth-modal.js');
  assert.match(src, /export function openAuth/, 'openAuth must be exported');
  assert.match(src, /export function closeAuth/, 'closeAuth must be exported');
  assert.match(src, /renderAuthPanel/, 'modal should mount the existing renderAuthPanel');
  assert.match(src, /role="dialog"/, 'modal must be a dialog (lightbox)');
});

test('R16: main.js bridges competition:state-change → renderView (fixes logout repaint)', () => {
  const src = read('app/main.js');
  // the listener and the renderView call must co-occur in the handler
  assert.match(
    src,
    /competition:state-change'[\s\S]{0,160}renderView\(\)/,
    'main.js must re-render the view on competition:state-change'
  );
});

test('R16: Settings "Sign in" opens the modal, not setRoute(picks)', () => {
  const src = read('app/views/settings-view.js');
  assert.match(src, /openAuth\('signin'\)/, 'settings should open the auth modal on signin');
  assert.doesNotMatch(src, /setRoute\('picks'/, "settings must NOT route to 'picks' (the My Picks dead-end)");
});

test('R16: Home sign-in CTA opens the modal directly', () => {
  const src = read('app/views/home-view.js');
  assert.match(src, /data-go-signin/, 'home keeps the signin CTA hook');
  assert.match(src, /openAuth\('signin'\)/, 'home CTA must open the auth modal');
  assert.doesNotMatch(src, /auth-toolbar-btn'\)\??\.click\(\)/, 'home must not fake-click the toolbar button');
});

test('R16: My Picks invite CTA opens the modal directly', () => {
  const src = read('app/views/my-picks.js');
  assert.match(src, /openAuth\('entry'\)/, 'my-picks invite CTA must open the auth modal');
});

test('R16: toolbar-auth routes through the modal and drops the in-dropdown form', () => {
  const src = read('app/toolbar-auth.js');
  assert.match(src, /import \{ openAuth \} from '\.\/auth-modal\.js'/, 'toolbar must use the modal');
  assert.match(src, /openAuth\('entry'\)/, 'signed-out toolbar tap opens the modal');
  assert.doesNotMatch(src, /mountFullAuthPanel/, 'the old in-dropdown auth form must be gone');
});

test('R16: signOut callers rely on state-change repaint (no manual nav workaround needed)', () => {
  const settings = read('app/views/settings-view.js');
  // settings signout no longer needs setRoute('home') to force a repaint
  assert.doesNotMatch(settings, /signOut\(\);\s*setRoute\('home'/, 'signout should not hard-redirect to force a repaint');
});
