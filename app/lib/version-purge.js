/* version-purge.js — R12: surgical legacy-state purge on deploy version
   mismatch. Preserves user picks + prefs; clears only known-orphan keys
   AND auth tokens whose Supabase project URL doesn't match the bundled
   default. Idempotent — safe to run on every boot. */

// Keep this in sync with sw.js VERSION so a manual SW bump also triggers
// a state migration check.
export const APP_VERSION = 'wc26-v17';
const STORAGE_KEY = 'wc26.app.version';

// R16 (Phase 3): anonymous-session cache expiry. Anonymous users' local drafts
// must not linger forever on the device. They expire on the next boot when the
// session is older than ANON_TTL_MS (default 90 min) OR after the anon has
// completed a stage-1/2/3 submit (marked via markAnonSubmitted). Signed-in
// users are never touched.
export const ANON_SESSION_KEY = 'wc26.anon.sessionStart';
export const ANON_SUBMITTED_KEY = 'wc26.anon.submitted';
export const ANON_TTL_MS = 90 * 60 * 1000;
export const ANON_DRAFT_KEYS = [
  'wc26.grouppicks.local',
  'wc26.mybrackets.local',
  'wc26.picks',
];

// Legacy/orphan keys we no longer use anywhere in the codebase. Safe to
// purge on every version mismatch.
// NOTE: wc26.competition.bracketDrafts / wc26.competition.activeDraft were
// WRONGLY listed here — competition.js (listBracketDrafts/createBracketDraft/
// setActiveDraft) and the my-picks create-group flow still actively read and
// write them, so every APP_VERSION bump silently deleted users' draft state.
const LEGACY_KEYS = [];

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

function hasAuthToken(storage) {
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && /^sb-[a-z0-9]+-auth-token/.test(k)) return true;
  }
  return false;
}

/** Remove the anonymous local-draft keys (the anon's saved picks). */
export function clearAnonDrafts(storage) {
  storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage) return [];
  const removed = [];
  for (const k of ANON_DRAFT_KEYS) {
    if (storage.getItem(k) != null) { storage.removeItem(k); removed.push(k); }
  }
  return removed;
}

/** Mark that the anonymous user has completed a submit — expires next boot. */
export function markAnonSubmitted(storage) {
  storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage) return;
  try { storage.setItem(ANON_SUBMITTED_KEY, '1'); } catch { /* ignore */ }
}

/**
 * Expire the anonymous session's local drafts.
 * - Skips entirely for signed-in users (detected via an sb-*-auth-token, or
 *   opts.signedIn override for tests).
 * - On first anon visit, stamps the session start and clears nothing.
 * - Clears drafts when the session is older than ttlMs OR a stage-3 submit was
 *   recorded, then restarts the clock.
 *
 * @param {{ storage?: Storage, nowMs?: number, ttlMs?: number, signedIn?: boolean }} opts
 */
export function expireAnonCache(opts = {}) {
  const storage = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage) return { expired: false, removed: [] };

  const signedIn = opts.signedIn != null ? opts.signedIn : hasAuthToken(storage);
  if (signedIn) return { expired: false, removed: [] };

  const now = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const ttl = Number.isFinite(opts.ttlMs) ? opts.ttlMs : ANON_TTL_MS;
  const submitted = storage.getItem(ANON_SUBMITTED_KEY) === '1';
  const startRaw = storage.getItem(ANON_SESSION_KEY);
  const start = startRaw != null ? Number(startRaw) : NaN;

  if (!Number.isFinite(start)) {
    // First anon visit (or stamp lost) — start the clock; nothing to expire yet
    // unless they already submitted in a prior session.
    if (submitted) {
      const removed = clearAnonDrafts(storage);
      storage.removeItem(ANON_SUBMITTED_KEY);
      storage.setItem(ANON_SESSION_KEY, String(now));
      return { expired: true, removed, reason: 'submitted' };
    }
    storage.setItem(ANON_SESSION_KEY, String(now));
    return { expired: false, removed: [] };
  }

  const aged = now - start > ttl;
  if (!aged && !submitted) return { expired: false, removed: [] };

  const removed = clearAnonDrafts(storage);
  storage.removeItem(ANON_SUBMITTED_KEY);
  storage.setItem(ANON_SESSION_KEY, String(now));
  return { expired: true, removed, reason: submitted ? 'submitted' : 'ttl' };
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
