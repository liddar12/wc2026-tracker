/* matchup-detail.js — single matchup deep dive with picks.
 *
 * Section order (top to bottom):
 *   1. Header (teams)
 *   2. Model + Market grid (side-by-side ≥720px)
 *   3. Your pick
 *   4. When + where + how to watch
 *   5. Lineups, referee, H2H, form, scorers, weather, travel, xG
 *   6. Final result (when present)
 */
import { confidenceBar } from '../components/confidence-bar.js';
import { marketOddsSection } from '../components/market-odds.js';
import { watchlistStar } from '../components/watchlist-star.js';
import { sectionHeading } from '../components/tooltip.js';
import { upsetBadges } from '../components/upset-badge.js';
import { flagFor } from '../components/team-flag.js';
import { whenWhereWatch } from '../components/when-where-watch.js';
import { lineupsSection } from '../components/lineups.js';
import { refereeSection } from '../components/referee.js';
import { h2hSection } from '../components/h2h.js';
import { formSection } from '../components/form.js';
import { scorersSection } from '../components/scorers.js';
import { weatherSection } from '../components/weather.js';
import { travelRestSection } from '../components/travel-rest.js';
import { xgSection } from '../components/xg.js';
import { setPick, getPick, clearPick } from '../state.js';
import { describePrediction, actualChoice } from '../predictions.js';

export function renderMatchupDetail(root, data, params) {
  const match = findMatch(data.groupMatchups, params.team_a, params.team_b);
  if (!match) {
    root.innerHTML = '<p class="loading">Matchup not found.</p>';
    return;
  }

  const teamA = data.teams[match.team_a];
  const teamB = data.teams[match.team_b];

  // Header
  const header = document.createElement('div');
  header.className = 'match-detail-header';
  const starRow = document.createElement('div');
  starRow.className = 'detail-star-row';
  starRow.appendChild(watchlistStar(match));
  header.appendChild(starRow);
  const teamsRow = document.createElement('div');
  teamsRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;';
  teamsRow.innerHTML = `
    <a class="team-link" href="#/team/name/${encodeURIComponent(match.team_a)}" style="display:flex;align-items:center;gap:8px;">
      <span class="flag" aria-hidden="true" style="font-size:32px;">${flagFor(match.team_a)}</span>
      <strong>${escapeHtml(match.team_a)}</strong>
    </a>
    <span class="muted">vs</span>
    <a class="team-link" href="#/team/name/${encodeURIComponent(match.team_b)}" style="display:flex;align-items:center;gap:8px;">
      <strong>${escapeHtml(match.team_b)}</strong>
      <span class="flag" aria-hidden="true" style="font-size:32px;">${flagFor(match.team_b)}</span>
    </a>
  `;
  header.appendChild(teamsRow);
  const groupLine = document.createElement('div');
  groupLine.className = 'muted';
  groupLine.style.fontSize = '12px';
  groupLine.textContent = `Group ${match.group || teamA?.group || '?'}`;
  header.appendChild(groupLine);
  root.appendChild(header);

  // Model + Market grid
  const grid = document.createElement('div');
  grid.className = 'match-prediction-grid';

  const modelCol = document.createElement('div');
  modelCol.className = 'model-col';
  modelCol.appendChild(confidenceBar(match, { title: 'Model' }));

  const compSec = document.createElement('div');
  compSec.className = 'section model-section';
  compSec.appendChild(sectionHeading('Composite breakdown', 'composite'));
  const compGrid = document.createElement('div');
  compGrid.className = 'composite-grid';
  compGrid.appendChild(compositeCol(teamA, match.composite_a));
  compGrid.appendChild(compositeCol(teamB, match.composite_b));
  compSec.appendChild(compGrid);
  modelCol.appendChild(compSec);

  const reason = document.createElement('div');
  reason.className = 'section model-section';
  reason.innerHTML = `<h2>Why this prediction</h2><p>${escapeHtml(describePrediction(match, data.teams))}</p>`;
  modelCol.appendChild(reason);

  const upsets = document.createElement('div');
  upsets.className = 'section model-section';
  upsets.appendChild(sectionHeading('Upset risk signals', 'upset'));
  const legend = document.createElement('p');
  legend.className = 'upset-legend muted';
  legend.textContent = 'These flag scenarios where the underdog could outperform — not a pick against the favorite.';
  upsets.appendChild(legend);
  upsets.appendChild(upsetBadges(match.upset_risk?.indicators));
  modelCol.appendChild(upsets);

  const marketCol = document.createElement('div');
  marketCol.className = 'market-col';
  marketCol.appendChild(marketOddsSection(match, data.markets));

  grid.append(modelCol, marketCol);
  root.appendChild(grid);

  // Picks (full width below grid)
  const picks = document.createElement('div');
  picks.className = 'section';
  picks.innerHTML = `<h2>Your pick</h2>`;
  picks.appendChild(renderPickRow(match));
  root.appendChild(picks);

  // Phase-2 sections (each renders gracefully when its data is missing).
  root.appendChild(whenWhereWatch(match, data.scheduleFull, data.venues));
  root.appendChild(lineupsSection(match, data.lineups));
  root.appendChild(refereeSection(match, data));
  root.appendChild(h2hSection(match, data.h2h));
  root.appendChild(formSection(match, data.form));
  root.appendChild(scorersSection(match, data.scorers));
  root.appendChild(weatherSection(match, data.scheduleFull, data.weather));
  root.appendChild(travelRestSection(match, data.fatigue));
  root.appendChild(xgSection(match, data.xg));

  // Actual result if known
  const actual = actualChoice(match, data.actualResults);
  if (actual) {
    const res = document.createElement('div');
    res.className = 'section';
    const label = actual === 'team_a' ? `${match.team_a} won`
      : actual === 'team_b' ? `${match.team_b} won`
      : 'Drawn';
    res.innerHTML = `<h2>Final result</h2><p><strong>${escapeHtml(label)}</strong></p>`;
    root.appendChild(res);
  }
}

function renderPickRow(match) {
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'pick-row';

  const current = getPick(match);
  const choices = [
    { key: 'team_a', label: match.team_a },
    { key: 'draw', label: 'Draw' },
    { key: 'team_b', label: match.team_b }
  ];
  for (const c of choices) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pick-btn' + (current?.choice === c.key ? ' is-picked' : '');
    btn.textContent = c.label;
    btn.addEventListener('click', () => {
      const now = getPick(match);
      if (now?.choice === c.key) clearPick(match);
      else setPick(match, c.key);
    });
    row.appendChild(btn);
  }
  wrap.appendChild(row);

  if (current) {
    const meta = document.createElement('p');
    meta.className = 'muted';
    meta.style.fontSize = '12px';
    meta.textContent = `Locked in ${new Date(current.picked_at).toLocaleDateString()} — tap your pick again to clear.`;
    wrap.appendChild(meta);
  }
  return wrap;
}

function compositeCol(team, fallbackComposite) {
  const col = document.createElement('div');
  col.className = 'col';
  const c = team?.composite ?? fallbackComposite;
  const sub = team?.sub_ratings || {};
  col.innerHTML = `
    <h3><span>${escapeHtml(team?.name || '?')}</span><span>${c?.toFixed?.(1) ?? '—'}</span></h3>
    <div class="sub-row"><span>Mine</span><strong>${num(sub.mine)}</strong></div>
    <div class="sub-row"><span>Elo</span><strong>${num(sub.elo_scaled)}</strong></div>
    <div class="sub-row"><span>TMV</span><strong>${num(sub.tmv_scaled)}</strong></div>
    <div class="sub-row"><span>Qual</span><strong>${num(sub.qual_scaled)}</strong></div>
  `;
  return col;
}

function num(v) { return typeof v === 'number' ? v.toFixed(1) : '—'; }

function findMatch(groupMatchups, a, b) {
  if (!a || !b) return null;
  for (const [g, info] of Object.entries(groupMatchups)) {
    for (const m of info.matches) {
      if ((m.team_a === a && m.team_b === b) || (m.team_a === b && m.team_b === a)) {
        return { ...m, group: g };
      }
    }
  }
  return null;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
