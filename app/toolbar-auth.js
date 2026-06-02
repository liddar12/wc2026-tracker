/* toolbar-auth.js — R6: account/guest state lives in the global toolbar,
   not inside any content view. Mounts the existing renderAuthPanel into
   a popover anchored to the toolbar account button.

   The pre-R6 mount inside my-picks.js is removed. */

import { renderAuthPanel } from './competition-auth-panel.js';
import {
  getCompetitionState,
  continueAsGuest,
  signIn,
  signUp,
  signOut,
  isSupabaseConfigured,
  setGuestHandle,
  setAuthPanelMode,
  getAuthPanelMode,
} from './competition.js';

const LS_LAST_HANDLE = 'wc26.competition.guestHandle';

export function initToolbarAuth(data) {
  const btn = document.getElementById('auth-toolbar-btn');
  const label = document.getElementById('auth-toolbar-label');
  const menu = document.getElementById('auth-toolbar-menu');
  if (!btn || !menu || !label) return;

  function syncLabel() {
    const s = getCompetitionState();
    if (s?.user?.email) {
      label.textContent = labelFromEmail(s.user.email);
      btn.dataset.state = 'signed-in';
    } else if (s?.guestMode) {
      label.textContent = s.guestHandle || 'Guest';
      btn.dataset.state = 'guest';
    } else if (!isSupabaseConfigured()) {
      label.textContent = 'Offline';
      btn.dataset.state = 'offline';
    } else {
      label.textContent = 'Sign in';
      btn.dataset.state = 'signed-out';
    }
  }

  syncLabel();
  window.addEventListener('competition:state-change', syncLabel);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!menu.hidden) {
      menu.hidden = true;
      return;
    }
    renderMenu(menu, data, syncLabel);
    menu.hidden = false;
    positionMenu(menu, btn);
  });

  // R6 QA: avoid the "outside-click hides menu mid-mount" race. When an
  // inner button (e.g. "Sign up / Sign in") replaces the menu's innerHTML,
  // the original click target is gone by the time this listener runs and
  // .contains() returns false. Mark the menu as "remounting" while it
  // rebuilds and ignore document clicks for that tick.
  document.addEventListener('click', (e) => {
    if (menu.hidden) return;
    if (menu.dataset.remounting === '1') return;
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    menu.hidden = true;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      menu.hidden = true;
      btn.focus();
    }
  });
}

function labelFromEmail(email) {
  if (!email) return 'Account';
  const before = email.split('@')[0];
  return before.slice(0, 12);
}

function positionMenu(menu, btn) {
  const r = btn.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  menu.style.left = 'auto';
  menu.style.zIndex = '50';
}

function renderMenu(host, data, onChange) {
  host.innerHTML = '';
  const s = getCompetitionState();
  const card = document.createElement('div');
  card.className = 'auth-menu-card';

  if (s?.user) {
    card.innerHTML = `
      <div class="auth-menu-head">
        <strong>${escapeHtml(s.user.email || 'Signed in')}</strong>
        <span class="muted">Account</span>
      </div>
      <button class="pick-btn pick-btn-secondary" id="auth-menu-signout">Sign out</button>
    `;
    card.querySelector('#auth-menu-signout').addEventListener('click', async () => {
      await signOut();
      onChange();
      host.hidden = true;
    });
  } else if (s?.guestMode) {
    card.innerHTML = `
      <div class="auth-menu-head">
        <strong>${escapeHtml(s.guestHandle || 'Guest')}</strong>
        <span class="muted">Anonymous</span>
      </div>
      <p class="muted" style="font-size:12px; margin: 6px 0 8px;">Your picks save to this device. Sign up to keep them across devices.</p>
      <button class="pick-btn" id="auth-menu-signin">Sign up / Sign in</button>
    `;
    card.querySelector('#auth-menu-signin').addEventListener('click', (e) => {
      e.stopPropagation();
      host.dataset.remounting = '1';
      mountFullAuthPanel(host, data, onChange);
      setTimeout(() => { delete host.dataset.remounting; }, 0);
    });
  } else if (!isSupabaseConfigured()) {
    card.innerHTML = `
      <div class="auth-menu-head"><strong>Offline mode</strong></div>
      <p class="muted" style="font-size:12px; margin: 6px 0 0;">Supabase isn't configured — your picks save locally.</p>
    `;
  } else {
    card.innerHTML = `
      <div class="auth-menu-head"><strong>Not signed in</strong></div>
      <p class="muted" style="font-size:12px; margin: 6px 0 8px;">Submit as a guest, or sign in for cross-device entries.</p>
      <button class="pick-btn" id="auth-menu-signin">Sign up / Sign in</button>
      <button class="pick-btn pick-btn-secondary" id="auth-menu-guest" style="margin-top: 6px;">Continue as guest</button>
    `;
    card.querySelector('#auth-menu-signin').addEventListener('click', (e) => {
      e.stopPropagation();
      host.dataset.remounting = '1';
      mountFullAuthPanel(host, data, onChange);
      setTimeout(() => { delete host.dataset.remounting; }, 0);
    });
    card.querySelector('#auth-menu-guest').addEventListener('click', async () => {
      const handle = await promptHandle();
      if (!handle) return;
      setGuestHandle(handle);
      continueAsGuest();
      onChange();
      host.hidden = true;
    });
  }
  host.appendChild(card);
}

function mountFullAuthPanel(host, data, onChange) {
  // R6 QA: renderAuthPanel expects (section, comp, handlers). The earlier
  // shim passed (data, callback) which caused
  // "Cannot read properties of undefined (reading 'getPanelMode')" the
  // moment users tapped "Sign up / Sign in" from the toolbar menu.
  //
  // R10 QA: the inner setPanelMode('signin', true) transition also wipes
  // innerHTML mid-event, so the outside-click handler races and closes the
  // menu before the inputs appear. Set the remounting flag here so EVERY
  // mount path (outer entry → panel AND inner entry → signin/signup) is
  // protected.
  host.dataset.remounting = '1';
  setTimeout(() => { delete host.dataset.remounting; }, 0);
  host.innerHTML = '';
  const comp = getCompetitionState();
  // R6 QA: the auth panel template uses #comp-msg, not .auth-error-msg.
  // The earlier shim looked for the wrong selector and silently swallowed
  // every sign-in / sign-up error. Surface both for resilience.
  const setMessage = (msg, isErr = false) => {
    for (const sel of ['#comp-msg', '.auth-error-msg']) {
      const m = host.querySelector(sel);
      if (m) {
        m.textContent = msg || '';
        m.dataset.kind = isErr ? 'error' : 'info';
        m.style.color = isErr ? 'var(--bad, #c9252d)' : '';
      }
    }
  };
  const handlers = {
    getPanelMode: () => getAuthPanelMode() || 'entry',
    setPanelMode: async (mode, repaint = false) => {
      setAuthPanelMode(mode);
      if (repaint) mountFullAuthPanel(host, data, onChange);
    },
    clearGuestDismiss: () => {},
    onGuest: () => {
      continueAsGuest();
      onChange();
      host.hidden = true;
    },
    onSignIn: async () => {
      const username = host.querySelector('#comp-username')?.value?.trim();
      const password = host.querySelector('#comp-password')?.value;
      try {
        setMessage('');
        if (!isSupabaseConfigured()) throw new Error('Login is not configured on this deploy.');
        await signIn(username, password);
        onChange();
        host.hidden = true;
      } catch (err) {
        setMessage(err?.message || 'Sign in failed', true);
      }
    },
    onSignUp: async () => {
      const username = host.querySelector('#comp-username')?.value?.trim();
      const password = host.querySelector('#comp-password')?.value;
      try {
        setMessage('');
        if (!isSupabaseConfigured()) throw new Error('Account creation is not configured on this deploy.');
        await signUp(username, password);
        onChange();
        host.hidden = true;
      } catch (err) {
        setMessage(err?.message || 'Sign up failed', true);
      }
    },
  };
  renderAuthPanel(host, comp, handlers);
}

async function promptHandle() {
  const last = (() => { try { return localStorage.getItem(LS_LAST_HANDLE) || ''; } catch { return ''; } })();
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'auth-handle-overlay';
    overlay.innerHTML = `
      <div class="auth-handle-card" role="dialog" aria-modal="true" aria-labelledby="auth-handle-title">
        <h3 id="auth-handle-title">Choose a name</h3>
        <label for="auth-handle-input" class="muted" style="font-size:13px; margin: 0 0 10px; display:block;">This shows on the leaderboard. We'll add a number if it's taken.</label>
        <input id="auth-handle-input" class="auth-input" type="text" maxlength="30" placeholder="e.g. Jimmy" value="${escapeHtml(last)}" aria-label="Display name" autocomplete="nickname">
        <div style="display:flex; gap:8px; margin-top: 10px;">
          <button class="pick-btn" id="auth-handle-ok">Continue</button>
          <button class="pick-btn pick-btn-secondary" id="auth-handle-cancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#auth-handle-input');
    input.focus();
    input.select();
    function close(val) { overlay.remove(); resolve(val); }
    overlay.querySelector('#auth-handle-ok').addEventListener('click', () => {
      const v = (input.value || '').trim();
      close(v || null);
    });
    overlay.querySelector('#auth-handle-cancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { close(null); document.removeEventListener('keydown', onKey); }
      if (e.key === 'Enter') { overlay.querySelector('#auth-handle-ok').click(); document.removeEventListener('keydown', onKey); }
    });
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
