/* auth-modal.js — R16: the single, canonical auth lightbox.
 *
 * Replaces the cramped, race-prone toolbar dropdown that buried sign-in/up
 * behind 2–3 nested re-mounts. Every entry point (navbar account button, home
 * CTA, Settings "Sign in", My Picks landing) calls openAuth(mode) and gets a
 * centered modal overlay. renderAuthPanel (unchanged) is mounted inside it.
 *
 * Success closes the modal; the view repaints because competition.js fires
 * competition:state-change, which main.js now bridges to renderView().
 */

import { renderAuthPanel, PANEL_ENTRY, PANEL_SIGNIN, PANEL_SIGNUP } from './competition-auth-panel.js';
import {
  getCompetitionState,
  signIn,
  signUp,
  continueAsGuest,
  setGuestHandle,
  setAuthPanelMode,
  getAuthPanelMode,
  clearAuthDismiss,
  isSupabaseConfigured,
} from './competition.js';
import { promptHandle } from './components/handle-prompt.js';

let _overlay = null;
let _lastFocus = null;
let _keydownBound = null;

const VALID_MODES = new Set([PANEL_ENTRY, PANEL_SIGNIN, PANEL_SIGNUP]);

export function isAuthOpen() {
  return !!_overlay;
}

export function openAuth(mode = PANEL_ENTRY) {
  if (VALID_MODES.has(mode)) setAuthPanelMode(mode);

  // Already open → just repaint at the requested mode (no second overlay).
  if (_overlay) { paint(); focusFirst(); return; }

  _lastFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'auth-modal-overlay';
  overlay.setAttribute('data-testid', 'auth-modal');
  overlay.innerHTML = `
    <div class="auth-modal-card" role="dialog" aria-modal="true" aria-label="Account" data-testid="auth-modal-card">
      <button class="auth-modal-close" type="button" aria-label="Close">&times;</button>
      <div class="auth-modal-body"></div>
    </div>`;
  document.body.appendChild(overlay);
  _overlay = overlay;

  overlay.querySelector('.auth-modal-close').addEventListener('click', () => closeAuth());
  // Backdrop click (outside the card) closes.
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeAuth(); });

  _keydownBound = (e) => {
    if (e.key === 'Escape') { closeAuth(); return; }
    if (e.key === 'Tab') trapFocus(e);
  };
  document.addEventListener('keydown', _keydownBound);

  paint();
  focusFirst();
}

export function closeAuth() {
  if (!_overlay) return;
  _overlay.remove();
  _overlay = null;
  if (_keydownBound) { document.removeEventListener('keydown', _keydownBound); _keydownBound = null; }
  if (_lastFocus && typeof _lastFocus.focus === 'function') {
    try { _lastFocus.focus(); } catch { /* element gone */ }
  }
  _lastFocus = null;
}

function paint() {
  if (!_overlay) return;
  const body = _overlay.querySelector('.auth-modal-body');
  const comp = getCompetitionState();
  renderAuthPanel(body, comp, buildHandlers(body));
}

function setMsg(body, msg, isErr = false) {
  const m = body.querySelector('#comp-msg');
  if (!m) return;
  m.textContent = msg || '';
  m.dataset.kind = isErr ? 'error' : 'info';
  m.style.color = isErr ? 'var(--bad, #c9252d)' : '';
}

function buildHandlers(body) {
  return {
    getPanelMode: () => getAuthPanelMode() || PANEL_ENTRY,
    setPanelMode: (mode, repaint = false) => {
      setAuthPanelMode(mode);
      if (repaint) { paint(); focusFirst(); }
    },
    clearGuestDismiss: () => clearAuthDismiss(),
    onGuest: async () => {
      const handle = await promptHandle();
      if (!handle) return; // cancelled — leave the modal open
      setGuestHandle(handle);
      continueAsGuest();
      closeAuth();
    },
    onSignIn: async () => {
      const username = body.querySelector('#comp-username')?.value?.trim();
      const password = body.querySelector('#comp-password')?.value;
      try {
        setMsg(body, '');
        if (!isSupabaseConfigured()) throw new Error('Login is not configured on this deploy.');
        await signIn(username, password);
        closeAuth();
      } catch (err) {
        setMsg(body, err?.message || 'Sign in failed', true);
      }
    },
    onSignUp: async () => {
      const username = body.querySelector('#comp-username')?.value?.trim();
      const password = body.querySelector('#comp-password')?.value;
      try {
        setMsg(body, '');
        if (!isSupabaseConfigured()) throw new Error('Account creation is not configured on this deploy.');
        await signUp(username, password);
        closeAuth();
      } catch (err) {
        setMsg(body, err?.message || 'Sign up failed', true);
      }
    },
  };
}

function focusableEls() {
  if (!_overlay) return [];
  return Array.from(_overlay.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter((el) => !el.disabled && el.offsetParent !== null);
}

function focusFirst() {
  const els = focusableEls();
  // Prefer the first text input (username), else the first focusable.
  const input = _overlay?.querySelector('#comp-username');
  (input || els[0])?.focus();
}

function trapFocus(e) {
  const els = focusableEls();
  if (!els.length) return;
  const first = els[0];
  const last = els[els.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
