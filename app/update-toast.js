/* update-toast.js — slide-in toast notification when the data version
   has changed since the user's last visit. Auto-dismisses in 4s; tap
   to dismiss early. */

import { formatLastUpdated } from './data-loader.js';

const LS_KEY = 'wc26.lastSeenDataVersion';

function readLastSeen() {
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}
function persistLastSeen(version) {
  try { localStorage.setItem(LS_KEY, version); } catch {}
}

export function showUpdateToastIfNew(data) {
  const current = data?.meta?.data_version;
  if (!current) return;
  const last = readLastSeen();
  if (!last) {
    // First visit — record but don't toast (would be every new user).
    persistLastSeen(current);
    return;
  }
  if (last === current) return;
  // Data is newer than last visit
  persistLastSeen(current);
  spawnToast(current);
}

function spawnToast(versionIso) {
  // Avoid duplicate toasts on rapid re-renders
  if (document.querySelector('.wc-toast')) return;
  const toast = document.createElement('div');
  toast.className = 'wc-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `
    <span class="wc-toast-dot" aria-hidden="true"></span>
    <span class="wc-toast-body">Data refreshed <strong>${escapeHtml(formatLastUpdated(versionIso))}</strong></span>
    <button class="wc-toast-close" aria-label="Dismiss" type="button">&times;</button>
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  const dismiss = () => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 280);
  };
  toast.querySelector('.wc-toast-close').addEventListener('click', dismiss);
  toast.addEventListener('click', (e) => { if (!e.target.closest('.wc-toast-close')) dismiss(); });
  setTimeout(dismiss, 4500);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
