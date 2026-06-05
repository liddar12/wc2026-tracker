/* my-brackets-view-r12.js — R12b: replaces the legacy bracket-builder with
   a read-only view of "my submitted brackets per pool", using the same
   pw-bracket-tree component that Play Stage 3 and Bracket Live render.

   Behavior:
   - Show the user's pool list (or "Local (not in a pool)" for guests).
   - For the selected pool, render the submitted bracket read-only.
   - If lockState.bracketLocked === false AND the user has a draft or
     submission, surface a "Modify bracket" CTA → /#/play with that pool
     active.
   - Autofill controls (use J5L / Kalshi / Hybrid / Consensus / overwrite)
     stay accessible from a single "Auto-fill" section that mirrors the
     Play Stage 3 surface for power users. */

import { escapeHtml } from '../lib/escape.js';
import { setRoute } from '../state.js';
import { flagFor } from '../components/team-flag.js';
import { helpCard, HELP_COPY } from '../components/help-card.js';
import { renderModelPicker } from '../components/model-picker.js';
import { getActiveModel, MODEL_LABELS, modelToAutofillSource } from '../lib/active-model.js';
import {
  buildR32Seeding,
  computeRounds,
  loadBracketDraft,
  persistBracketDraft,
  ROUND_POINTS,
  isSlotPlaceholder,
} from '../bracket-builder.js';
import {
  loadGroupPicks,
} from '../group-picks-builder.js';
import { normalizeGroupPredictions } from '../group-scoring.js';
import { buildAutofill, mergeAutofillIntoBracket } from '../bracket-autofill.js';
import { getCompetitionState, setActiveGroup, isSupabaseConfigured } from '../competition.js';

export function renderMyBracketsView(root, data, params = {}) {
  if (!data) {
    root.innerHTML = '<p class="loading">Loading bracket…</p>';
    return;
  }
  root.innerHTML = '';
  root.appendChild(helpCard({ ...HELP_COPY.myBrackets, persistKey: 'my-brackets' }));

  const comp = getCompetitionState();
  const pools = comp.groups || [];
  const activePoolId = comp.activeGroup?.id || null;

  root.appendChild(renderPoolSelector(comp, pools, activePoolId));
  root.appendChild(renderModelPicker({
    onChange: () => setRoute('my-brackets', params),
  }));

  // Read-only bracket tree from the active pool's draft
  const draft = loadBracketDraft(activePoolId);
  const picks = normalizeGroupPredictions(loadGroupPicks(activePoolId));
  const r32 = buildR32Seeding(data, { userPicks: picks });
  const rounds = computeRounds(r32, draft, data);

  if (!r32.length) {
    const empty = document.createElement('section');
    empty.className = 'home-card';
    empty.innerHTML = `
      <h2 class="home-card-title">No bracket yet</h2>
      <p class="muted">Build one in <a href="#/play">Play</a> to see it here.</p>
    `;
    root.appendChild(empty);
    return;
  }

  root.appendChild(renderBracketTree(rounds));
  root.appendChild(renderAutofillCard(data, activePoolId, comp));
  root.appendChild(renderModifyCta(comp, activePoolId));
}

function renderPoolSelector(comp, pools, activePoolId) {
  const wrap = document.createElement('section');
  wrap.className = 'home-card';
  wrap.style.marginBottom = '12px';
  const isLocal = !activePoolId;
  wrap.innerHTML = `
    <h2 class="home-card-title">Your pools</h2>
    ${pools.length === 0
      ? '<p class="muted">No pools joined yet. <a href="#/pools">Browse pools</a> or build a Local draft below.</p>'
      : `<select id="mb-pool-select" class="auth-input" data-testid="mb-pool-select">
          <option value="" ${isLocal ? 'selected' : ''}>Local (not in a pool)</option>
          ${pools.map((p) => `<option value="${escapeHtml(p.id)}" ${activePoolId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
        </select>`}
  `;
  wrap.querySelector('#mb-pool-select')?.addEventListener('change', (e) => {
    setActiveGroup(e.target.value || null);
    setRoute('my-brackets', {});
  });
  return wrap;
}

function renderBracketTree(rounds) {
  const wrap = document.createElement('section');
  wrap.className = 'home-card';
  wrap.style.marginBottom = '12px';
  wrap.innerHTML = `<h2 class="home-card-title">Your bracket</h2>`;
  const tree = document.createElement('div');
  tree.className = 'pw-bracket-tree pw-bracket-tree-ro';
  tree.setAttribute('data-testid', 'my-brackets-tree');
  tree.tabIndex = 0;
  tree.setAttribute('role', 'region');
  tree.setAttribute('aria-label', 'Submitted bracket — arrow keys scroll rounds');
  tree.addEventListener('keydown', (e) => {
    const step = 220;
    if (e.key === 'ArrowRight') { tree.scrollLeft += step; e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { tree.scrollLeft -= step; e.preventDefault(); }
    else if (e.key === 'Home') { tree.scrollLeft = 0; e.preventDefault(); }
    else if (e.key === 'End') { tree.scrollLeft = tree.scrollWidth; e.preventDefault(); }
  });
  for (const round of rounds) {
    const col = document.createElement('div');
    col.className = 'pw-bracket-col';
    col.innerHTML = `<h3 class="pw-bracket-col-head">${escapeHtml(round.key)} <span class="muted">${ROUND_POINTS[round.key] || 0}pt</span></h3>`;
    for (const m of round.matches) {
      const a = m.team_a;
      const b = m.team_b;
      const aPicked = m.pick && m.pick === a;
      const bPicked = m.pick && m.pick === b;
      const card = document.createElement('div');
      card.className = 'pw-bracket-card';
      card.innerHTML = `
        <div class="pw-bracket-side ${aPicked ? 'is-picked' : ''}">
          <span class="pw-bracket-flag" aria-hidden="true">${isSlotPlaceholder(a) ? '·' : flagFor(a)}</span>
          <span class="pw-bracket-name">${escapeHtml(a || 'Waiting…')}</span>
        </div>
        <div class="pw-bracket-side ${bPicked ? 'is-picked' : ''}">
          <span class="pw-bracket-flag" aria-hidden="true">${isSlotPlaceholder(b) ? '·' : flagFor(b)}</span>
          <span class="pw-bracket-name">${escapeHtml(b || 'Waiting…')}</span>
        </div>
      `;
      col.appendChild(card);
    }
    tree.appendChild(col);
  }
  wrap.appendChild(tree);
  return wrap;
}

function renderAutofillCard(data, activePoolId, comp) {
  const wrap = document.createElement('section');
  wrap.className = 'home-card';
  wrap.style.marginBottom = '12px';
  const active = getActiveModel();
  const label = MODEL_LABELS[active] || 'Model';
  wrap.innerHTML = `
    <h2 class="home-card-title">Auto-fill empty slots</h2>
    <p class="muted" style="font-size:12px; margin: 0 0 10px;">Fill the unset knockout matches with the active model's picks (${escapeHtml(label)}). Toggle the picker above to swap models.</p>
    <label class="mb-autofill-overwrite" style="display:flex; align-items:center; gap:10px; margin-bottom: 10px;">
      <input type="checkbox" id="mb-autofill-overwrite">
      <span class="muted">Overwrite my current picks too</span>
    </label>
    <button class="pick-btn" id="mb-autofill-run" data-testid="mb-autofill-run">Auto-fill with ${escapeHtml(label)}</button>
    <p id="mb-autofill-msg" class="muted" style="font-size:12px; margin: 8px 0 0;" role="status" aria-live="polite"></p>
  `;
  wrap.querySelector('#mb-autofill-run').addEventListener('click', async () => {
    const overwrite = wrap.querySelector('#mb-autofill-overwrite').checked;
    const msg = wrap.querySelector('#mb-autofill-msg');
    msg.textContent = `Filling with ${label}…`;
    try {
      const source = modelToAutofillSource(active);
      const autofill = buildAutofill(data, source, {});
      const draft = loadBracketDraft(activePoolId);
      draft.picks = mergeAutofillIntoBracket(autofill, draft.picks || {}, overwrite);
      persistBracketDraft(activePoolId, draft);
      msg.textContent = `Filled with ${label}.`;
      setRoute('my-brackets', {}); // repaint
    } catch (err) {
      msg.textContent = err?.message || 'Auto-fill failed';
    }
  });
  return wrap;
}

function renderModifyCta(comp, activePoolId) {
  const wrap = document.createElement('section');
  wrap.className = 'home-card';
  const locked = comp?.lockState?.bracketLocked;
  wrap.innerHTML = `
    <h2 class="home-card-title">Modify your bracket</h2>
    <p class="muted" style="font-size:13px; margin: 0 0 10px;">
      ${locked
        ? `Bracket locked (${escapeHtml(comp?.lockState?.phase || 'locked')}). You can review here but can't change picks until the next unlock window.`
        : `Picks are open — head to Play to change anything. Your bracket auto-saves and can be resubmitted any time before the next phase locks.`}
    </p>
    <button class="pick-btn ${locked ? 'pick-btn-secondary' : ''}" id="mb-modify-cta" ${locked ? 'disabled' : ''} data-testid="mb-modify-cta">
      ${locked ? 'Bracket locked' : 'Modify in Play →'}
    </button>
  `;
  if (!locked) {
    wrap.querySelector('#mb-modify-cta').addEventListener('click', () => {
      setRoute('play', { stage: '1' });
    });
  }
  return wrap;
}

