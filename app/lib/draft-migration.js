/* draft-migration.js — R11: copy guest-local drafts under a user identity
   after sign-in/sign-up so users don't lose their pre-signup work.
   Pure module — no Supabase / no DOM dependencies, so it's importable
   from both the browser and the node test runner. */

const PAIRS = [
  ['wc26.grouppicks.local', (uid) => `wc26.grouppicks.user-${uid}`],
  ['wc26.mybrackets.local', (uid) => `wc26.mybrackets.user-${uid}`],
];

/**
 * Copy guest drafts to user-scoped keys. Never overwrites an existing
 * user key (conservative — if the user already has account-side drafts
 * we don't blast over them with a different local pick set).
 */
export function migrateGuestDraftsToUser(userId, storage) {
  storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!userId || !storage) return { migrated: [] };
  const migrated = [];
  for (const [src, destFn] of PAIRS) {
    try {
      const srcVal = storage.getItem(src);
      if (!srcVal) continue;
      const dest = destFn(userId);
      const destVal = storage.getItem(dest);
      if (destVal) continue; // don't clobber
      storage.setItem(dest, srcVal);
      migrated.push({ from: src, to: dest });
    } catch {}
  }
  return { migrated };
}
