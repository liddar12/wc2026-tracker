/* referee.js — Referee section with name, nationality, confederation and bias indicators. */
import { escapeHtml } from '../lib/escape.js';
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

  const confed = (ref.confederation || '').trim();
  const matches = ref.stats?.matches_officiated;
  const header = document.createElement('div');
  header.className = 'ref-header';
  header.innerHTML = `
    <div><strong>${escapeHtml(ref.name || '?')}</strong></div>
    <div class="muted" style="font-size:12px;">
      ${escapeHtml(ref.nationality || '?')}${confed ? ` · ${escapeHtml(confed)}` : ''}
      ${matches ? ` · ${escapeHtml(String(matches))} matches officiated` : ''}
    </div>
  `;
  sec.appendChild(header);

  // Team history bias — compute both sides once so we can collapse the common
  // pre-tournament state (assigned ref, no history vs either team) into a single
  // honest note instead of two bare "No prior matches" cards.
  const lookup = buildTeamConfedLookup(data.teams || {});
  const hA = teamHistory(ref.history, match.team_a);
  const hB = teamHistory(ref.history, match.team_b);
  if (!hA.n && !hB.n) {
    const note = document.createElement('p');
    note.className = 'muted ref-bias-empty';
    note.setAttribute('data-testid', 'ref-history-empty');
    note.textContent = 'No prior-match history yet — bias indicators appear once history is populated.';
    sec.appendChild(note);
  } else {
    const biases = document.createElement('div');
    biases.className = 'ref-biases';
    biases.appendChild(biasCard(match.team_a, hA));
    biases.appendChild(biasCard(match.team_b, hB));
    sec.appendChild(biases);
  }

  // Confederation lean
  const lean = confederationLean(ref.history, confed, lookup);
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
  const plain = plainLanguageLine(h.cards_delta_pct);
  card.innerHTML = `
    <div class="bias-team">${escapeHtml(team)} <span class="upset-badge sev-${conf === 'high' ? 'low' : conf === 'medium' ? 'medium' : 'high'}" style="margin-left:6px;">${escapeHtml(conf)} (n=${h.n})</span></div>
    ${plain ? `<div class="bias-plain muted" style="font-size:12px;">${plain}</div>` : ''}
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

/* Plain-language "% vs average" line shown above the σ rows so casual fans get a
   readable take while power users still get the std line. Returns escaped HTML
   or '' when the delta isn't a finite number (the σ rows still render). */
function plainLanguageLine(cardsDeltaPct) {
  if (typeof cardsDeltaPct !== 'number' || !isFinite(cardsDeltaPct)) return '';
  const mag = Math.abs(cardsDeltaPct);
  if (mag < 5) return 'Gives about an average number of cards.';
  const dir = cardsDeltaPct >= 0 ? 'more' : 'fewer';
  return `Gives ~${escapeHtml(mag.toFixed(0))}% ${escapeHtml(dir)} cards than average.`;
}

