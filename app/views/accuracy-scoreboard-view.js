/* accuracy-scoreboard-view.js — E5: cross-pool leaderboard.
   Backed by the Everyone-pool server RPC (every account is auto-joined to the
   Everyone pool, so it IS the cross-pool ranking). The previous version
   queried profiles columns that don't exist in any migration
   (group_stage_correct / group_stage_total / display_name), so its query
   errored on every load and the view could never show anything. */

import { escapeHtml } from '../lib/escape.js';
import { getCompetitionState, fetchLeaderboard, EVERYONE_GROUP_ID } from '../competition.js';

export async function renderAccuracyScoreboardView(root, data) {
  root.innerHTML = '<p class="loading">Loading leaderboard…</p>';
  const state = getCompetitionState();
  if (!state?.client) {
    root.innerHTML = `
      <div class="home-card">
        <h2 class="home-card-title">Leaderboard offline</h2>
        <p class="muted">Sign in to see the global ranking.</p>
      </div>`;
    return;
  }

  let rows = [];
  try {
    rows = await fetchLeaderboard(data, { groupId: EVERYONE_GROUP_ID, limit: 100 });
  } catch (err) {
    console.warn('[leaderboard] failed', err);
  }
  root.innerHTML = '';

  if (!rows?.length) {
    root.innerHTML = `
      <div class="home-card">
        <h2 class="home-card-title">No scores yet</h2>
        <p class="muted">Submit a bracket in Play to enter the global pool — scores appear as matches finish.</p>
      </div>`;
    return;
  }

  const head = document.createElement('div');
  head.className = 'home-card';
  head.style.marginBottom = '12px';
  head.innerHTML = `
    <h2 class="home-card-title">Global leaderboard <span class="muted home-card-meta">Everyone pool</span></h2>
    <p class="muted" style="font-size:13px; margin: 0;">Every player, one ranking — group points (max 84) + knockout points (max 96). Rescored as results land.</p>
  `;
  root.appendChild(head);

  const list = document.createElement('div');
  list.className = 'home-card';
  list.innerHTML = `
    <ol class="accuracy-board">
      ${rows.slice(0, 100).map((row, i) => `
        <li class="accuracy-row">
          <span class="accuracy-rank">${row.rank ?? i + 1}</span>
          <span class="accuracy-name">${escapeHtml(row.username || 'Player')}</span>
          <span class="accuracy-pct"><strong>${row.score ?? 0}</strong> <span class="muted">pts${
            Number.isFinite(row.groupScore) && Number.isFinite(row.knockoutScore)
              ? ` · ${row.groupScore}+${row.knockoutScore}` : ''}</span></span>
        </li>`).join('')}
    </ol>
  `;
  root.appendChild(list);
}
