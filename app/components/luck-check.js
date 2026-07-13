/* luck-check.js — matchup-page Luck check section, in PLAIN LANGUAGE.
 *
 * Three parts, all display-only (never feed the model — see app/lib/luck-index.js
 * and docs/LUCK_ANALYSIS.md):
 *   1. A headline sentence comparing the two sides' luck in common terms
 *      ("England has been noticeably luckier than Argentina this tournament").
 *   2. "How they got here" — each side's standing ("5th luckiest of 48 teams")
 *      + word chips (penalty awarded, corner edge, friendly whistle…) — plain
 *      words only, no statistical notation.
 *   3. "This match" — a live luck ledger for THIS fixture (pens, cards,
 *      own-goal gifts, corner and whistle edges, score vs expectation). It
 *      reads the live-merged in-memory data, so it fills in during the match
 *      on every data:live-refresh re-render — the change-of-luck feed into
 *      the next round. Hidden before any signal exists.
 * Returns an empty DocumentFragment when neither team has a luck profile.
 */
import { escapeHtml } from '../lib/escape.js';
import { flagFor } from './team-flag.js';
import {
  computeLuckIndex, luckChips, matchLuckLedger, luckStanding, compareLuckPlain,
} from '../lib/luck-index.js';

function teamRow(team, profile) {
  if (!profile) return '';
  const chips = luckChips(profile);
  const tone = profile.index >= 0.35 ? ' is-lucky' : profile.index <= -0.35 ? ' is-unlucky' : '';
  return `
    <div class="eb-luck-row" data-testid="matchup-luck-${escapeHtml(team)}">
      <span class="eb-luck-team">${flagFor(team)} ${escapeHtml(team)}</span>
      <span class="eb-luck-score${tone}">${escapeHtml(luckStanding(profile))}</span>
      <span class="eb-luck-chips">${chips.map((c) => `<span class="eb-luck-chip">${escapeHtml(c.label)}</span>`).join('')}</span>
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

  const headline = compareLuckPlain(match.team_a, match.team_b, pa, pb);
  const sec = document.createElement('div');
  sec.className = 'section eb-luck';
  sec.dataset.testid = 'matchup-luck';
  sec.innerHTML = `
    <h2>Luck check <span class="muted home-card-meta">how they got here</span></h2>
    ${headline ? `<p class="eb-luck-headline" data-testid="matchup-luck-headline">${escapeHtml(headline)}</p>` : ''}
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
    <p class="muted eb-luck-note">Counted from group-stage penalties, corners, referee calls, cards and finishing vs expectation. Context only — luck never changes the predictions.</p>
  `;
  return sec;
}
