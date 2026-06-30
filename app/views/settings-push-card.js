/* settings-push-card.js — RJ30-3 (RJ30-B). The "Match alerts" opt-in card for
   Settings. Install-gated and honest: on iOS it only offers Enable inside an
   installed PWA, otherwise it shows the Add-to-Home-Screen hint (reusing the
   same copy as install-prompt.js). Guests see a Sign-in CTA. Everyone keeps the
   existing in-app live toasts regardless — push is strictly additive.

   Matches the existing settings cards: <section class="home-card"> +
   settings-toggle rows + pick-btn buttons. Selectors (data-testid) are the
   contract the Playwright UX spec asserts:
     push-card, push-enable, push-disable, push-toggle-goals,
     push-toggle-kickoffs, push-install-hint, push-signin. */

import { escapeHtml } from '../lib/escape.js';
import { getCompetitionState, isSupabaseConfigured } from '../competition.js';
import { openAuth } from '../auth-modal.js';
import { setRoute } from '../state.js';
import { getFavoriteTeam } from '../favorites.js';
import {
  isPushSupported, canSubscribeHere, isInstalledIOSPWA, isIOSSafari,
  isStandalonePWA, permissionState, enablePush, disablePush, getStatus,
  updatePrefs, bindResubscribeListener,
} from '../push.js';

export function renderPushCard(data) {
  const card = document.createElement('section');
  card.className = 'home-card';
  card.style.marginBottom = '12px';
  card.setAttribute('data-testid', 'push-card');
  bindResubscribeListener();
  paint(card, data);
  return card;
}

function header() {
  return `
    <h2 class="home-card-title">Match alerts</h2>
    <p class="muted" style="margin:0 0 10px; font-size:13px;">Get a notification the moment your favorite team scores or kicks off — even with the app closed.</p>
  `;
}

function signedIn() {
  const state = getCompetitionState?.();
  return !!(state && state.user);
}

async function paint(card, data) {
  // 1) Guest gate — push subscriptions are per-user (RLS), so sign-in first.
  if (isSupabaseConfigured() && !signedIn()) {
    card.innerHTML = header() + `
      <p class="muted" style="font-size:13px; margin:0 0 10px;">Sign in to enable match alerts for your team.</p>
      <button class="pick-btn" data-testid="push-signin" id="push-signin">Sign in</button>
    `;
    card.querySelector('#push-signin').addEventListener('click', () => openAuth('signin'));
    return;
  }

  // 2) Unsupported platform / iOS-tab gate — show the install hint.
  if (!isPushSupported() || (isIOSSafari() && !isStandalonePWA()) || !canSubscribeHere()) {
    const iosTab = isIOSSafari() && !isStandalonePWA();
    const reason = iosTab
      ? `Add this app to your home screen to get match alerts. Tap <span class="wc-install-share" aria-hidden="true">⎙</span> then <strong>Add to Home Screen</strong>.`
      : !isPushSupported()
        ? `This browser doesn't support notifications. You'll still see in-app score alerts while the app is open.`
        : `Notifications aren't available here yet. You'll still see in-app score alerts while the app is open.`;
    card.innerHTML = header() + `
      <p class="muted" data-testid="push-install-hint" id="push-install-hint" style="font-size:13px; margin:0;">${reason}</p>
    `;
    return;
  }

  // 3) Permission denied — recovery copy, no auto-reprompt.
  if (permissionState() === 'denied') {
    card.innerHTML = header() + `
      <p class="muted" style="font-size:13px; margin:0;">Notifications are turned off for this app. Enable them in iOS Settings → Notifications → World Cup 2026, then come back.</p>
    `;
    return;
  }

  // 4) Supported + permitted: show enable, or the per-trigger toggles if already on.
  let status = { subscribed: false };
  try { status = await getStatus(); } catch { /* default off */ }

  const fav = getFavoriteTeam();
  const favWarn = !fav
    ? `<p class="muted" id="push-fav-warn" style="font-size:12px; margin:8px 0 0;">Pick a <button type="button" class="link-btn" id="push-pick-fav" style="background:none;border:none;padding:0;color:var(--accent);text-decoration:underline;cursor:pointer;font:inherit;">favorite team</button> to choose who you get alerts for.</p>`
    : `<p class="muted" style="font-size:12px; margin:8px 0 0;">Alerts for <strong>${escapeHtml(fav)}</strong>.</p>`;

  if (!status.subscribed) {
    card.innerHTML = header() + `
      <button class="pick-btn" data-testid="push-enable" id="push-enable">Enable notifications</button>
      ${favWarn}
    `;
    wireFavLink(card, data);
    card.querySelector('#push-enable').addEventListener('click', async () => {
      const btn = card.querySelector('#push-enable');
      btn.disabled = true; btn.textContent = 'Enabling…';
      try {
        await enablePush();
        await paint(card, data); // flip to the toggles
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Enable notifications';
        const msg = /permission-denied/.test(String(e?.message))
          ? 'Notifications were blocked. Enable them in iOS Settings → Notifications.'
          : 'Could not enable notifications. Try again.';
        let note = card.querySelector('#push-error');
        if (!note) {
          note = document.createElement('p');
          note.id = 'push-error'; note.className = 'muted';
          note.style.cssText = 'font-size:12px;margin:8px 0 0;color:var(--danger,#c0392b);';
          card.appendChild(note);
        }
        note.textContent = msg;
      }
    });
    return;
  }

  // Subscribed: per-trigger toggles + disable.
  card.innerHTML = header() + `
    <label class="settings-toggle">
      <span>
        <strong style="font-size:14px;">Goals</strong>
        <div class="muted" style="font-size:12px;">Alert me when my team scores or concedes.</div>
      </span>
      <input type="checkbox" data-testid="push-toggle-goals" id="push-toggle-goals" checked>
    </label>
    <label class="settings-toggle">
      <span>
        <strong style="font-size:14px;">Kickoffs</strong>
        <div class="muted" style="font-size:12px;">Alert me ~15 min before my team kicks off.</div>
      </span>
      <input type="checkbox" data-testid="push-toggle-kickoffs" id="push-toggle-kickoffs" checked>
    </label>
    ${favWarn}
    <button class="pick-btn pick-btn-secondary" data-testid="push-disable" id="push-disable" style="margin-top:10px;">Turn off alerts</button>
  `;
  wireFavLink(card, data);
  card.querySelector('#push-toggle-goals').addEventListener('change', (e) => {
    void updatePrefs({ notify_goals: !!e.target.checked });
  });
  card.querySelector('#push-toggle-kickoffs').addEventListener('change', (e) => {
    void updatePrefs({ notify_kickoffs: !!e.target.checked });
  });
  card.querySelector('#push-disable').addEventListener('click', async () => {
    const btn = card.querySelector('#push-disable');
    btn.disabled = true; btn.textContent = 'Turning off…';
    try { await disablePush(); } catch { /* ignore */ }
    await paint(card, data);
  });
}

function wireFavLink(card, data) {
  const link = card.querySelector('#push-pick-fav');
  if (link) link.addEventListener('click', () => setRoute('settings', {}));
}
