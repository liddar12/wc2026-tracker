/* group-picker-view.js — predict each FIFA group's final order (1-4) plus the
   8 best 3rd-place qualifiers. Drag-to-reorder per group via Sortable.js.
   Persists per-pool in localStorage; submission to Supabase comes in B2. */

import Sortable from 'https://esm.sh/sortablejs@1.15.2';
import { setRoute } from '../state.js';
import { flagFor } from '../components/team-flag.js';
import {
  getCompetitionState,
  isSupabaseConfigured,
  setActiveGroup,
  saveGroupPredictionsForActiveGroup,
} from '../competition.js';
import { normalizeGroupPredictions, MAX_GROUP_SCORE, GROUP_POINTS } from '../group-scoring.js';

const LS_KEY_PREFIX = 'wc26.grouppicks.';
const GROUPS = ['A','B','C','D','E','F','G','H','I','J','K','L'];

export function renderGroupPickerView(root, data) {
  if (!data) {
    root.innerHTML = '<p class="loading">Loading group picker…</p>';
    return;
  }
  root.innerHTML = '';
  const comp = getCompetitionState();
  const key = currentDraftKey(comp);
  const picks = normalizeGroupPredictions(loadPicks(key));

  // Header
  root.appendChild(renderHeader(comp));

  if (comp.lockState?.bracketLocked) {
    const lock = document.createElement('div');
    lock.className = 'bb-locked-banner';
    lock.textContent = `Group picks locked: ${comp.lockState.phase}. You can review but not change.`;
    root.appendChild(lock);
  }

  // Intro card
  const intro = document.createElement('div');
  intro.className = 'home-card';
  intro.style.marginBottom = '12px';
  intro.innerHTML = `
    <h2 class="home-card-title">Predict the group stage</h2>
    <p class="muted" style="margin:0 0 6px;">Drag teams to set 1st → 4th in each of the 12 groups. Then pick the 8 best 3rd-place teams that advance to the Round of 32.</p>
    <p class="muted" style="margin:0;">Scoring: <strong>1st = ${GROUP_POINTS.first}pt</strong> · <strong>2nd = ${GROUP_POINTS.second}pt</strong> · <strong>correct best-3rd = ${GROUP_POINTS.third}pt</strong> · max <strong>${MAX_GROUP_SCORE}</strong> pts.</p>
  `;
  root.appendChild(intro);

  // For each group, a sortable list
  for (const g of GROUPS) {
    const gm = data.groupMatchups?.[g];
    if (!gm) continue;
    const currentOrder = (picks.groups[g] && picks.groups[g].length === 4)
      ? picks.groups[g]
      : projectedOrder(gm);
    root.appendChild(renderGroupCard(g, currentOrder, picks, key, () => renderGroupPickerView(root, data), comp));
  }

  // Best-thirds selector
  root.appendChild(renderBestThirdsCard(picks, data, key, () => renderGroupPickerView(root, data), comp));

  // Submit bar
  root.appendChild(renderSubmitBar(comp, picks, data, () => renderGroupPickerView(root, data)));
}

function projectedOrder(gm) {
  // Sort by sum of expected_points across the team's 3 matches.
  const acc = Object.fromEntries((gm.teams || []).map((t) => [t, 0]));
  for (const m of (gm.matches || [])) {
    const ep = m.expected_points || {};
    if (acc[m.team_a] != null) acc[m.team_a] += (ep.team_a || 0);
    if (acc[m.team_b] != null) acc[m.team_b] += (ep.team_b || 0);
  }
  return Object.entries(acc).sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

function renderHeader(comp) {
  const wrap = document.createElement('section');
  wrap.className = 'home-section';
  const groups = comp.groups || [];
  const activeId = comp.activeGroup?.id || '';
  const opts = groups.length
    ? `<select id="gp-pool-select" class="auth-input"><option value="">Local (not submitted to a pool)</option>${groups.map((g) => `<option value="${escapeHtml(g.id)}" ${activeId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}</select>`
    : '<p class="muted">No pools yet. <a href="#/pools">Browse public pools</a> or <a href="#/create-group">create your own</a>.</p>';
  wrap.innerHTML = `
    <div class="home-card">
      <h2 class="home-card-title">Group predictions</h2>
      <label class="muted" style="font-size:12px;" for="gp-pool-select">Submitting to</label>
      ${opts}
    </div>
  `;
  wrap.addEventListener('change', (e) => {
    if (e.target?.id === 'gp-pool-select') setActiveGroup(e.target.value);
  });
  return wrap;
}

function renderGroupCard(letter, order, picks, key, onChange, comp) {
  const section = document.createElement('section');
  section.className = 'bb-round gp-group';
  const locked = !!comp.lockState?.bracketLocked;
  section.innerHTML = `
    <h3>Group ${letter} <span class="bb-round-meta muted">Drag to reorder</span></h3>
    <ol class="gp-list" id="gp-list-${letter}" data-group="${letter}">
      ${order.map((t, i) => gpRow(t, i, locked)).join('')}
    </ol>
  `;
  const list = section.querySelector('.gp-list');
  const oldOrderSnapshot = [...order];   // captured before any drag
  if (!locked) {
    Sortable.create(list, {
      animation: 180,
      delay: 200,
      delayOnTouchOnly: true,
      handle: '.gp-handle',
      ghostClass: 'gp-ghost',
      onEnd: () => {
        const newOrder = Array.from(list.querySelectorAll('[data-team]')).map((el) => el.dataset.team);
        const prevOrder = picks.groups[letter] || oldOrderSnapshot;
        // Slots 0 and 1 feed R32 seeding ("1A" / "2A"). If neither moved,
        // no cascade — silent update.
        const qualifyingChanged = prevOrder[0] !== newOrder[0] || prevOrder[1] !== newOrder[1];
        const r32Count = qualifyingChanged ? countR32PicksForActivePool(comp) : 0;

        const apply = () => {
          picks.groups[letter] = newOrder;
          persistPicks(key, picks);
          if (qualifyingChanged && r32Count > 0) clearR32PicksForActivePool(comp);
          // Refresh position badges in place
          Array.from(list.querySelectorAll('.gp-row')).forEach((row, idx) => {
            const badge = row.querySelector('.gp-position');
            if (badge) badge.textContent = positionLabel(idx);
            row.classList.toggle('is-1st', idx === 0);
            row.classList.toggle('is-2nd', idx === 1);
            row.classList.toggle('is-3rd', idx === 2);
            row.classList.toggle('is-4th', idx === 3);
          });
        };

        if (qualifyingChanged && r32Count > 0) {
          const msg = `This changes who advances from Group ${letter}. ${r32Count} of your R32 pick${r32Count === 1 ? '' : 's'} may no longer match — they will be cleared. Continue?`;
          if (!confirm(msg)) {
            // Revert the visual reorder
            revertOrder(list, prevOrder);
            return;
          }
        }
        apply();
      },
    });
  }
  return section;
}

function revertOrder(list, order) {
  // Reorder DOM children to match the given team-name sequence.
  const byTeam = {};
  Array.from(list.children).forEach((el) => {
    const t = el.dataset.team;
    if (t) byTeam[t] = el;
  });
  for (const team of order) {
    const el = byTeam[team];
    if (el) list.appendChild(el);
  }
  // Re-stamp position classes/badges
  Array.from(list.querySelectorAll('.gp-row')).forEach((row, idx) => {
    const badge = row.querySelector('.gp-position');
    if (badge) badge.textContent = positionLabel(idx);
    row.classList.toggle('is-1st', idx === 0);
    row.classList.toggle('is-2nd', idx === 1);
    row.classList.toggle('is-3rd', idx === 2);
    row.classList.toggle('is-4th', idx === 3);
  });
}

function countR32PicksForActivePool(comp) {
  const bracketKey = comp.activeGroup?.id
    ? `wc26.mybrackets.${comp.activeGroup.id}`
    : 'wc26.mybrackets.local';
  try {
    const raw = localStorage.getItem(bracketKey);
    if (!raw) return 0;
    const bracket = JSON.parse(raw);
    if (!bracket?.picks || typeof bracket.picks !== 'object') return 0;
    return Object.keys(bracket.picks).filter((n) => {
      const num = Number(n);
      return Number.isFinite(num) && num >= 73 && num <= 88;
    }).length;
  } catch { return 0; }
}

function clearR32PicksForActivePool(comp) {
  const bracketKey = comp.activeGroup?.id
    ? `wc26.mybrackets.${comp.activeGroup.id}`
    : 'wc26.mybrackets.local';
  try {
    const raw = localStorage.getItem(bracketKey);
    if (!raw) return;
    const bracket = JSON.parse(raw);
    if (!bracket?.picks) return;
    // Clear R32 + all downstream rounds since their feeders moved.
    for (const n of Object.keys(bracket.picks)) {
      const num = Number(n);
      if (Number.isFinite(num) && num >= 73 && num <= 104) {
        delete bracket.picks[n];
      }
    }
    localStorage.setItem(bracketKey, JSON.stringify(bracket));
  } catch {}
}

function gpRow(team, idx, locked) {
  const cls = idx === 0 ? 'is-1st' : idx === 1 ? 'is-2nd' : idx === 2 ? 'is-3rd' : 'is-4th';
  return `
    <li class="gp-row ${cls}" data-team="${escapeHtml(team)}">
      <span class="gp-position">${positionLabel(idx)}</span>
      <span class="gp-flag">${flagFor(team)}</span>
      <span class="gp-name">${escapeHtml(team)}</span>
      ${locked ? '' : '<span class="gp-handle" aria-hidden="true">⋮⋮</span>'}
    </li>
  `;
}

function positionLabel(idx) {
  return ['1st', '2nd', '3rd', '4th'][idx] || `${idx + 1}th`;
}

function renderBestThirdsCard(picks, data, key, onChange, comp) {
  const section = document.createElement('section');
  section.className = 'bb-round';
  const thirds = currentThirdsList(picks, data);
  const chosen = new Set(picks.best_thirds || []);
  const remaining = 8 - chosen.size;
  const locked = !!comp.lockState?.bracketLocked;
  section.innerHTML = `
    <h3>Pick 8 best 3rd-place teams <span class="bb-round-meta muted">${chosen.size} / 8 selected</span></h3>
    <p class="muted" style="font-size:12px; margin: 0 0 8px;">These are your 3rd-place teams from each group. Tap to mark which 8 will qualify for the Round of 32.</p>
    <div class="gp-thirds">
      ${thirds.map((row) => `
        <label class="gp-third ${chosen.has(row.team) ? 'is-chosen' : ''}">
          <input type="checkbox" data-team="${escapeHtml(row.team)}" ${chosen.has(row.team) ? 'checked' : ''} ${locked ? 'disabled' : ''}>
          <span class="gp-flag">${flagFor(row.team)}</span>
          <span class="gp-name">${escapeHtml(row.team)}</span>
          <span class="muted">(${row.group})</span>
        </label>
      `).join('')}
    </div>
  `;
  if (!locked) {
    section.addEventListener('change', (e) => {
      const input = e.target.closest('input[type="checkbox"][data-team]');
      if (!input) return;
      const team = input.dataset.team;
      if (input.checked) {
        if (chosen.size >= 8) {
          input.checked = false;
          return;
        }
        chosen.add(team);
      } else {
        chosen.delete(team);
      }
      picks.best_thirds = Array.from(chosen);
      persistPicks(key, picks);
      onChange();
    });
  }
  return section;
}

function currentThirdsList(picks, data) {
  // For each group, who is the user's currently-3rd-placed team?
  const out = [];
  for (const g of GROUPS) {
    const gm = data.groupMatchups?.[g];
    if (!gm) continue;
    const order = (picks.groups[g] && picks.groups[g].length === 4)
      ? picks.groups[g]
      : projectedOrder(gm);
    if (order[2]) out.push({ team: order[2], group: g });
  }
  return out;
}

function renderSubmitBar(comp, picks, data, onAfter) {
  const bar = document.createElement('div');
  bar.className = 'bb-submit-bar';
  const allGroupsDone = GROUPS.every((g) => Array.isArray(picks.groups[g]) && picks.groups[g].length === 4);
  const thirdsDone = (picks.best_thirds || []).length === 8;
  const complete = allGroupsDone && thirdsDone;
  const hasGroup = !!comp.activeGroup;
  const locked = comp.lockState?.bracketLocked;
  const reason = !hasGroup ? 'Select a pool above to submit.'
    : !allGroupsDone ? 'Order all 12 groups (1st → 4th) before submitting.'
    : !thirdsDone ? `Pick exactly 8 best 3rd-place teams (currently ${picks.best_thirds?.length || 0}).`
    : locked ? `Locked (${comp.lockState.phase}).`
    : 'Ready to submit.';
  bar.innerHTML = `
    <div>
      <div style="font-weight:700;">${escapeHtml(complete ? 'Predictions complete' : 'In progress')}</div>
      <div class="muted" style="font-size:12px;">${escapeHtml(reason)}</div>
    </div>
    <button class="pick-btn" id="gp-submit" ${(!hasGroup || !complete || locked) ? 'disabled' : ''}>Submit to pool</button>
  `;
  const status = document.createElement('p');
  status.className = 'muted';
  status.style.cssText = 'margin: 8px 0 0; font-size:12px;';
  bar.appendChild(status);
  bar.querySelector('#gp-submit').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      status.textContent = '';
      const score = await saveGroupPredictionsForActiveGroup(picks, data);
      status.textContent = `Group predictions saved. Current score: ${score} / ${MAX_GROUP_SCORE} pts. Edit anytime until lock.`;
    } catch (err) {
      status.textContent = err.message || 'Could not submit group predictions.';
      status.setAttribute('role', 'alert');
    } finally {
      btn.disabled = false;
      btn.setAttribute('aria-busy', 'false');
      onAfter();
    }
  });
  return bar;
}

function currentDraftKey(comp) {
  return comp.activeGroup?.id ? `${LS_KEY_PREFIX}${comp.activeGroup.id}` : `${LS_KEY_PREFIX}local`;
}

function loadPicks(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function persistPicks(key, picks) {
  try { localStorage.setItem(key, JSON.stringify(picks)); } catch {}
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
