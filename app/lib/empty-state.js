/* empty-state.js — the empty-state contract. Views must never silently render
   nothing (a blank list reads as a broken page, not "no items"): when a section
   has no data, render emptyState(message) into it instead. Centralizing the
   markup also gives every empty section the same a11y shape (role="status", so
   screen readers announce it once) and the same hook classes for Epic E to
   style. No CSS lives here — this lib only emits class names (.empty-state is
   already styled in styles.css; .empty-state-detail / .empty-state-icon are the
   new hooks Epic E owns).

   This is the DOM-emitting counterpart to the pure helpers in match-status.js /
   phase.js; it stays dependency-free and builds nodes via createElement +
   textContent (no innerHTML), so caller-supplied copy can never inject markup.
*/

/**
 * Build a standard empty-state node.
 * @param {string} message - the primary line (e.g. "No matches scheduled").
 * @param {object} [opts]
 * @param {string} [opts.detail] - an optional second, smaller line of context
 *                                 (e.g. "Check back once the bracket is set").
 * @param {string} [opts.icon]   - an optional leading glyph/emoji (e.g. "⚽").
 * @param {string} [opts.testid] - data-testid override (default 'empty-state').
 * @returns {HTMLElement} a <div class="empty-state" role="status"> node.
 */
export function emptyState(message, opts = {}) {
  const { detail = '', icon = '', testid = 'empty-state' } = opts;

  const el = document.createElement('div');
  el.className = 'empty-state';
  // role="status" + aria-live polite: announced once when inserted, and not
  // re-announced like a persistent .loading region would be.
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('data-testid', testid);

  if (icon) {
    const ico = document.createElement('span');
    ico.className = 'empty-state-icon';
    ico.setAttribute('aria-hidden', 'true');
    ico.textContent = String(icon);
    el.appendChild(ico);
  }

  const primary = document.createElement('p');
  primary.className = 'empty-state-message';
  primary.textContent = String(message ?? '');
  el.appendChild(primary);

  if (detail) {
    const sub = document.createElement('p');
    sub.className = 'empty-state-detail';
    sub.textContent = String(detail);
    el.appendChild(sub);
  }

  return el;
}
