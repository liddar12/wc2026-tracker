/* match-sheet.js — modal sheet showing the matchup-detail content over
   the current page. Preserves scroll on dismiss. Swipe-down or backdrop-
   tap or X dismisses.

   Usage: openMatchSheet(data, { teamA, teamB })
   Falls back to navigating /#/matchup/... when the matchup can't be found
   (e.g. knockout slot placeholder).
*/
import { renderMatchupDetail } from '../views/matchup-detail.js';

let activeSheet = null;

export function openMatchSheet(data, { teamA, teamB }) {
  if (!teamA || !teamB) return;
  if (isPlaceholder(teamA) || isPlaceholder(teamB)) return;
  // Close any existing
  closeMatchSheet();

  const overlay = document.createElement('div');
  overlay.className = 'wc-sheet-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="wc-sheet" role="document">
      <button class="wc-sheet-close" type="button" aria-label="Close">×</button>
      <div class="wc-sheet-handle" aria-hidden="true"></div>
      <div class="wc-sheet-body" id="wc-sheet-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('wc-sheet-open');

  // Render matchup detail into the sheet body
  const body = overlay.querySelector('#wc-sheet-body');
  try {
    renderMatchupDetail(body, data, { team_a: teamA, team_b: teamB });
  } catch (err) {
    body.innerHTML = `<p class="loading">Matchup not found.</p>`;
  }

  requestAnimationFrame(() => overlay.classList.add('is-open'));
  activeSheet = overlay;

  const dismiss = (e) => {
    if (e) e.stopPropagation();
    closeMatchSheet();
  };
  overlay.querySelector('.wc-sheet-close').addEventListener('click', dismiss);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeMatchSheet();
  });

  // Esc key
  const onKey = (e) => { if (e.key === 'Escape') closeMatchSheet(); };
  document.addEventListener('keydown', onKey);
  overlay._cleanupKey = () => document.removeEventListener('keydown', onKey);

  // Touch swipe-down to dismiss
  attachSwipeDown(overlay);
}

export function closeMatchSheet() {
  if (!activeSheet) return;
  const overlay = activeSheet;
  activeSheet = null;
  overlay.classList.remove('is-open');
  if (overlay._cleanupKey) overlay._cleanupKey();
  document.body.classList.remove('wc-sheet-open');
  setTimeout(() => overlay.remove(), 280);
}

function attachSwipeDown(overlay) {
  const sheet = overlay.querySelector('.wc-sheet');
  let startY = null;
  let lastY = null;
  sheet.addEventListener('touchstart', (e) => {
    // Only initiate swipe-down from the top of the sheet (handle area).
    if (sheet.scrollTop > 0) return;
    startY = e.touches[0].clientY;
    lastY = startY;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    lastY = e.touches[0].clientY;
    const dy = Math.max(0, lastY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (startY == null) return;
    const dy = (lastY || startY) - startY;
    sheet.style.transform = '';
    startY = null; lastY = null;
    if (dy > 110) closeMatchSheet();
  });
}

function isPlaceholder(s) {
  if (typeof s !== 'string') return true;
  return /^\d[A-L]$|^3 [A-L]+$|^W\d+$|^L\d+$/.test(s);
}
