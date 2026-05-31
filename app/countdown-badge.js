/* countdown-badge.js — A10: dynamic title + PWA Badging API
   Surfaces "days until opening match" (or "Live" / "Today") in the document
   title and on the app icon (where supported via navigator.setAppBadge). */

const KICKOFF_OPENING = '2026-06-11T19:00:00Z';
let timerId = null;
let baseTitle = 'WC26 Tracker';

export function initCountdownBadge(opts = {}) {
  baseTitle = opts.title || document.title || 'WC26 Tracker';
  applyOnce();
  if (timerId) clearInterval(timerId);
  timerId = setInterval(applyOnce, 60_000);
}

function applyOnce() {
  const label = computeLabel();
  if (label) {
    document.title = `${baseTitle} — ${label}`;
  } else {
    document.title = baseTitle;
  }
  const days = daysUntilKickoff();
  if (typeof navigator !== 'undefined' && typeof navigator.setAppBadge === 'function') {
    if (days != null && days > 0 && days < 100) {
      navigator.setAppBadge(days).catch(() => {});
    } else if (days != null && days <= 0) {
      navigator.setAppBadge(1).catch(() => {});
    } else if (typeof navigator.clearAppBadge === 'function') {
      navigator.clearAppBadge().catch(() => {});
    }
  }
}

function computeLabel() {
  const days = daysUntilKickoff();
  if (days == null) return null;
  if (days <= 0) return 'LIVE';
  if (days === 1) return '1 day to go';
  if (days <= 7) return `${days} days to go`;
  return null;
}

function daysUntilKickoff() {
  const now = Date.now();
  const open = Date.parse(KICKOFF_OPENING);
  if (!Number.isFinite(open)) return null;
  return Math.ceil((open - now) / 86_400_000);
}
