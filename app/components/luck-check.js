/* luck-check.js — matchup-page Luck check section.
 *
 * Two parts, both display-only (never feed the model — see app/lib/luck-index.js
 * and docs/LUCK_ANALYSIS.md):
 *   1. "How they got here" — each side's group-stage luck index + top chips,
 *      the same profile the Projected tab's Luck check card shows.
 *   2. "This match" — a live luck ledger for THIS fixture (pens, cards,
 *      own-goal gifts, corner/whistle edges, score vs pre-match xG). It reads
 *      the live-merged in-memory data, so it fills in during the match on
 *      every data:live-refresh re-render — the change-of-luck feed into the
 *      next round. Empty (part hidden) before any signal exists.
 * Returns an empty DocumentFragment when neither team has a luck profile.
 */
import { escapeHtml } from '../lib/escape.js';
import { flagFor } from './team-flag.js';
import { computeLuckIndex, luckChips, matchLuckLedger } from '../lib/luck-index.js';

function teamRow(team, profile) {
  if (!profile) return '';
  const chips = luckChips(profile);
  const tone = profile.index >= 0.35 ? ' is-lucky' : profile.index <= -0.35 ? ' is-unlucky' : '';
  return `
    <div class="eb-luck-row" data-testid="matchup-luck-${escapeHtml(team)}">
      <span class="eb-luck-team">${flagFor(team)} ${escapeHtml(team)}</span>
      <span class="eb-luck-score${tone}">${profile.index >= 0 ? '+' : ''}${profile.index.toFixed(2)}σ</span>
      <span class="eb-luck-chips">${chips.map((c) => `<span class="eb-luck-chip">${escapeHtml(c.label)} ${c.z >= 0 ? '+' : ''}${c.z.toFixed(1)}σ</span>`).join('')}</span>
    </div>`;
}

function ledgerCol(team, rows) {
  return `
    <div class="luck-ledger-col">
      <h3 class="luck-ledger-team">${flagFor(team)} ${escapeHtml(team)}</h3>
      ${rows.length ? rows.map((r) => `
        <span class="eb-luck-chip ${r.lucky ? 'is-lucky' : 'is-unlucky'}">${escapeHtml(r.label)} ${escapeHtml(r.detail)}</span>
      `).join('') : '<span class="muted luck-ledger-none">no luck events yet</span>'}
    </div>`;
}

export function luckCheckSection(match, data) {
  let profiles, ledger;
  try {
    profiles = computeLuckIndex(data).teams;
    ledger = matchLuckLedger(data, match);
  } catch { return document.createDocumentFragment(); }
  const pa = profiles[match?.team_a]; const pb = profiles[match?.team_b];
  if (!pa && !pb && !ledger) return document.createDocumentFragment();

  const sec = document.createElement('div');
  sec.className = 'section eb-luck';
  sec.dataset.testid = 'matchup-luck';
  sec.innerHTML = `
    <h2>Luck check <span class="muted home-card-meta">how they got here</span></h2>
    <div class="eb-luck-rows">
      ${teamRow(match.team_a, pa)}
      ${teamRow(match.team_b, pb)}
    </div>
    ${ledger ? `
    <div class="luck-ledger" data-testid="matchup-luck-ledger">
      <h3 class="luck-ledger-head">This match <span class="muted">luck shift — feeds the next round</span></h3>
      <div class="luck-ledger-grid">
        ${ledgerCol(match.team_a, ledger[match.team_a] || [])}
        ${ledgerCol(match.team_b, ledger[match.team_b] || [])}
      </div>
    </div>` : ''}
    <p class="muted eb-luck-note">Group-stage pens, corners, whistle, cards &amp; xG luck vs the field. Descriptive only — backtested from the R32 it adds no predictive edge, so it never adjusts projections.</p>
  `;
  return sec;
}
