/* accuracy-scoreboard-view.js — E5: per-user accuracy leaderboard.
   Aggregates each profile's pick history across all pools and ranks them
   by group-stage accuracy + bracket points where available. */

import { getCompetitionState } from '../competition.js';
import { flagFor } from '../components/team-flag.js';

export async function renderAccuracyScoreboardView(root, data) {
  root.innerHTML = '<p class="loading">Loading leaderboard…</p>';
  const state = getCompetitionState();
  if (!state?.client) {
    root.innerHTML = `
      <div class="home-card">
        <h2 class="home-card-title">Leaderboard offline</h2>
        <p class="muted">Sign in to see the cross-pool accuracy ranking.</p>
      </div>`;
    return;
  }

  let leaderboard = null;
  try {
    leaderboard = await fetchLeaderboard(state.client, data);
  } catch (err) {
    console.warn('[accuracy] failed', err);
  }
  root.innerHTML = '';

  if (!leaderboard?.length) {
    root.innerHTML = `
      <div class="home-card">
        <h2 class="home-card-title">No scores yet</h2>
        <p class="muted">Once the group stage starts and brackets are scored, rankings will appear here.</p>
      </div>`;
    return;
  }

  const head = document.createElement('div');
  head.className = 'home-card';
  head.style.marginBottom = '12px';
  head.innerHTML = `
    <h2 class="home-card-title">Accuracy leaderboard <span class="muted home-card-meta">${leaderboard.length} players</span></h2>
    <p class="muted" style="font-size:13px; margin: 0;">Cross-pool ranking by group-stage accuracy. Brackets are scored after each match.</p>
  `;
  root.appendChild(head);

  const list = document.createElement('div');
  list.className = 'home-card';
  list.innerHTML = `
    <ol class="accuracy-board">
      ${leaderboard.slice(0, 100).map((row, i) => `
        <li class="accuracy-row">
          <span class="accuracy-rank">${i + 1}</span>
          <span class="accuracy-name">${escapeHtml(row.display_name || 'Anonymous')}</span>
          <span class="accuracy-fav">${row.favorite_team ? flagFor(row.favorite_team) : ''}</span>
          <span class="accuracy-pct"><strong>${row.accuracy_pct}%</strong> <span class="muted">${row.correct}/${row.total}</span></span>
        </li>`).join('')}
    </ol>
  `;
  root.appendChild(list);
}

async function fetchLeaderboard(client, data) {
  const { data: profiles } = await client.from('profiles')
    .select('id, display_name, favorite_team, group_stage_correct, group_stage_total');
  if (!profiles?.length) return [];
  return profiles
    .map((p) => ({
      ...p,
      correct: p.group_stage_correct || 0,
      total: p.group_stage_total || 0,
      accuracy_pct: p.group_stage_total ? Math.round((p.group_stage_correct / p.group_stage_total) * 100) : 0,
    }))
    .filter((p) => p.total > 0)
    .sort((a, b) => b.accuracy_pct - a.accuracy_pct || b.total - a.total);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
