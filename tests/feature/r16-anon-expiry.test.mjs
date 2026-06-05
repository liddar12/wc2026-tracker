import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expireAnonCache,
  clearAnonDrafts,
  markAnonSubmitted,
  ANON_SESSION_KEY,
  ANON_SUBMITTED_KEY,
  ANON_TTL_MS,
  ANON_DRAFT_KEYS,
} from '../../app/lib/version-purge.js';

function mkStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    has: (k) => m.has(k),
  };
}

const T0 = 1_750_000_000_000; // fixed base time
const draftSeed = () => ({
  'wc26.grouppicks.local': '{"A":["x"]}',
  'wc26.mybrackets.local': '{"picks":{}}',
  'wc26.picks': '{"m1":{}}',
  'wc26.prefs': 'keep-me',
});

test('R16 #C1: first anon visit stamps the session and clears nothing', () => {
  const s = mkStorage(draftSeed());
  const r = expireAnonCache({ storage: s, nowMs: T0, signedIn: false });
  assert.equal(r.expired, false);
  assert.equal(s.getItem(ANON_SESSION_KEY), String(T0));
  assert.ok(s.has('wc26.grouppicks.local'), 'drafts intact on first visit');
});

test('R16 #C2: within 90 min keeps drafts; past 90 min clears them', () => {
  const within = mkStorage({ ...draftSeed(), [ANON_SESSION_KEY]: String(T0) });
  const r1 = expireAnonCache({ storage: within, nowMs: T0 + ANON_TTL_MS - 60_000, signedIn: false });
  assert.equal(r1.expired, false);
  assert.ok(within.has('wc26.mybrackets.local'));

  const past = mkStorage({ ...draftSeed(), [ANON_SESSION_KEY]: String(T0) });
  const r2 = expireAnonCache({ storage: past, nowMs: T0 + ANON_TTL_MS + 60_000, signedIn: false });
  assert.equal(r2.expired, true);
  assert.equal(r2.reason, 'ttl');
  for (const k of ANON_DRAFT_KEYS) assert.equal(past.has(k), false, `${k} cleared`);
  assert.ok(past.has('wc26.prefs'), 'non-anon keys preserved');
  assert.equal(past.getItem(ANON_SESSION_KEY), String(T0 + ANON_TTL_MS + 60_000), 'clock restarts');
});

test('R16 #C3: signed-in users are never expired (even past TTL)', () => {
  const s = mkStorage({ ...draftSeed(), [ANON_SESSION_KEY]: String(T0) });
  const r = expireAnonCache({ storage: s, nowMs: T0 + 10 * ANON_TTL_MS, signedIn: true });
  assert.equal(r.expired, false);
  assert.ok(s.has('wc26.grouppicks.local'));
});

test('R16 #C3b: an sb-*-auth-token in storage counts as signed-in', () => {
  const s = mkStorage({
    ...draftSeed(),
    [ANON_SESSION_KEY]: String(T0),
    'sb-vodjwymxquuertmhtvuw-auth-token': '{"access_token":"x"}',
  });
  const r = expireAnonCache({ storage: s, nowMs: T0 + 10 * ANON_TTL_MS }); // no signedIn override
  assert.equal(r.expired, false, 'auth token present → treated as signed-in');
  assert.ok(s.has('wc26.picks'));
});

test('R16 #C4: a recorded stage-3 submit expires on next boot, even within TTL', () => {
  const s = mkStorage({ ...draftSeed(), [ANON_SESSION_KEY]: String(T0) });
  markAnonSubmitted(s);
  assert.equal(s.getItem(ANON_SUBMITTED_KEY), '1');
  const r = expireAnonCache({ storage: s, nowMs: T0 + 60_000, signedIn: false }); // 1 min later
  assert.equal(r.expired, true);
  assert.equal(r.reason, 'submitted');
  for (const k of ANON_DRAFT_KEYS) assert.equal(s.has(k), false);
  assert.equal(s.has(ANON_SUBMITTED_KEY), false, 'submitted flag consumed');
});

test('R16 #C5: idempotent — second boot right after expiry is a no-op', () => {
  const s = mkStorage({ ...draftSeed(), [ANON_SESSION_KEY]: String(T0) });
  expireAnonCache({ storage: s, nowMs: T0 + ANON_TTL_MS + 1, signedIn: false }); // expires
  const r2 = expireAnonCache({ storage: s, nowMs: T0 + ANON_TTL_MS + 2, signedIn: false });
  assert.equal(r2.expired, false, 'clock restarted, nothing left to expire');
});

test('R16 #C6: clearAnonDrafts removes only the anon draft keys', () => {
  const s = mkStorage(draftSeed());
  const removed = clearAnonDrafts(s);
  assert.deepEqual(removed.sort(), [...ANON_DRAFT_KEYS].sort());
  assert.ok(s.has('wc26.prefs'), 'prefs untouched');
});
