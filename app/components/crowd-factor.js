/* crowd-factor.js — matchup "Crowd factor" card.
 *
 * Shows the model's advance probability WITH and WITHOUT a known partisan-crowd
 * adjustment, side by side, for a match that has a crowd entry (data/crowd.json).
 * Transparent by construction: the headline projection stays the model's; this
 * is a labelled layer, anchored to published home-advantage research, that never
 * feeds the model, scoring, or bracket (see app/lib/crowd-adjust.js).
 * Empty DocumentFragment when the match has no crowd entry.
 */
import { escapeHtml } from '../lib/escape.js';
import { flagFor } from './team-flag.js';
import { crowdAdjustment } from '../lib/crowd-adjust.js';

export function crowdFactorSection(match, data) {
  let adj;
  try { adj = crowdAdjustment(data, match); } catch { return document.createDocumentFragment(); }
  if (!adj) return document.createDocumentFragment();

  const a = match.team_a; const b = match.team_b;
  const ratioTxt = `${Math.round(adj.ratio)}:1`;
  const row = (label, probs, cls) => `
    <div class="crowd-row ${cls}">
      <span class="crowd-row-label">${escapeHtml(label)}</span>
      <span class="crowd-side">${flagFor(a)} ${escapeHtml(a)} <strong>${probs[a]}%</strong></span>
      <span class="crowd-side">${flagFor(b)} ${escapeHtml(b)} <strong>${probs[b]}%</strong></span>
    </div>`;

  const sec = document.createElement('div');
  sec.className = 'section crowd-factor';
  sec.dataset.testid = 'crowd-factor';
  sec.innerHTML = `
    <h2>Crowd factor <span class="muted home-card-meta">${escapeHtml(ratioTxt)} ${escapeHtml(adj.favoredTeam)}</span></h2>
    <p class="crowd-headline" data-testid="crowd-headline">A reported <strong>${escapeHtml(ratioTxt)}</strong> crowd behind ${escapeHtml(adj.favoredTeam)} is worth about
      <strong>+${adj.deltaPct} pts</strong> to their chance to advance — narrowing the tie, not deciding it.</p>
    <div class="crowd-rows">
      ${row('Model', adj.base, 'is-model')}
      ${row(`With ${ratioTxt} crowd`, adj.adjusted, 'is-adjusted')}
    </div>
    <p class="muted crowd-note">Fixed prior (~${adj.deltaGoals.toFixed(2)} goals of support), anchored to published home-advantage research and applied only to this match. The model's own forecast is unchanged — this layer never feeds the projection, scoring, or bracket.</p>
  `;
  return sec;
}
