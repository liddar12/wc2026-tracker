import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// R20 RCA guards — each asserts the FIXED behavior, so they fail on the current
// (buggy) code and pass once the root cause is fixed. Map 1:1 to RC1–RC4 in
// docs/AUTH-TEST-PLAN.md.
const read = (p) => readFileSync(p, 'utf8');

test('RC1: onAuthStateChange repaints (dispatches competition:state-change)', () => {
  const comp = read('app/competition.js');
  const m = comp.match(/onAuthStateChange\([\s\S]*?\}\);/);
  assert.ok(m, 'onAuthStateChange callback found');
  assert.match(m[0], /competition:state-change/,
    'the auth-state callback must dispatch competition:state-change so async session restore / token refresh / cross-tab repaints the header + views');
});

test('RC2: header label prefers profile.username (not just email local-part)', () => {
  const toolbar = read('app/toolbar-auth.js');
  assert.match(toolbar, /profile\??\.username/,
    'syncLabel should use the profile username, falling back to email');
});

test('RC3: Pools "Sign in" opens the auth modal (not setRoute(picks))', () => {
  const pools = read('app/views/pools-view.js');
  assert.match(pools, /pools-signin[\s\S]{0,180}openAuth/,
    'Pools sign-in must openAuth() like every other sign-in entry point');
});

test('RC4: Home "Continue Anonymously" prompts for a handle', () => {
  const home = read('app/views/home-view.js');
  assert.match(home, /data-go-guest[\s\S]{0,200}(startGuest|promptHandle)/,
    'Home guest path should prompt for a display name, consistent with the modal');
});
