import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// R20 RCA guards — each asserts the FIXED behavior, so they fail on the current
// (buggy) code and pass once the root cause is fixed. Map 1:1 to RC1–RC4 in
// docs/AUTH-TEST-PLAN.md.
const read = (p) => readFileSync(p, 'utf8');

test('RC1: onAuthStateChange repaints AND is deadlock-safe (sync callback, deferred DB)', () => {
  const comp = read('app/competition.js');
  const m = comp.match(/onAuthStateChange\([\s\S]*?\n  \}\);/);
  assert.ok(m, 'onAuthStateChange callback found');
  const cb = m[0];
  // must repaint on auth events
  assert.match(cb, /competition:state-change/,
    'callback must dispatch competition:state-change (header/view repaint on restore/refresh/cross-tab)');
  // TRUE root cause guard: the callback must NOT be async (awaiting Supabase
  // calls inside it holds the GoTrue lock → deadlocks getSession on reload).
  assert.doesNotMatch(cb, /onAuthStateChange\(\s*async/,
    'callback must be SYNCHRONOUS — awaiting Supabase calls inside it deadlocks getSession');
  assert.doesNotMatch(cb, /\bawait\b/,
    'no await inside the auth callback (deadlock); defer DB work with setTimeout');
  assert.match(cb, /setTimeout\(/,
    'profile/groups load must be deferred out of the lock via setTimeout');
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
