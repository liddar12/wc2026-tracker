/* referee.js — Referee section with name, nationality, confederation and bias indicators. */
import { teamHistory, confederationLean, buildTeamConfedLookup } from '../ref-bias.js';

export function refereeSection(match, data) {
  const sec = document.createElement('div');
  sec.className = 'section';
  sec.innerHTML = '<h2>Referee</h2>';

  const matchId = `${match.team_a}__vs__${match.team_b}`;
  const mref = data.matchReferees || {};
  const refs = data.referees || {};
  const rid = mref[matchId] || mref[`${match.team_b}__vs__${match.team_a}`];
  const ref = rid ? refs[rid] : null;

  if (!ref) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Not yet announced — typically confirmed 24–48 h before kickoff.';
    sec.appendChild(p);
    return sec;
  }

  const header = document.createElement('div');
  header.className = 'ref-header';
  header.innerHTML = `
    <div><strong>${escapeHtml(ref.name || '?')}</strong></div>
    <div class="muted" style="font-size:12px;">
      ${escapeHtml(ref.nationality || '?')}${ref.confederation ? ` · ${escapeHtml(ref.confederation)}` : ''}
      ${ref.stats?.matches_officiated ? ` · ${ref.stats.matches_officiated} matches officiated` : ''}
    </div>
  `;
  sec.appendChild(header);

  // Team history bias
  const lookup = buildTeamConfedLookup(data.teams || {});
  const biases = document.createElement('div');
  biases.className = 'ref-biases';
  for (const team of [match.team_a, match.team_b]) {
    const h = teamHistory(ref.history, team);
    biases.appendChild(biasCard(team, h));
  }
  sec.appendChild(biases);

  // Confederation lean
  const lean = confederationLean(ref.history, ref.confederation, lookup);
  if (lean) {
    const wrap = document.createElement('div');
    wrap.className = 'ref-lean';
    const cardsLine = typeof lean.cards_delta_pct === 'number'
      ? renderDeltaSentence('cards', lean.own_confederation, lean.cards_delta_pct)
      : null;
    const pensLine = typeof lean.pens_delta_pct === 'number'
      ? renderDeltaSentence('penalties', lean.own_confederation, lean.pens_delta_pct)
      : null;
    wrap.innerHTML = `
      <h3>Confederation lean</h3>
      ${cardsLine ? `<div>${cardsLine} <span class="upset-badge sev-${lean.confidence === 'high' ? 'low' : lean.confidence === 'medium' ? 'medium' : 'high'}">${escapeHtml(lean.confidence)} conf.</span></div>` : ''}
      ${pensLine ? `<div>${pensLine}</div>` : ''}
      <p class="muted" style="font-size:11px;">n=${lean.own_n} vs n=${lean.other_n} from ref history.</p>
    `;
    sec.appendChild(wrap);
  }

  return sec;
}

function renderDeltaSentence(metric, confed, deltaPct) {
  const dir = deltaPct >= 0 ? 'more' : 'fewer';
  const mag = Math.abs(deltaPct).toFixed(0);
  return `Tends to give <strong>${escapeHtml(mag)}% ${escapeHtml(dir)}</strong> ${escapeHtml(metric)} to ${escapeHtml(confed)} teams.`;
}

function biasCard(team, h) {
  const card = document.createElement('div');
  card.className = 'ref-bias-card';
  if (!h.n) {
    card.innerHTML = `<div class="bias-team">${escapeHtml(team)}</div><div class="muted">No prior matches with this ref.</div>`;
    return card;
  }
  const cardsStd = formatStd(h.z_cards);
  const pensStd = formatStd(h.z_pens);
  const conf = h.confidence;
  card.innerHTML = `
    <div class="bias-team">${escapeHtml(team)} <span class="upset-badge sev-${conf === 'high' ? 'low' : conf === 'medium' ? 'medium' : 'high'}" style="margin-left:6px;">${escapeHtml(conf)} (n=${h.n})</span></div>
    <div class="bias-row"><span>Cards</span><strong>${escapeHtml(cardsStd)} vs avg</strong></div>
    <div class="bias-row"><span>Penalties</span><strong>${escapeHtml(pensStd)} vs avg</strong></div>
  `;
  return card;
}

function formatStd(z) {
  if (z == null || !isFinite(z)) return '—';
  const sign = z >= 0 ? '+' : '−';
  return `${sign}${Math.abs(z).toFixed(1)} std`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
