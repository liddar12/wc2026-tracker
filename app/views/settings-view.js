/* settings-view.js — canonical place for user preferences.
   Route: /#/settings  (accessed via the gear icon in the app header)
   - Favorite team picker (with live search)
   - Theme override (light / dark / auto)
   - Reduce motion toggle (overrides OS preference)
   - Account section (when signed in): username, sign out
*/

import { escapeHtml } from '../lib/escape.js';
import { setRoute } from '../state.js';
import { t, getLang, setLang } from '../lib/i18n.js';
import { flagFor } from '../components/team-flag.js';
import { getFavoriteTeam, setFavoriteTeam, allTeamNames } from '../favorites.js';
import { getCompetitionState, signOut, isSupabaseConfigured } from '../competition.js';
import { openAuth } from '../auth-modal.js';
import { renderPushCard } from './settings-push-card.js';

const LS_REDUCE_MOTION = 'wc26.prefs.reduceMotion';

export function renderSettingsView(root, data) {
  root.innerHTML = '';

  // --- Favorite team
  root.appendChild(renderFavoriteCard(data));

  // --- RJ30.1-B: Language (en / es). Placed directly under Favorite per spec so
  // the very first preference is "who/what language", before alerts + theme.
  root.appendChild(renderLanguageCard());

  // --- RJ30-3: Match alerts (Web Push). Placed after Favorite so "who" (the
  // team) precedes "alerts" (notifications for that team).
  root.appendChild(renderPushCard(data));

  // --- Theme
  root.appendChild(renderThemeCard());

  // --- Motion
  root.appendChild(renderMotionCard());

  // --- Account (when supabase is configured)
  if (isSupabaseConfigured()) {
    root.appendChild(renderAccountCard());
  }

  // --- R12b: Model & Analytics (default forecast model + backtest summary)
  root.appendChild(renderModelSettingsCard());

  // --- RJ30-12: Pipeline status (utility link, off the tab bar)
  root.appendChild(renderPipelineStatusCard());

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
    <h2 class="home-card-title">${escapeHtml(t('settings.favorite'))}</h2>
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

// RJ30.1-B: Language card — switches the app between English and Spanish (es-MX).
// Reuses the Theme card's .home-card + .settings-radio-group + .settings-radio
// tokens (no new CSS, iOS-first 390px-safe). On change → setLang(value), which
// persists wc26.lang, sets <html lang>, and fires `lang:change`; main.js's
// listener re-localizes the shell + re-renders the current view (incl. this one),
// so no manual re-render is needed here.
function renderLanguageCard() {
  const card = document.createElement('section');
  card.className = 'home-card';
  card.style.marginBottom = '12px';
  card.dataset.testid = 'settings-language';
  const current = getLang();
  const langs = [
    { value: 'en', label: t('settings.english') },
    { value: 'es', label: t('settings.spanish') },
  ];
  card.innerHTML = `
    <h2 class="home-card-title">${escapeHtml(t('settings.language'))}</h2>
    <div class="settings-radio-group">
      ${langs.map((l) => `
        <label class="settings-radio ${current === l.value ? 'is-active' : ''}">
          <input type="radio" name="settings-lang" value="${l.value}" ${current === l.value ? 'checked' : ''}>
          <span>${escapeHtml(l.label)}</span>
        </label>
      `).join('')}
    </div>
  `;
  card.addEventListener('change', (e) => {
    const v = e.target?.value;
    if (!v || (v !== 'en' && v !== 'es')) return;
    // Reflect active state immediately; lang:change will re-render the full view
    // a beat later, but this keeps the radio visually consistent in the interim.
    card.querySelectorAll('.settings-radio').forEach((r) =>
      r.classList.toggle('is-active', r.querySelector('input').value === v));
    setLang(v);
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
    <h2 class="home-card-title">${escapeHtml(t('settings.theme'))}</h2>
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
    <h2 class="home-card-title">${escapeHtml(t('settings.motion'))}</h2>
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
    <h2 class="home-card-title">${escapeHtml(t('settings.account'))}</h2>
    ${user ? `
      <p class="muted" style="font-size:13px; margin:0 0 10px;">Signed in as <strong>${escapeHtml(comp.profile?.username || user.email || 'user')}</strong></p>
      <button class="pick-btn pick-btn-secondary" id="settings-signout">Sign out</button>
    ` : `
      <p class="muted" style="font-size:13px; margin:0 0 10px;">Not signed in. Sign in to create or join pools.</p>
      <button class="pick-btn" id="settings-go-signin">Sign in</button>
    `}
  `;
  if (user) {
    card.querySelector('#settings-signout').addEventListener('click', async () => {
      try { await signOut(); } catch {} // competition:state-change repaints the view
    });
  } else {
    // R16: open the auth lightbox in place instead of dumping the user on the
    // My Picks page (the old dead-end behavior).
    card.querySelector('#settings-go-signin').addEventListener('click', () => openAuth('signin'));
  }
  return card;
}

// R12b: Model & Analytics card — picks the default forecast model and
// exposes a high-level explanation + backtest summary for each. The
// per-page picker (in Play, Bracket, My Brackets) defaults to this value
// when the user hasn't explicitly chosen one this session.
function renderModelSettingsCard() {
  const card = document.createElement('section');
  card.className = 'home-card';
  card.style.marginBottom = '12px';
  // Async load: import the active-model lib + backtest JSON, then render.
  card.innerHTML = `
    <h2 class="home-card-title">${escapeHtml(t('settings.model'))}</h2>
    <p class="muted" style="font-size:13px; margin: 0 0 10px;">Pick which forecast drives Play tile analytics, the Bracket Projected view, and Auto-fill suggestions. You can override per-page from the model picker at the top of each view.</p>
    <div id="settings-model-radios">Loading…</div>
    <details id="settings-model-explain" style="margin-top: 12px;">
      <summary class="muted" style="font-size: 13px; cursor: pointer;">How each model works (+ backtest)</summary>
      <div id="settings-model-explain-body" style="margin-top: 10px;"></div>
    </details>
  `;
  (async () => {
    const { MODELS, MODEL_LABELS, MODEL_DESCRIPTIONS, getDefaultModel, setDefaultModel } = await import('../lib/active-model.js');
    const current = getDefaultModel();
    const radios = card.querySelector('#settings-model-radios');
    radios.innerHTML = MODELS.map((m) => `
      <label class="settings-radio-row" style="display:flex; align-items:center; gap:10px; padding:10px 0; cursor:pointer;">
        <input type="radio" name="settings-default-model" value="${m}" ${m === current ? 'checked' : ''} style="width:20px; height:20px;">
        <span style="font-weight: 600;">${MODEL_LABELS[m]}</span>
      </label>
    `).join('');
    radios.addEventListener('change', (e) => {
      if (e.target.matches('input[name="settings-default-model"]')) {
        setDefaultModel(e.target.value);
      }
    });
    // Load backtest summary
    let backtest = null;
    try {
      const r = await fetch('data/backtest.json', { cache: 'no-store' });
      if (r.ok) backtest = await r.json();
    } catch {}
    const explainBody = card.querySelector('#settings-model-explain-body');
    explainBody.innerHTML = MODELS.map((m) => {
      const desc = MODEL_DESCRIPTIONS[m] || '';
      // Map model id → backtest key (j5l→model, kalshi→market, hybrid→hybrid).
      // Consensus has no historical backtest (it's a current-tournament aggregate).
      const btKey = m === 'j5l' ? 'model' : m === 'dt' ? 'dt' : m === 'kalshi' ? 'market' : m === 'hybrid' ? 'hybrid' : null;
      const wc = btKey && backtest?.wc2022?.[btKey];
      const eu = btKey && backtest?.euro2024?.[btKey];
      // Flag estimates so the picker never presents fabricated numbers as real;
      // only the Euro 2024 market row is measured (Polymarket).
      const tag = (s) => (s && s.measured ? '' : ' est.');
      const wcStr = wc ? `${Math.round((wc.correct / wc.total) * 100)}% (${wc.correct}/${wc.total})${tag(wc)}` : '—';
      const euStr = eu ? `${Math.round((eu.correct / eu.total) * 100)}% (${eu.correct}/${eu.total})${tag(eu)}` : '—';
      return `
        <div class="settings-model-row" style="padding: 10px 0; border-top: 1px solid var(--border);">
          <strong>${escapeHtml(MODEL_LABELS[m])}</strong>
          <p class="muted" style="font-size:12px; margin: 4px 0 6px;">${escapeHtml(desc)}</p>
          ${btKey ? `<p style="font-size:12px; margin:0;">
            <span class="muted">Backtest:</span>
            WC 2022 <strong>${wcStr}</strong>
            · Euro 2024 <strong>${euStr}</strong>
          </p>` : `<p style="font-size:12px; margin:0;" class="muted">No historic backtest (current-tournament aggregate)</p>`}
        </div>
      `;
    }).join('');
    if (backtest?.__meta__?.is_estimate) {
      explainBody.insertAdjacentHTML('beforeend',
        `<p class="muted" style="font-size:11px; margin: 10px 0 0;">Note: backtest figures are seed estimates pending the historical-probability backfill (data/backtest.json __meta__).</p>`);
    }
  })();
  return card;
}

// RJ30-12: Pipeline status — a utility link row (off the tab bar) into the
// #/status data-health view. Kept here, in Settings, so it doesn't add nav
// chrome to the primary tab bar.
function renderPipelineStatusCard() {
  const card = document.createElement('section');
  card.className = 'home-card';
  card.style.marginBottom = '12px';
  card.innerHTML = `
    <h2 class="home-card-title">${escapeHtml(t('settings.pipeline'))}</h2>
    <p class="muted" style="margin:0 0 10px; font-size:13px;">Freshness of each data feed plus any validation warnings — a quick check that the numbers are live.</p>
    <button class="pick-btn pick-btn-secondary" id="settings-pipeline-status" data-testid="settings-pipeline-status">View data health →</button>
  `;
  card.querySelector('#settings-pipeline-status').addEventListener('click', () => setRoute('status', {}));
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

