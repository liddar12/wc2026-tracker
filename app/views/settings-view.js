/* settings-view.js — canonical place for user preferences.
   Route: /#/settings  (accessed via the gear icon in the app header)
   - Favorite team picker (with live search)
   - Theme override (light / dark / auto)
   - Reduce motion toggle (overrides OS preference)
   - Account section (when signed in): username, sign out
*/

import { setRoute } from '../state.js';
import { flagFor } from '../components/team-flag.js';
import { getFavoriteTeam, setFavoriteTeam, allTeamNames } from '../favorites.js';
import { getCompetitionState, signOut, isSupabaseConfigured } from '../competition.js';

const LS_REDUCE_MOTION = 'wc26.prefs.reduceMotion';

export function renderSettingsView(root, data) {
  root.innerHTML = '';

  // --- Favorite team
  root.appendChild(renderFavoriteCard(data));

  // --- Theme
  root.appendChild(renderThemeCard());

  // --- Motion
  root.appendChild(renderMotionCard());

  // --- Account (when supabase is configured)
  if (isSupabaseConfigured()) {
    root.appendChild(renderAccountCard());
  }

  // --- R12: Reset app data
  root.appendChild(renderResetCard());

  // Back to Home
  const back = document.createElement('div');
  back.className = 'home-card-cta';
  back.style.margin = '14px 0';
  back.innerHTML = `<button class="pick-btn pick-btn-secondary" id="settings-back">← Back to Home</button>`;
  back.querySelector('#settings-back').addEventListener('click', () => setRoute('home', {}));
  root.appendChild(back);
}

function renderFavoriteCard(data) {
  const card = document.createElement('section');
  card.className = 'home-card';
  card.style.marginBottom = '12px';
  const current = getFavoriteTeam();
  const teams = allTeamNames(data);
  card.innerHTML = `
    <h2 class="home-card-title">Favorite team</h2>
    <p class="muted" style="margin:0 0 10px; font-size:13px;">Defaults the Matches and Groups tabs to your team. Highlights their matches in lists and the bracket. Recolors the app accent.</p>
    <div class="settings-current">
      ${current ? `
        <span class="flag" style="font-size:24px;">${flagFor(current)}</span>
        <strong style="font-size:16px;">${escapeHtml(current)}</strong>
        <button class="pick-btn pick-btn-secondary" id="settings-clear-fav" style="margin-left:auto;">Clear</button>
      ` : `<span class="muted">No team selected</span>`}
    </div>
    <input id="settings-fav-search" type="search" placeholder="Search teams…" class="auth-input" style="margin-top:10px;">
    <div class="settings-team-grid" id="settings-team-grid" role="listbox">
      ${teams.map((t) => `
        <button type="button" class="settings-team-chip ${t === current ? 'is-current' : ''}" data-team="${escapeHtml(t)}">
          <span class="flag" aria-hidden="true">${flagFor(t)}</span>
          <span>${escapeHtml(t)}</span>
        </button>
      `).join('')}
    </div>
  `;
  if (current) {
    card.querySelector('#settings-clear-fav').addEventListener('click', () => {
      setFavoriteTeam(null);
      renderSettingsView(card.parentElement, data);  // soft re-render
    });
  }
  const search = card.querySelector('#settings-fav-search');
  const grid = card.querySelector('#settings-team-grid');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    grid.querySelectorAll('.settings-team-chip').forEach((chip) => {
      const name = chip.dataset.team.toLowerCase();
      chip.hidden = q && !name.includes(q);
    });
  });
  grid.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-team]');
    if (!chip) return;
    setFavoriteTeam(chip.dataset.team);
    renderSettingsView(card.parentElement, data);
  });
  return card;
}

function renderThemeCard() {
  const card = document.createElement('section');
  card.className = 'home-card';
  card.style.marginBottom = '12px';
  const current = (() => {
    try { return localStorage.getItem('wc26.theme') || 'auto'; } catch { return 'auto'; }
  })();
  card.innerHTML = `
    <h2 class="home-card-title">Theme</h2>
    <div class="settings-radio-group">
      ${['auto', 'light', 'dark'].map((t) => `
        <label class="settings-radio ${current === t ? 'is-active' : ''}">
          <input type="radio" name="settings-theme" value="${t}" ${current === t ? 'checked' : ''}>
          <span>${t === 'auto' ? 'Match system' : t === 'light' ? 'Light' : 'Dark'}</span>
        </label>
      `).join('')}
    </div>
  `;
  card.addEventListener('change', (e) => {
    const v = e.target?.value;
    if (!v) return;
    try { localStorage.setItem('wc26.theme', v); } catch {}
    applyTheme(v);
    // visually update active state without full re-render
    card.querySelectorAll('.settings-radio').forEach((r) => r.classList.toggle('is-active', r.querySelector('input').value === v));
  });
  return card;
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light') root.setAttribute('data-theme', 'light');
  else if (theme === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
}

function renderMotionCard() {
  const card = document.createElement('section');
  card.className = 'home-card';
  card.style.marginBottom = '12px';
  const reduceMotion = (() => {
    try { return localStorage.getItem(LS_REDUCE_MOTION) === '1'; } catch { return false; }
  })();
  card.innerHTML = `
    <h2 class="home-card-title">Motion</h2>
    <label class="settings-toggle">
      <span>
        <strong style="font-size:14px;">Reduce motion</strong>
        <div class="muted" style="font-size:12px;">Skip pulse, fade, and reveal animations. Overrides OS setting.</div>
      </span>
      <input type="checkbox" id="settings-reduce-motion" ${reduceMotion ? 'checked' : ''}>
    </label>
  `;
  card.querySelector('#settings-reduce-motion').addEventListener('change', (e) => {
    const on = !!e.target.checked;
    try { localStorage.setItem(LS_REDUCE_MOTION, on ? '1' : '0'); } catch {}
    document.documentElement.classList.toggle('wc-reduce-motion', on);
  });
  return card;
}

function renderAccountCard() {
  const card = document.createElement('section');
  card.className = 'home-card';
  card.style.marginBottom = '12px';
  const comp = getCompetitionState();
  const user = comp?.user;
  card.innerHTML = `
    <h2 class="home-card-title">Account</h2>
    ${user ? `
      <p class="muted" style="font-size:13px; margin:0 0 10px;">Signed in as <strong>${escapeHtml(comp.profile?.username || user.email || 'user')}</strong></p>
      <button class="pick-btn pick-btn-secondary" id="settings-signout">Sign out</button>
    ` : `
      <p class="muted" style="font-size:13px; margin:0 0 10px;">Not signed in. Sign in from My Picks to create or join pools.</p>
      <button class="pick-btn" id="settings-go-signin">Sign in</button>
    `}
  `;
  if (user) {
    card.querySelector('#settings-signout').addEventListener('click', async () => {
      try { await signOut(); setRoute('home', {}); } catch {}
    });
  } else {
    card.querySelector('#settings-go-signin').addEventListener('click', () => setRoute('picks', {}));
  }
  return card;
}

// R12: "Reset app data" — wipes every wc26.* + sb-* key, then reloads the
// page. Used as an escape hatch when stale localStorage from a prior deploy
// is causing login/log-off/pool-create issues that don't repro in private
// browsing.
function renderResetCard() {
  const card = document.createElement('section');
  card.className = 'home-card';
  card.style.marginBottom = '12px';
  card.innerHTML = `
    <h2 class="home-card-title">Reset app data</h2>
    <p class="muted" style="margin:0 0 10px; font-size:13px;">Clears every local pick, draft, preference, and auth session in this browser. Use this only if you're seeing strange behavior that doesn't go away on sign out.</p>
    <button class="pick-btn pick-btn-secondary" id="settings-reset-btn" data-testid="settings-reset">Reset everything</button>
    <p id="settings-reset-status" class="muted" style="margin: 10px 0 0; font-size:12px;" aria-live="polite"></p>
  `;
  card.querySelector('#settings-reset-btn').addEventListener('click', async () => {
    const status = card.querySelector('#settings-reset-status');
    if (!confirm('This will clear all your picks, drafts, and sign-in state in this browser. Continue?')) return;
    try {
      const { fullReset } = await import('../lib/version-purge.js');
      const r = fullReset();
      status.textContent = `Cleared ${r.removed.length} keys. Reloading…`;
      setTimeout(() => location.reload(), 500);
    } catch (err) {
      status.textContent = `Reset failed: ${err?.message || err}`;
    }
  });
  return card;
}

// Apply on load so the toggles take effect even without visiting the page.
export function initSettingsPrefs() {
  try {
    const t = localStorage.getItem('wc26.theme');
    if (t) applyTheme(t);
    const rm = localStorage.getItem(LS_REDUCE_MOTION) === '1';
    if (rm) document.documentElement.classList.add('wc-reduce-motion');
  } catch {}
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
