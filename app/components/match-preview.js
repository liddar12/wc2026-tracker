/* match-preview.js — RJ30.1 Item 1: AI match preview / recap section.
 *
 * Ships DORMANT. The server-side generator (scripts/generate_previews.py) only
 * writes data/previews.json when ANTHROPIC_API_KEY is set; otherwise the file
 * stays the empty stub and this component renders NOTHING — an empty
 * DocumentFragment, NOT an empty-state. Rationale: an empty-state would advertise
 * an unshipped feature and add VoiceOver/dynamic-type noise. A fragment with no
 * children is invisible and announces nothing.
 *
 * When live, previews.json carries one entry per canonical match_id
 * ('Team A__vs__Team B'), self-labeling Preview vs Recap from `kind`:
 *   { kind: 'preview'|'recap', text, model, generated_at, content_hash }
 * The single section call covers both — a preview belongs near the model grid,
 * a recap near the result; the heading + data-kind disambiguate.
 *
 * All rendered copy is escaped via escapeHtml (the only string input — team
 * names + the model line — is canonical, but we escape defensively anyway and
 * never inject untyped data via innerHTML without escaping).
 */
import { escapeHtml } from '../lib/escape.js';
import { formatLastUpdated } from '../data-loader.js';

export function previewSection(match, data) {
  const previews = (data && data.previews) || {};
  // generate_previews.py keys entries by the SCHEDULE match_id (e.g.
  // "M082__1G__vs__3_AEHIJ"), which the resolved match row carries — try that
  // first, then fall back to the canonical team-pair (either orientation).
  const fwdId = `${match.team_a}__vs__${match.team_b}`;
  const revId = `${match.team_b}__vs__${match.team_a}`;
  const p = (match.match_id && previews[match.match_id]) || previews[fwdId] || previews[revId];

  // Dormant / absent → no section at all (empty fragment, never an empty-state).
  if (!p || !p.text || typeof p.text !== 'string') {
    return document.createDocumentFragment();
  }

  const kind = p.kind === 'recap' ? 'recap' : 'preview';
  const heading = kind === 'recap' ? 'Recap' : 'Preview';
  const model = p.model || 'Claude Haiku';
  const when = p.generated_at ? formatLastUpdated(p.generated_at) : '';

  const sec = document.createElement('div');
  sec.className = 'section ai-preview-section';
  sec.setAttribute('data-testid', 'ai-preview');
  sec.setAttribute('data-kind', kind);

  const caption = when
    ? `AI-generated · ${escapeHtml(model)} · ${escapeHtml(when)}`
    : `AI-generated · ${escapeHtml(model)}`;

  sec.innerHTML = `
    <h2>${escapeHtml(heading)} <span class="ai-pill">AI</span></h2>
    <p class="ai-preview-text">${escapeHtml(p.text)}</p>
    <p class="muted ai-preview-caption" style="font-size:11px;">${caption}</p>
  `;
  return sec;
}
