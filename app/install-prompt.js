/* install-prompt.js — A7: first-visit iOS Add-to-Home-Screen banner.
   Only fires on iOS Safari when NOT already running as a standalone PWA.
   Dismissed state persists in localStorage so we don't nag.
   RJ30-3: the standalone + iOS-Safari predicates are now shared with the push
   opt-in card via lib/pwa-install.js (single source of truth). */

import { isStandalonePWA, isIOSSafari } from './lib/pwa-install.js';

const LS_DISMISSED = 'wc26.installPrompt.dismissed';
const DISMISS_TTL_DAYS = 14;

export function maybeShowInstallPrompt() {
  if (typeof window === 'undefined') return;

  // Already installed as a PWA? Skip.
  if (isStandalonePWA()) return;

  // iOS Safari only — other browsers / OSes handle PWA install differently
  // (Android Chrome uses beforeinstallprompt; not handling here).
  if (!isIOSSafari()) return;

  // Dismissed recently?
  try {
    const raw = localStorage.getItem(LS_DISMISSED);
    if (raw) {
      const ts = parseInt(raw, 10);
      if (Number.isFinite(ts) && Date.now() - ts < DISMISS_TTL_DAYS * 86400000) return;
    }
  } catch {}

  // Build the banner — slide up from bottom, 2 actions: Got it / Show me how
  const banner = document.createElement('div');
  banner.className = 'wc-install-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Add WC26 to home screen');
  banner.innerHTML = `
    <div class="wc-install-body">
      <div class="wc-install-text">
        <strong>Add WC26 to your home screen</strong>
        <p class="muted">Tap <span class="wc-install-share">⎙</span> then <strong>Add to Home Screen</strong> for the full-screen tournament app.</p>
      </div>
      <div class="wc-install-actions">
        <button type="button" class="pick-btn pick-btn-secondary" id="wc-install-dismiss">Got it</button>
      </div>
    </div>
  `;
  document.body.appendChild(banner);
  requestAnimationFrame(() => banner.classList.add('is-open'));
  banner.querySelector('#wc-install-dismiss').addEventListener('click', () => {
    try { localStorage.setItem(LS_DISMISSED, String(Date.now())); } catch {}
    banner.classList.remove('is-open');
    setTimeout(() => banner.remove(), 280);
  });
}
