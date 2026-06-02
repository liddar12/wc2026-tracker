/* toolbar-auth.js — R6: account/guest state lives in the global toolbar,
   not inside any content view. Mounts the existing renderAuthPanel into
   a popover anchored to the toolbar account button.

   The pre-R6 mount inside my-picks.js is removed. */

import { renderAuthPanel } from './competition-auth-panel.js';
import {
  getCompetitionState,
  continueAsGuest,
  signOut,
  isSupabaseConfigured,
  setGuestHandle,
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

  document.addEventListener('click', (e) => {
    if (menu.hidden) return;
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
    card.querySelector('#auth-menu-signin').addEventListener('click', () => {
      mountFullAuthPanel(host, data, onChange);
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
    card.querySelector('#auth-menu-signin').addEventListener('click', () => {
      mountFullAuthPanel(host, data, onChange);
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
  host.innerHTML = '';
  const panel = renderAuthPanel(data, () => {
    onChange();
    host.hidden = true;
  });
  if (panel) host.appendChild(panel);
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
