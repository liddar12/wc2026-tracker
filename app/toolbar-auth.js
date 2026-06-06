/* toolbar-auth.js — R16: the toolbar account button is now a thin launcher.
   Signed-out / guest users tap it and get the single centered auth lightbox
   (auth-modal.js, openAuth). Signed-in users get a small account popover with
   Sign out. The pre-R16 in-dropdown auth form (and its remount/outside-click
   race patches) is gone — the modal owns the form. */

import { escapeHtml } from './lib/escape.js';
import {
  getCompetitionState,
  continueAsGuest,
  signOut,
  isSupabaseConfigured,
  setGuestHandle,
} from './competition.js';
import { openAuth } from './auth-modal.js';
import { promptHandle } from './components/handle-prompt.js';

export function initToolbarAuth(data) {
  const btn = document.getElementById('auth-toolbar-btn');
  const label = document.getElementById('auth-toolbar-label');
  const menu = document.getElementById('auth-toolbar-menu');
  if (!btn || !menu || !label) return;

  function syncLabel() {
    const s = getCompetitionState();
    if (s?.user) {
      // R20 (RC2): prefer the profile username (what the rest of the app shows);
      // fall back to the email local-part. Username-based accounts have a
      // synthetic email, so email-only labels were wrong/mangled for them.
      const name = s.profile?.username || labelFromEmail(s.user.email);
      label.textContent = String(name || 'Account').slice(0, 16);
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
    const s = getCompetitionState();
    // Signed-in → small account popover (Sign out). Everyone else → the modal.
    if (s?.user) {
      if (!menu.hidden) { menu.hidden = true; return; }
      renderAccountMenu(menu, syncLabel);
      menu.hidden = false;
      positionMenu(menu, btn);
    } else {
      menu.hidden = true;
      openAuth('entry');
    }
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

function renderAccountMenu(host, onChange) {
  host.innerHTML = '';
  const s = getCompetitionState();
  const card = document.createElement('div');
  card.className = 'auth-menu-card';
  card.innerHTML = `
    <div class="auth-menu-head">
      <strong>${escapeHtml(s.user?.email || 'Signed in')}</strong>
      <span class="muted">Account</span>
    </div>
    <button class="pick-btn pick-btn-secondary" id="auth-menu-signout" data-testid="auth-menu-signout">Sign out</button>
  `;
  card.querySelector('#auth-menu-signout').addEventListener('click', async () => {
    await signOut();      // fires competition:state-change → main.js repaints the view
    onChange();           // refresh the toolbar label
    host.hidden = true;
  });
  host.appendChild(card);
}

// Exposed for callers that want the guest path with a name prompt (e.g. a
// "Continue as guest" affordance). The auth modal also offers this inline.
export async function startGuest() {
  const handle = await promptHandle();
  if (!handle) return false;
  setGuestHandle(handle);
  continueAsGuest();
  return true;
}

