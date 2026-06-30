/* standings-view.js — RJ30-6: real group standings + qualification scenarios.
   The dedicated destination the Group view links to. Keeps group-view.js's
   projected/model table intact; this view shows the REAL-results table (FINAL-
   gated, FIFA-tiebroken) from app/lib/standings.js plus a "chance to advance"
   column (reusing groupProbabilities), a "what each team needs" panel, and the
   cross-group best-thirds cut. Pure display — no Supabase, no network, no
   scoring writes; re-renders on data:live-refresh like any view.
*/
import { escapeHtml } from '../lib/escape.js';
import { t, fmtNumber } from '../lib/i18n.js';
import { setRoute } from '../state.js';
import { flagFor } from '../components/team-flag.js';
import { emptyState } from '../lib/empty-state.js';
import { currentPhase } from '../lib/phase.js';
import { groupTable, bestThirds, qualificationScenario } from '../lib/standings.js';
import { groupProbabilities } from '../group-monte-carlo.js';

// Resolved at render-time (not import-time) so a language switch re-translates.
// 'out' has no catalog key (kept English/empty as today's '' for unmapped).
function advanceLabel(kind) {
  if (kind === 'auto') return t('standings.advanced');
  if (kind === 'third') return t('standings.bestThird');
  if (kind === 'out') return 'Out';
  return '';
}

export function renderStandingsView(root, data, params) {
  const groups = Object.keys(data.groupMatchups || {}).sort();
  const group = (params && params.group && groups.includes(params.group)) ? params.group : (groups[0] || 'A');
  const info = data.groupMatchups?.[group];
  if (!info) {
    root.innerHTML = '<p class="loading">Group not found.</p>';
    return;
  }

  // Sticky group switcher (mirrors group-view's filter-bar pattern).
  const filter = document.createElement('div');
  filter.className = 'filter-bar standings-filter';
  filter.innerHTML = `
    <label>${escapeHtml(t('standings.group'))}
      <select id="filter-group">
        ${groups.map((g) => `<option value="${g}" ${g === group ? 'selected' : ''}>${escapeHtml(t('standings.group'))} ${g}</option>`).join('')}
      </select>
    </label>
  `;
  filter.querySelector('select').addEventListener('change', (e) => {
    setRoute('standings-group', { group: e.target.value });
  });
  root.appendChild(filter);

  // Phase-aware framing copy.
  const phase = currentPhase(data);
  const table = groupTable(data, group);
  const complete = table.length > 0 && table.every((r) => r.complete);
  const intro = document.createElement('p');
  intro.className = 'muted standings-intro';
  intro.textContent = complete
    ? 'Group stage final — real results with FIFA tiebreakers applied.'
    : (phase.phase === 'pre'
      ? 'All to play — projected from the model until results land.'
      : 'Live partial table — points move only on full-time results.');
  root.appendChild(intro);

  // --- Real standings table -------------------------------------------------
  const probs = complete ? null : groupProbabilities(data, group);
  const section = document.createElement('div');
  section.className = 'section';
  section.innerHTML = `<h2>${escapeHtml(t('standings.heading'))} — ${escapeHtml(t('standings.group'))} ${group}</h2>`;

  const wrap = document.createElement('div');
  wrap.className = 'standings-scroll';
  const tbl = document.createElement('table');
  tbl.className = 'standings standings-real';
  tbl.setAttribute('data-testid', 'group-standings');
  const advCol = complete
    ? '<th class="num" title="Result">Result</th>'
    : '<th class="num" title="Chance to advance">Adv%</th>';
  tbl.innerHTML = `
    <thead><tr>
      <th>#</th><th>${escapeHtml(t('standings.team'))}</th>
      <th class="num" title="Played">Pld</th>
      <th class="num" title="Won">W</th>
      <th class="num" title="Drawn">D</th>
      <th class="num" title="Lost">L</th>
      <th class="num" title="Goals for">GF</th>
      <th class="num" title="Goals against">GA</th>
      <th class="num" title="Goal difference">GD</th>
      <th class="num" title="Points">Pts</th>
      ${advCol}
    </tr></thead>
    <tbody>
      ${table.map((r) => rowHtml(r, probs)).join('')}
    </tbody>
  `;
  wrap.appendChild(tbl);
  section.appendChild(wrap);

  // Tiebreaker footnote — only when a real tie was broken.
  if (hasTie(table)) {
    const foot = document.createElement('p');
    foot.className = 'muted standings-foot';
    foot.textContent = 'Teams level on points are separated by goal difference, then goals scored, then head-to-head (FIFA order).';
    section.appendChild(foot);
  }
  root.appendChild(section);

  // --- What each team needs -------------------------------------------------
  const qual = document.createElement('div');
  qual.className = 'section';
  qual.setAttribute('data-testid', 'qual-scenarios');
  qual.innerHTML = `<h2>What each team needs</h2>`;
  const list = document.createElement('ul');
  list.className = 'scenario-list';
  for (const r of table) {
    const s = qualificationScenario(data, group, r.team);
    const li = document.createElement('li');
    li.className = 'scenario-row';
    li.dataset.status = s.status;
    li.innerHTML = `
      <span class="flag" aria-hidden="true">${flagFor(r.team)}</span>
      <span class="scenario-body">
        <strong>${escapeHtml(r.team)}</strong>
        <span class="muted scenario-needs">${escapeHtml(s.needs)}</span>
      </span>
      <span class="scenario-badge" data-status="${escapeHtml(s.status)}">${escapeHtml(statusLabel(s.status))}</span>
    `;
    list.appendChild(li);
  }
  if (list.children.length) qual.appendChild(list);
  else qual.appendChild(emptyState('No scenarios yet', { detail: 'Fixtures will populate once the group begins.' }));
  root.appendChild(qual);

  // --- Best thirds (cross-group) -------------------------------------------
  const btSec = document.createElement('div');
  btSec.className = 'section';
  btSec.setAttribute('data-testid', 'best-thirds');
  btSec.innerHTML = `<h2>${escapeHtml(t('standings.bestThirds'))}</h2>`;
  const bt = bestThirds(data);
  if (bt.ranked.length) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'Eight of the twelve third-placed teams advance to the Round of 32 (ranked by points, goal difference, goals scored).';
    btSec.appendChild(note);
    const btList = document.createElement('ol');
    btList.className = 'best-thirds-list';
    bt.ranked.forEach((r, i) => {
      const li = document.createElement('li');
      // Draw the 8/9 cutoff with a divider line (not color alone — a11y): the
      // first row at or past the cutoff rank gets the divider above it.
      const cutoff = (i === bt.cutoffRank) ? ' cutoff-after' : '';
      li.className = 'best-third-row' + (r.in ? ' is-in' : ' is-out') + cutoff;
      li.dataset.in = r.in ? 'true' : 'false';
      li.innerHTML = `
        <span class="bt-rank">${i + 1}</span>
        <span class="flag" aria-hidden="true">${flagFor(r.team)}</span>
        <span class="bt-team"><strong>${escapeHtml(r.team)}</strong> <span class="muted">${escapeHtml(t('standings.group'))} ${escapeHtml(r.group)}</span></span>
        <span class="bt-pts num">${r.points} pts</span>
        <span class="bt-status">${r.in ? 'In' : 'Out'}</span>
      `;
      btList.appendChild(li);
    });
    btSec.appendChild(btList);
  } else {
    btSec.appendChild(emptyState('No third-placed teams yet', { detail: 'The cut fills in as groups complete.' }));
  }
  root.appendChild(btSec);
}

function rowHtml(r, probs) {
  const advCell = (r.advanced)
    ? `<td class="num"><span class="adv-badge" data-advanced="${escapeHtml(r.advanced)}">${escapeHtml(advanceLabel(r.advanced))}</span></td>`
    : `<td class="num">${advPct(r, probs)}</td>`;
  return `
    <tr data-rank="${r.rank}">
      <td>${r.rank}</td>
      <td class="team-cell"><a class="team-link" href="#/team/name/${encodeURIComponent(r.team)}"><span class="flag" aria-hidden="true">${flagFor(r.team)}</span> ${escapeHtml(r.team)}</a></td>
      <td class="num">${r.played}</td>
      <td class="num">${r.w}</td>
      <td class="num">${r.d}</td>
      <td class="num">${r.l}</td>
      <td class="num">${r.gf}</td>
      <td class="num">${r.ga}</td>
      <td class="num">${r.gd > 0 ? '+' : ''}${r.gd}</td>
      <td class="num"><strong>${r.points}</strong></td>
      ${advCell}
    </tr>
  `;
}

function advPct(r, probs) {
  const p = probs?.[r.team];
  if (!p || !Number.isFinite(p.pAdvance)) return '—';
  return `${fmtNumber(Math.round(p.pAdvance * 100))}%`;
}

function statusLabel(status) {
  // Resolved at render-time so language switches re-translate. Only the keys
  // present in the catalog are localized; the rest keep today's English copy.
  if (status === 'in-best-third') return t('standings.bestThirdShort');
  if (status === 'eliminated') return t('standings.eliminated');
  return {
    'qualified-1st': 'Qualified 1st',
    'qualified-2nd': 'Qualified 2nd',
    alive: 'Alive',
  }[status] || status;
}

function hasTie(table) {
  for (let i = 1; i < table.length; i++) {
    if (table[i].points === table[i - 1].points) return true;
  }
  return false;
}
