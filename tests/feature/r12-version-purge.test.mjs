import test from 'node:test';
import assert from 'node:assert/strict';
import { purgeLegacyState, fullReset, APP_VERSION } from '../../app/lib/version-purge.js';

function mockStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    _dump: () => Object.fromEntries(store),
  };
}

test('R12: purge PRESERVES in-use draft keys on version mismatch', () => {
  // June-11 audit fix: wc26.competition.bracketDrafts / activeDraft were
  // wrongly on the legacy purge list while competition.js still reads/writes
  // them — every version bump silently wiped users' draft state. They must
  // now survive the purge.
  const s = mockStorage({
    'wc26.competition.bracketDrafts': '[]',
    'wc26.competition.activeDraft': 'abc',
    'wc26.grouppicks.local': '{}',
    'wc26.theme': 'dark',
  });
  const r = purgeLegacyState({ storage: s });
  assert.equal(r.ranMigration, true);
  assert.ok(!r.removed.includes('wc26.competition.bracketDrafts'), 'bracketDrafts kept');
  assert.ok(!r.removed.includes('wc26.competition.activeDraft'), 'activeDraft kept');
  assert.equal(s.getItem('wc26.competition.bracketDrafts'), '[]');
  assert.equal(s.getItem('wc26.competition.activeDraft'), 'abc');
  // User picks + prefs preserved
  assert.equal(s.getItem('wc26.grouppicks.local'), '{}');
  assert.equal(s.getItem('wc26.theme'), 'dark');
  // Version recorded
  assert.equal(s.getItem('wc26.app.version'), APP_VERSION);
});

test('R12: purge is idempotent — second run on same version does nothing', () => {
  const s = mockStorage({
    'wc26.competition.bracketDrafts': '[]',
  });
  purgeLegacyState({ storage: s });
  const r2 = purgeLegacyState({ storage: s });
  assert.equal(r2.ranMigration, false);
  assert.deepEqual(r2.removed, []);
});

test('R12: purge invalidates auth tokens for non-matching Supabase project', () => {
  const s = mockStorage({
    'sb-oldproject123-auth-token': '{"access_token":"x"}',
    'sb-vodjwymxquuertmhtvuw-auth-token': '{"access_token":"current"}',
  });
  const r = purgeLegacyState({ storage: s, bundledSupabaseUrl: 'https://vodjwymxquuertmhtvuw.supabase.co' });
  assert.ok(r.removed.includes('sb-oldproject123-auth-token'));
  assert.ok(!r.removed.includes('sb-vodjwymxquuertmhtvuw-auth-token'));
  assert.equal(s.getItem('sb-oldproject123-auth-token'), null);
  assert.equal(s.getItem('sb-vodjwymxquuertmhtvuw-auth-token'), '{"access_token":"current"}');
});

test('R12: purge drops Supabase URL overrides', () => {
  const s = mockStorage({
    'wc26.supabase.url': 'https://wrong.supabase.co',
    'wc26.supabase.anonKey': 'old-key',
  });
  const r = purgeLegacyState({ storage: s });
  assert.ok(r.removed.includes('wc26.supabase.url'));
  assert.ok(r.removed.includes('wc26.supabase.anonKey'));
});

test('R12: fullReset wipes every wc26.* and sb-* key', () => {
  const s = mockStorage({
    'wc26.grouppicks.local': '{}',
    'wc26.theme': 'dark',
    'wc26.app.version': 'wc26-v10',
    'sb-foo-auth-token': '{}',
    'other.key.unrelated': 'preserved',
  });
  const r = fullReset(s);
  assert.equal(s.length, 1);
  assert.equal(s.getItem('other.key.unrelated'), 'preserved');
  assert.ok(r.removed.includes('wc26.grouppicks.local'));
  assert.ok(r.removed.includes('sb-foo-auth-token'));
});

test('R12: purge tolerates missing storage gracefully', () => {
  const r = purgeLegacyState({ storage: null });
  assert.equal(r.ranMigration, false);
});
