/* my-picks.js — show all user picks vs actual, summary, export. */
import { accuracySummary } from '../predictions.js';
import { allPicks } from '../state.js';

export function renderMyPicks(root, data) {
  const summary = accuracySummary(data);

  const stats = document.createElement('div');
  stats.className = 'stat-cards';
  stats.innerHTML = `
    <div class="stat-card"><div class="num">${summary.userCorrect}/${summary.total}</div><div class="lbl">Your correct</div></div>
    <div class="stat-card"><div class="num">${summary.total ? Math.round(summary.userCorrect / summary.total * 100) : 0}%</div><div class="lbl">Your accuracy</div></div>
    <div class="stat-card"><div class="num">${summary.modelCorrect}/${summary.total}</div><div class="lbl">Model correct</div></div>
    <div class="stat-card"><div class="num">${summary.total ? Math.round(summary.modelCorrect / summary.total * 100) : 0}%</div><div class="lbl">Model accuracy</div></div>
  `;
  root.appendChild(stats);

  const exportRow = document.createElement('div');
  exportRow.style.cssText = 'display:flex; gap:8px; margin: 8px 0 16px;';
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'pick-btn';
  exportBtn.textContent = 'Export picks (JSON)';
  exportBtn.addEventListener('click', () => exportPicks());
  exportRow.appendChild(exportBtn);
  root.appendChild(exportRow);

  if (!summary.items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No picks yet. Tap a matchup to make one.';
    root.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'pick-list';
  for (const item of summary.items) {
    const row = document.createElement('div');
    row.className = 'pick-row-item';

    const choice = item.choice === 'team_a' ? item.team_a
      : item.choice === 'team_b' ? item.team_b
      : 'Draw';
    const stamp = item.match
      ? `Group ${item.match.group || '?'} · model: ${escapeHtml(prettyModel(item.match))}`
      : 'Match no longer in data';

    const resCls = item.userResult === 'correct' ? 'correct' : item.userResult === 'wrong' ? 'wrong' : 'pending';
    const resLabel = item.userResult === 'correct' ? '✓' : item.userResult === 'wrong' ? '✗' : '…';

    row.innerHTML = `
      <div>
        <div><strong>${escapeHtml(item.team_a)}</strong> vs <strong>${escapeHtml(item.team_b)}</strong></div>
        <div class="muted" style="font-size:12px;">Your pick: ${escapeHtml(choice)} · ${stamp}</div>
      </div>
      <div class="res ${resCls}" aria-label="${resCls}">${resLabel}</div>
    `;
    if (item.match) {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        location.hash = `#/matchup/team_a/${encodeURIComponent(item.match.team_a)}/team_b/${encodeURIComponent(item.match.team_b)}`;
      });
    }
    list.appendChild(row);
  }
  root.appendChild(list);
}

function prettyModel(m) {
  if (m.predicted_winner === 'draw_likely') return `draw (${m.win_confidence_pct.toFixed(0)}%)`;
  return `${m.predicted_winner} ${m.win_confidence_pct.toFixed(0)}%`;
}

function exportPicks() {
  const blob = new Blob([JSON.stringify(allPicks(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wc26-picks-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
