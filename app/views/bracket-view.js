/* bracket-view.js — projected (model) tournament bracket, vertical card layout.
   Same structural renderer as brackets-live-view but winners come from the
   model's composite gap instead of actual results. Used as the "Projected"
   sub-mode of #/brackets. */
import { flagFor } from '../components/team-flag.js';
import { getFavoriteTeam } from '../favorites.js';
import { openMatchSheet } from '../components/match-sheet.js';
import {
  STAGE_LABELS, STAGE_ORDER,
  resolveSlots, projectWinner, isSlotPlaceholder,
} from '../bracket-resolver.js';

export function renderBracketView(root, data) {
  if (!data) {
    root.innerHTML = '<p class="loading">Loading projected bracket…</p>';
    return;
  }
  const intro = document.createElement('div');
  intro.className = 'home-card';
  intro.style.marginBottom = '12px';
  intro.innerHTML = `
    <h2 class="home-card-title">Projected bracket <span class="home-card-meta muted">model · composite gap</span></h2>
    <p class="muted" style="margin:0;">Round-by-round prediction from the composite (mine + elo + tmv + qual). Tap any node for the model's head-to-head call. Switches to <strong>Live</strong> as real results come in.</p>
  `;
  root.appendChild(intro);

  const scheduleFull = data.scheduleFull || [];
  const knockouts = scheduleFull
    .filter((m) => STAGE_ORDER.includes(m.stage))
    .sort((a, b) => (a.match_number || 0) - (b.match_number || 0));

  if (!knockouts.length) {
    const empty = document.createElement('div');
    empty.className = 'bb-empty';
    empty.textContent = "Knockout bracket isn't loaded yet.";
    root.appendChild(empty);
    return;
  }

  // Resolve every slot. Projected winners come from the model when no actual
  // result exists — chained through resolveSlots's winners map so downstream
  // rounds (R16, QF, etc.) advance the model's choices.
  resolveSlots(knockouts, data, {
    winnerResolver: ({ team_a, team_b }) => projectWinner(data, team_a, team_b),
  });

  for (const stage of STAGE_ORDER) {
    const matches = knockouts.filter((m) => m.stage === stage);
    if (!matches.length) continue;
    root.appendChild(renderStage(stage, matches, data));
  }
}

function renderStage(stage, matches, data) {
  const section = document.createElement('section');
  section.className = 'bb-round';
  const projected = matches.filter((m) => m.projected_winner).length;
  section.innerHTML = `
    <h3>${escapeHtml(STAGE_LABELS[stage] || stage)} <span class="bb-round-meta muted">${projected}/${matches.length} projected</span></h3>
  `;
  const fav = getFavoriteTeam();
  for (const m of matches) {
    const a = m.resolved_team_a;
    const b = m.resolved_team_b;
    const aPicked = m.projected_winner && m.projected_winner === a;
    const bPicked = m.projected_winner && m.projected_winner === b;
    const isPlaceholderA = isSlotPlaceholder(a);
    const isPlaceholderB = isSlotPlaceholder(b);
    const fa = isPlaceholderA ? '·' : flagFor(a);
    const fb = isPlaceholderB ? '·' : flagFor(b);
    const aIsFav = fav && a === fav;
    const bIsFav = fav && b === fav;
    const wrap = document.createElement('div');
    wrap.className = 'bb-pair' + (aIsFav || bIsFav ? ' has-fav' : '');
    wrap.innerHTML = `
      <button class="bb-slot ${aPicked ? 'is-projected' : ''} ${aIsFav ? 'is-fav-slot' : ''}" data-testid="bracket-slot" data-team="${escapeHtml(a || '')}" data-match="${m.match_number}" ${isPlaceholderA ? 'disabled' : ''}>
        <span class="bb-slot-flag">${fa}</span>
        <span>${escapeHtml(a || 'TBD')}</span>
      </button>
      <div class="bb-pair-vs">vs</div>
      <button class="bb-slot ${bPicked ? 'is-projected' : ''} ${bIsFav ? 'is-fav-slot' : ''}" data-testid="bracket-slot" data-team="${escapeHtml(b || '')}" data-match="${m.match_number}" ${isPlaceholderB ? 'disabled' : ''}>
        <span class="bb-slot-flag">${fb}</span>
        <span>${escapeHtml(b || 'TBD')}</span>
      </button>
    `;
    const metaRow = document.createElement('div');
    metaRow.className = 'muted';
    metaRow.style.cssText = 'font-size:11px; margin: 4px 0 8px 4px; display:flex; gap:8px; flex-wrap:wrap;';
    const stamp = m.kickoff_utc
      ? new Date(m.kickoff_utc).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'TBD';
    metaRow.innerHTML = `<span>Match #${m.match_number}</span><span>${escapeHtml(stamp)}</span>`;
    wrap.querySelectorAll('button.bb-slot').forEach((btn) => {
      if (isPlaceholderA || isPlaceholderB) btn.disabled = true;
      btn.addEventListener('click', () => {
        if (isPlaceholderA || isPlaceholderB) return;
        openMatchSheet(data, { teamA: a, teamB: b });
      });
    });
    section.appendChild(wrap);
    section.appendChild(metaRow);
  }
  return section;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
