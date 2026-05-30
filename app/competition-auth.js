/** Synthetic email domain for username-only accounts (Supabase rejects .local). */
export const USERNAME_AUTH_EMAIL_DOMAIN = 'wc26.app';

export function usernameToAuthEmail(username) {
  return `${normalizeUsername(username)}@${USERNAME_AUTH_EMAIL_DOMAIN}`;
}

export function normalizeUsername(input) {
  const value = String(input || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(value)) {
    throw new Error('Username must be 3-20 chars: letters, numbers, underscore.');
  }
  return value;
}

export function normalizeSignInIdentifier(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) {
    throw new Error('Enter a username or email.');
  }
  if (raw.includes('@')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      throw new Error('Enter a valid email address.');
    }
    const localPart = raw.split('@')[0];
    const inferredUsername = /^[a-z0-9_]{3,20}$/.test(localPart) ? localPart : null;
    return { email: raw, inferredUsername };
  }
  const clean = normalizeUsername(raw);
  return { email: usernameToAuthEmail(clean), inferredUsername: clean };
}
