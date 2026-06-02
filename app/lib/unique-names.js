/* unique-names.js — R6 T7: deterministic name uniqueness with auto-suffix.
   Used by both entrant handles (per-pool) and pool names (global).

   Algorithm:
     allocateUnique(base, existsFn) → "Jimmy" | "Jimmy-2" | "Jimmy-3" | ...
   `existsFn(candidate)` is async, returns true if the name is already taken.
   The base is normalized (trim, collapse whitespace, cap at 30 chars).
*/

export function normalizeName(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim().replace(/\s+/g, ' ').slice(0, 30);
  return trimmed;
}

export async function allocateUnique(base, existsFn, opts = {}) {
  const max = opts.maxAttempts || 50;
  const normalized = normalizeName(base);
  if (!normalized) throw new Error('Name is empty.');
  if (!(await existsFn(normalized))) return normalized;
  for (let n = 2; n <= max; n++) {
    const candidate = `${normalized}-${n}`;
    if (!(await existsFn(candidate))) return candidate;
  }
  throw new Error('Could not allocate a unique name (too many collisions).');
}

/* Convenience wrappers ----------------------------------------------------- */

export async function allocateUniqueHandle(base, options) {
  // options.checkExists is the per-pool collision check; the caller decides
  // whether that's a Supabase query, a localStorage lookup, etc.
  const checkExists = options?.checkExists || (async () => false);
  return allocateUnique(base, checkExists);
}

export async function allocateUniquePoolName(base, options) {
  const checkExists = options?.checkExists || (async () => false);
  return allocateUnique(base, checkExists);
}
