import { escapeHtml } from '../lib/escape.js';
/* handle-prompt.js — R16: the "choose a display name" centered overlay,
   extracted from toolbar-auth.js so both the toolbar and the new auth modal
   (auth-modal.js) can reuse it without an import cycle. */

const LS_LAST_HANDLE = 'wc26.competition.guestHandle';

export function promptHandle() {
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

