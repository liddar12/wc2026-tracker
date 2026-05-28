/* competition-auth-panel.js — auth entry / sign-in / sign-up UI for competition. */

const PANEL_ENTRY = 'entry';
const PANEL_SIGNIN = 'signin';
const PANEL_SIGNUP = 'signup';

export function getDefaultAuthPanelMode(comp) {
  return comp?.client ? PANEL_ENTRY : PANEL_ENTRY;
}

export function renderAuthPanel(section, comp, handlers) {
  const mode = handlers.getPanelMode();
  const joinState = comp.lockState.bracketLocked
    ? `Bracket lock: ${comp.lockState.phase}`
    : 'Bracket open';
  const joinBits = buildJoinNotes(comp);

  if (mode === PANEL_SIGNIN) {
    section.innerHTML = authShell(`
      <h2>Group Competition (Beta)</h2>
      <p class="muted">${escapeHtml(joinState)} · Sign in to sync picks with your private group.</p>
      ${joinBits}
      <div class="auth-grid">
        <input id="comp-username" class="auth-input" placeholder="Username or email" autocomplete="username email" aria-label="Username or email">
        <input id="comp-password" class="auth-input" placeholder="Password" type="password" autocomplete="current-password" aria-label="Password">
      </div>
      <div class="auth-actions">
        <button class="pick-btn" id="comp-signin-submit">Sign In</button>
        <button class="pick-btn pick-btn-secondary" id="comp-back-entry" type="button">Back</button>
      </div>
      <p class="muted" id="comp-msg" role="status" aria-live="polite"></p>
    `);
    section.querySelector('#comp-signin-submit')?.addEventListener('click', handlers.onSignIn);
    section.querySelector('#comp-back-entry')?.addEventListener('click', () => handlers.setPanelMode(PANEL_ENTRY, true));
    return;
  }

  if (mode === PANEL_SIGNUP) {
    section.innerHTML = authShell(`
      <h2>Group Competition (Beta)</h2>
      <p class="muted">${escapeHtml(joinState)} · Create an account to host or join private groups.</p>
      ${joinBits}
      <div class="auth-grid">
        <input id="comp-username" class="auth-input" placeholder="Username or email" autocomplete="username email" aria-label="Username or email">
        <input id="comp-password" class="auth-input" placeholder="Password (8+ characters)" type="password" autocomplete="new-password" aria-label="Password">
      </div>
      <div class="auth-actions">
        <button class="pick-btn" id="comp-signup-submit">Create Account</button>
        <button class="pick-btn pick-btn-secondary" id="comp-back-entry" type="button">Back</button>
      </div>
      <p class="muted" id="comp-msg" role="status" aria-live="polite"></p>
    `);
    section.querySelector('#comp-signup-submit')?.addEventListener('click', handlers.onSignUp);
    section.querySelector('#comp-back-entry')?.addEventListener('click', () => handlers.setPanelMode(PANEL_ENTRY, true));
    return;
  }

  const configNote = comp.client
    ? ''
    : '<p class="muted auth-join-note">Cloud login is not configured on this deploy yet. You can still use guest mode for local picks.</p>';

  section.innerHTML = authShell(`
    <h2>Group Competition (Beta)</h2>
    <p class="muted">${escapeHtml(joinState)} · Sign in to create or join private groups, or continue as a guest.</p>
    ${joinBits}
    ${configNote}
    <div class="auth-actions auth-actions-stack">
      <button class="pick-btn" id="comp-go-signin">Sign In</button>
      <button class="pick-btn" id="comp-go-signup">Create Account</button>
      <button class="pick-btn pick-btn-secondary" id="comp-guest">Continue as Guest</button>
    </div>
    <p class="muted" id="comp-msg" role="status" aria-live="polite"></p>
  `);
  section.querySelector('#comp-go-signin')?.addEventListener('click', () => handlers.setPanelMode(PANEL_SIGNIN, true));
  section.querySelector('#comp-go-signup')?.addEventListener('click', () => handlers.setPanelMode(PANEL_SIGNUP, true));
  section.querySelector('#comp-guest')?.addEventListener('click', handlers.onGuest);
}

export function renderGuestBanner(section, comp, handlers) {
  const joinBits = buildJoinNotes(comp);
  section.innerHTML = authShell(`
    <h2>Group Competition (Beta)</h2>
    <p class="muted">Guest mode is on. Your picks stay on this device until you sign in.</p>
    ${joinBits}
    <div class="auth-actions">
      <button class="pick-btn" id="comp-show-auth">Sign In</button>
      <button class="pick-btn" id="comp-show-signup">Create Account</button>
    </div>
  `);
  section.querySelector('#comp-show-auth')?.addEventListener('click', () => {
    handlers.clearGuestDismiss();
    handlers.setPanelMode(PANEL_SIGNIN, true);
  });
  section.querySelector('#comp-show-signup')?.addEventListener('click', () => {
    handlers.clearGuestDismiss();
    handlers.setPanelMode(PANEL_SIGNUP, true);
  });
}

export { PANEL_ENTRY, PANEL_SIGNIN, PANEL_SIGNUP };

function buildJoinNotes(comp) {
  const parts = [];
  if (comp.activeCode) {
    parts.push(`<p class="muted auth-join-note">Invite code <span class="auth-join-code">${escapeHtml(comp.activeCode)}</span> is ready — sign in to join.</p>`);
  } else if (comp.invalidJoinCode) {
    parts.push(`<p class="muted auth-join-note">Invite code <span class="auth-join-code">${escapeHtml(comp.invalidJoinCode)}</span> is invalid. Expected format: <span class="auth-join-code">silver-otter-4821</span>.</p>`);
  }
  if (comp.joinNotice) {
    parts.push(`<p class="muted auth-join-note">${escapeHtml(comp.joinNotice)}</p>`);
  }
  return parts.join('');
}

function authShell(inner) {
  return `<div class="auth-card">${inner}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
