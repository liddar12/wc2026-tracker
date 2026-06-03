/* model-picker.js — R12b: a 4-chip horizontal picker that surfaces the
   active forecast model. Used at the top of Play (Stage 1/2/3), Bracket
   (Live + Projected), and Settings. Clicking a chip writes to
   wc26.activeModel and dispatches `model:change` so other views can
   repaint without a route change. */

import { MODELS, MODEL_LABELS, getActiveModel, setActiveModel } from '../lib/active-model.js';

export function renderModelPicker(opts = {}) {
  const active = opts.active || getActiveModel();
  const wrap = document.createElement('section');
  wrap.className = 'pw-model-picker';
  wrap.setAttribute('role', 'tablist');
  wrap.setAttribute('aria-label', 'Forecast model');
  wrap.setAttribute('data-testid', 'model-picker');
  wrap.innerHTML = `
    <div class="pw-model-picker-label muted">Model</div>
    <div class="pw-model-picker-chips">
      ${MODELS.map((m) => `
        <button
          type="button"
          role="tab"
          class="pw-model-chip ${m === active ? 'is-active' : ''}"
          data-model="${m}"
          data-testid="model-chip-${m}"
          aria-current="${m === active ? 'page' : 'false'}"
          aria-pressed="${m === active ? 'true' : 'false'}"
        >${MODEL_LABELS[m]}</button>
      `).join('')}
    </div>
  `;
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-model]');
    if (!btn) return;
    const next = btn.dataset.model;
    if (!MODELS.includes(next)) return;
    setActiveModel(next);
    // Update the picker's own visual state immediately so the toggle feels
    // snappy; consumers separately listen for `model:change` to repaint
    // analytics chips, autofill button labels, etc.
    for (const chip of wrap.querySelectorAll('.pw-model-chip')) {
      const isActive = chip.dataset.model === next;
      chip.classList.toggle('is-active', isActive);
      chip.setAttribute('aria-current', isActive ? 'page' : 'false');
      chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
    if (opts.onChange) opts.onChange(next);
  });
  return wrap;
}
