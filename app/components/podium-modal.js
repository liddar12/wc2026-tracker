/* podium-modal.js — R6 T9: champion / runner-up / 3rd-place reveal modal.
   Shown when a complete bracket is opened from Play submit, My Brackets
   entry view, the shared-bracket page, or the resolved Live bracket. */

import { escapeHtml } from '../lib/escape.js';
import { flagFor } from './team-flag.js';
import { createShareLink, tryShareViaNavigator } from '../share-bracket.js';

export function openPodiumModal({ first, second, third, label, onSubmit, picks }) {
  if (!first) return null;

  const overlay = document.createElement('div');
  overlay.className = 'pw-podium-overlay';
  overlay.setAttribute('data-testid', 'podium-modal');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'pw-podium-title');

  const sentence = `In your bracket, ${first} beat ${second || 'the runner-up'} in the final${third ? `, with ${third} in 3rd place` : ''}.`;

  overlay.innerHTML = `
    <div class="pw-podium-card">
      <h2 id="pw-podium-title" class="pw-podium-title">Champion</h2>
      <div class="pw-podium" aria-label="Top three teams">
        <div class="pw-podium-slot pw-podium-slot-2">
          <div class="pw-podium-medal" aria-hidden="true">🥈</div>
          <div class="pw-podium-flag">${second ? flagFor(second) : ''}</div>
          <div class="pw-podium-name">${escapeHtml(second || '—')}</div>
          <div class="pw-podium-block">2nd</div>
        </div>
        <div class="pw-podium-slot pw-podium-slot-1">
          <div class="pw-podium-medal" aria-hidden="true">🥇</div>
          <div class="pw-podium-flag pw-podium-flag-1">${flagFor(first)}</div>
          <div class="pw-podium-name pw-podium-name-1"><strong>${escapeHtml(first)}</strong></div>
          <div class="pw-podium-block pw-podium-block-1">1st</div>
        </div>
        <div class="pw-podium-slot pw-podium-slot-3">
          <div class="pw-podium-medal" aria-hidden="true">🥉</div>
          <div class="pw-podium-flag">${third ? flagFor(third) : ''}</div>
          <div class="pw-podium-name">${escapeHtml(third || '—')}</div>
          <div class="pw-podium-block">3rd</div>
        </div>
      </div>
      <p class="pw-podium-sentence">${escapeHtml(sentence)}</p>
      ${label ? `<p class="muted" style="margin: 4px 0 0; font-size: 12px;">${escapeHtml(label)}</p>` : ''}
      <p class="pw-podium-status" id="pw-podium-status" role="status" aria-live="polite" hidden></p>
      <div class="pw-podium-actions">
        ${onSubmit ? `<button type="button" class="pick-btn" data-action="submit" data-testid="podium-submit">Submit</button>` : ''}
        <button type="button" class="pick-btn pick-btn-secondary" data-action="share" data-testid="podium-share">Share</button>
        <button type="button" class="pick-btn pick-btn-secondary" data-action="close" data-testid="podium-close">Done</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Focus trap
  const focusables = overlay.querySelectorAll('button');
  const first2 = focusables[0];
  first2?.focus();

  function close() {
    overlay.removeEventListener('keydown', onKey);
    overlay.remove();
    document.body.classList.remove('pw-podium-open');
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const f = Array.from(overlay.querySelectorAll('button:not([disabled])'));
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i >= f.length - 1)) { e.preventDefault(); f[0].focus(); }
    }
  }
  overlay.addEventListener('keydown', onKey);

  const statusEl = overlay.querySelector('#pw-podium-status');
  function setStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.hidden = !msg;
    statusEl.dataset.kind = kind || '';
  }

  function fireConfetti() {
    import('../confetti.js').then(({ showConfetti }) => {
      try { showConfetti({ duration: 2200 }); } catch {}
    }).catch(() => {});
  }

  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay) { close(); return; }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'close') return close();
    if (action === 'submit' && onSubmit) {
      // R14: only celebrate on a CONFIRMED submit. Errors keep the modal
      // open with an inline message instead of faking success.
      btn.disabled = true;
      setStatus('Submitting…', 'pending');
      try {
        const res = await onSubmit();
        fireConfetti();
        const msg = (res && res.message) || 'Submitted.';
        setStatus(msg, 'success');
        // Swap the actions to a post-submit state.
        const actions = overlay.querySelector('.pw-podium-actions');
        if (actions) {
          actions.innerHTML = `
            <a class="pick-btn" href="#/my-brackets" data-action="close" data-testid="podium-view-brackets">View My Brackets</a>
            <button type="button" class="pick-btn pick-btn-secondary" data-action="share" data-testid="podium-share">Share</button>
            <button type="button" class="pick-btn pick-btn-secondary" data-action="close" data-testid="podium-close">Done</button>
          `;
        }
      } catch (err) {
        btn.disabled = false;
        setStatus(err?.message || 'Submit failed — try again.', 'error');
      }
      return;
    }
    if (action === 'share') {
      try {
        const url = picks ? await createShareLink(picks, { label: label || 'My WC26 Bracket' }) : location.href;
        const r = await tryShareViaNavigator(url, 'My WC26 Bracket');
        if (r === 'clipboard') setStatus('Share link copied to clipboard.', 'success');
      } catch (err) {
        console.warn('[podium] share failed', err);
        setStatus('Could not generate a share link.', 'error');
      }
    }
  });

  document.body.classList.add('pw-podium-open');

  // R14: when this modal is a pure reveal (no submit action — e.g. viewing an
  // already-submitted bracket), celebrate on open. When it gates a submit,
  // hold the confetti until the submit actually succeeds.
  if (!onSubmit) fireConfetti();

  return { close };
}

