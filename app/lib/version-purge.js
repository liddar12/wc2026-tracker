/* version-purge.js — R12: surgical legacy-state purge on deploy version
   mismatch. Preserves user picks + prefs; clears only known-orphan keys
   AND auth tokens whose Supabase project URL doesn't match the bundled
   default. Idempotent — safe to run on every boot. */

// Keep this in sync with sw.js VERSION so a manual SW bump also triggers
// a state migration check.
export const APP_VERSION = 'wc26-v14';
const STORAGE_KEY = 'wc26.app.version';

// Legacy/orphan keys we no longer use anywhere in the codebase. Safe to
// purge on every version mismatch.
const LEGACY_KEYS = [
  'wc26.competition.bracketDrafts',
  'wc26.competition.activeDraft',
];

// Keys that were once user-overridable (developer mode) and can shadow the
// bundled Supabase env. If present after a deploy where we ship a different
// URL, they cause "sign-in works against the wrong project" failures.
const OVERRIDE_KEYS = [
  'wc26.supabase.url',
  'wc26.supabase.anonKey',
];

/**
 * Purge legacy state if the app version differs from the last-recorded one.
 * Returns a report describing what was cleared so callers can log/toast.
 *
 * @param {{ bundledSupabaseUrl?: string, storage?: Storage }} opts
 */
export function purgeLegacyState(opts = {}) {
  const storage = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage) return { ranMigration: false, removed: [] };

  const previous = storage.getItem(STORAGE_KEY);
  if (previous === APP_VERSION) return { ranMigration: false, removed: [] };

  const removed = [];

  // 1) Drop legacy keys we no longer reference anywhere.
  for (const k of LEGACY_KEYS) {
    if (storage.getItem(k) != null) {
      storage.removeItem(k);
      removed.push(k);
    }
  }

  // 2) Drop manual Supabase overrides — these shadow the bundled config and
  // can route auth attempts to the wrong project.
  for (const k of OVERRIDE_KEYS) {
    if (storage.getItem(k) != null) {
      storage.removeItem(k);
      removed.push(k);
    }
  }

  // 3) Invalidate Supabase auth tokens whose project URL doesn't match the
  // bundled URL. The token is keyed by project ref like
  // `sb-vodjwymxquuertmhtvuw-auth-token`. If we deploy against a different
  // project, the old token never expires client-side but signIn against
  // the new URL ignores it and the toolbar stays in a confused half-state.
  if (opts.bundledSupabaseUrl) {
    const expectedRef = extractProjectRef(opts.bundledSupabaseUrl);
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (!key) continue;
      const m = key.match(/^sb-([a-z0-9]+)-auth-token/);
      if (m && expectedRef && m[1] !== expectedRef) {
        storage.removeItem(key);
        removed.push(key);
      }
    }
  }

  storage.setItem(STORAGE_KEY, APP_VERSION);
  return { ranMigration: true, removed, fromVersion: previous, toVersion: APP_VERSION };
}

/**
 * Manual escape hatch — wipe every wc26.* key plus any sb-* auth tokens.
 * Used by Settings → "Reset app data".
 */
export function fullReset(storage) {
  storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage) return { removed: [] };
  const removed = [];
  for (let i = storage.length - 1; i >= 0; i--) {
    const k = storage.key(i);
    if (!k) continue;
    if (k.startsWith('wc26.') || k.startsWith('sb-')) {
      storage.removeItem(k);
      removed.push(k);
    }
  }
  return { removed };
}

function extractProjectRef(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    // https://<ref>.supabase.co
    const m = host.match(/^([a-z0-9]+)\.supabase\.co/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
