/* hot-picks-view.js — C3: cross-pool aggregated "hot picks" dashboard.
   Shows the most-picked winner at each tournament stage based on all
   public-pool group_brackets rows. */

import { getCompetitionState } from '../competition.js';
import { flagFor } from '../components/team-flag.js';

const STAGE_LABELS = {
  round_of_32: 'R32',
  round_of_16: 'R16',
  quarterfinals: 'QF',
  semifinals: 'SF',
  final: 'Champion',
};

export async function renderHotPicksView(root, data) {
  root.innerHTML = '<p class="loading">Aggregating public picks…</p>';
  const aggregate = await fetchHotPicks(data);
  root.innerHTML = '';
  if (!aggregate) {
    root.innerHTML = `
      <div class="home-card">
        <h2 class="home-card-title">Hot picks unavailable</h2>
        <p class="muted">Supabase isn't configured yet, or no public pools have brackets submitted.</p>
      </div>`;
    return;
  }

  const header = document.createElement('div');
  header.className = 'home-card';
  header.style.marginBottom = '12px';
  header.innerHTML = `
    <h2 class="home-card-title">Hot picks <span class="muted home-card-meta">${aggregate.totalBrackets} bracket${aggregate.totalBrackets === 1 ? '' : 's'} aggregated</span></h2>
    <p class="muted" style="font-size:13px; margin: 0;">Public consensus across all open pools: where everyone agrees and where opinions diverge.</p>
  `;
  root.appendChild(header);

  // Stage-by-stage top winners
  for (const stage of Object.keys(STAGE_LABELS)) {
    const counts = aggregate.byStage[stage];
    if (!counts || !Object.keys(counts).length) continue;
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const total = entries.reduce((s, [, n]) => s + n, 0);
    const section = document.createElement('section');
    section.className = 'home-card';
    section.style.marginBottom = '10px';
    section.innerHTML = `
      <h3 style="margin: 0 0 8px;">${STAGE_LABELS[stage]}</h3>
      <div class="hot-strip">
        ${entries.map(([team, n]) => `
          <a class="mover-chip" href="#/team/name/${encodeURIComponent(team)}">
            <span class="mover-team">${flagFor(team)} ${escapeHtml(team)}</span>
            <span class="mover-prob">${Math.round((n / total) * 100)}%</span>
            <span class="muted mover-delta">${n} pick${n === 1 ? '' : 's'}</span>
          </a>`).join('')}
      </div>
    `;
    root.appendChild(section);
  }

  // Most divisive: smallest gap between top two
  if (aggregate.divisive?.length) {
    const div = document.createElement('section');
    div.className = 'home-card';
    div.innerHTML = `
      <h3 style="margin: 0 0 8px;">Most divisive matchups</h3>
      <p class="muted" style="font-size:12px; margin: 0 0 8px;">Matchups where public opinion is split closest to 50/50.</p>
      <ul class="hot-divisive">
        ${aggregate.divisive.slice(0, 5).map((d) => `
          <li>
            <span>${flagFor(d.team_a)} ${escapeHtml(d.team_a)} <strong>${d.pct_a}%</strong></span>
            <span class="muted">vs</span>
            <span><strong>${d.pct_b}%</strong> ${escapeHtml(d.team_b)} ${flagFor(d.team_b)}</span>
          </li>`).join('')}
      </ul>
    `;
    root.appendChild(div);
  }
}

async function fetchHotPicks(data) {
  const state = getCompetitionState();
  const client = state?.client;
  if (!client) return null;
  try {
    const { data: pools } = await client.from('groups').select('id').eq('visibility', 'public');
    if (!pools?.length) return null;
    const poolIds = pools.map((p) => p.id);
    const { data: rows } = await client
      .from('group_brackets')
      .select('payload')
      .in('group_id', poolIds);
    if (!rows?.length) return null;
    return aggregate(rows, data);
  } catch (err) {
    console.warn('[hotpicks] fetch failed', err);
    return null;
  }
}

function aggregate(rows, data) {
  const byStage = { round_of_32: {}, round_of_16: {}, quarterfinals: {}, semifinals: {}, final: {} };
  const perMatchup = {};
  const sf = data?.scheduleFull || [];
  const stageByNum = {};
  for (const m of sf) {
    if (m.match_number != null && m.stage) stageByNum[m.match_number] = m.stage;
  }

  let totalBrackets = 0;
  for (const row of rows) {
    const payload = row?.payload;
    if (!payload || typeof payload !== 'object') continue;
    const picks = payload.picks || payload;
    if (!picks || typeof picks !== 'object') continue;
    totalBrackets++;
    for (const [k, p] of Object.entries(picks)) {
      if (!p?.team) continue;
      const stage = stageByNum[k] || 'group_stage';
      if (byStage[stage] != null) {
        byStage[stage][p.team] = (byStage[stage][p.team] || 0) + 1;
      }
      // Per-matchup divisiveness: key by sorted teams
      if (p.team_a && p.team_b) {
        const key = [p.team_a, p.team_b].sort().join('__');
        if (!perMatchup[key]) perMatchup[key] = { team_a: p.team_a, team_b: p.team_b, count_a: 0, count_b: 0 };
        if (p.team === p.team_a) perMatchup[key].count_a++;
        else if (p.team === p.team_b) perMatchup[key].count_b++;
      }
    }
  }

  const divisive = Object.values(perMatchup)
    .filter((m) => m.count_a + m.count_b >= 3)
    .map((m) => {
      const total = m.count_a + m.count_b;
      return {
        ...m,
        pct_a: Math.round((m.count_a / total) * 100),
        pct_b: Math.round((m.count_b / total) * 100),
      };
    })
    .sort((x, y) => Math.abs(x.pct_a - 50) - Math.abs(y.pct_a - 50))
    .slice(0, 10);

  return { byStage, divisive, totalBrackets };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
