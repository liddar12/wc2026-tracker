/* brackets-live-view.js — read-only view of the official tournament bracket.
   Source of truth: data/schedule_full.json (knockout matches with slot
   placeholders like "1A", "2B", "W74") + data/actual_results.json for played
   outcomes. Pre-tournament: shows seeded R32 with "Awaiting group stage"
   labels. During tournament: completed matches show score + winner; future
   rounds show resolved teams once their qualifying match completes.
*/
import { setRoute } from '../state.js';
import { flagFor } from '../components/team-flag.js';
import { renderBracketView } from './bracket-view.js';
import { STAGE_LABELS, STAGE_ORDER, resolveSlots, isSlotPlaceholder } from '../bracket-resolver.js';

export function renderBracketsLiveView(root, data, params) {
  root.innerHTML = '';
  if (!data) {
    const p = document.createElement('p');
    p.className = 'loading';
    p.textContent = 'Loading bracket…';
    root.appendChild(p);
    return;
  }

  // Sub-tab toggle: Live ↔ Projected. Both modes live under the same #/brackets
  // route so we never end up trapped on one side.
  const mode = params?.mode === 'projected' ? 'projected' : 'live';
  const sub = document.createElement('div');
  sub.className = 'brackets-tabs';
  sub.innerHTML = `
    <button type="button" class="${mode === 'live' ? 'is-active' : ''}" data-mode="live">Live (actual)</button>
    <button type="button" class="${mode === 'projected' ? 'is-active' : ''}" data-mode="projected">Projected (model)</button>
  `;
  sub.addEventListener('click', (e) => {
    const t = e.target.closest('button[data-mode]');
    if (!t) return;
    const next = t.dataset.mode;
    if (next === mode) return; // no-op
    // Toggle by updating the URL params so refresh / back-button keeps the
    // user's last view, and so the toggle is fully symmetric.
    setRoute('brackets', next === 'projected' ? { mode: 'projected' } : {});
  });
  root.appendChild(sub);

  if (mode === 'projected') {
    // Delegate to the legacy SVG bracket view for the projected/model rendering.
    const wrap = document.createElement('div');
    root.appendChild(wrap);
    renderBracketView(wrap, data);
    return;
  }

  const updated = data?.actualResults?.last_updated || data?.meta?.data_version;
  const intro = document.createElement('div');
  intro.className = 'home-card';
  intro.style.marginBottom = '12px';
  intro.innerHTML = `
    <h2 class="home-card-title">Tournament bracket <span class="home-card-meta">${escapeHtml(intervalLabel(updated))}</span></h2>
    <p class="muted" style="margin:0;">Official knockout results. Tap a match to see the score, venue, and kickoff time. Round winners advance automatically when their match is played.</p>
  `;
  root.appendChild(intro);

  const scheduleFull = data.scheduleFull || [];
  const knockouts = scheduleFull
    .filter((m) => STAGE_ORDER.includes(m.stage))
    .sort((a, b) => (a.match_number || 0) - (b.match_number || 0));

  if (!knockouts.length) {
    root.appendChild(emptyCard("Knockout bracket isn't loaded yet."));
    return;
  }

  // Resolve slot placeholders (e.g., "1A", "W74") using actual results + earlier match winners.
  resolveSlots(knockouts, data);

  for (const stage of STAGE_ORDER) {
    const matches = knockouts.filter((m) => m.stage === stage);
    if (!matches.length) continue;
    root.appendChild(renderStage(stage, matches, data));
  }
}

function renderStage(stage, matches, data) {
  const section = document.createElement('section');
  section.className = 'bb-round';
  const totalPlayed = matches.filter((m) => m.actual).length;
  section.innerHTML = `
    <h3>${escapeHtml(STAGE_LABELS[stage] || stage)} <span class="bb-round-meta muted">${totalPlayed}/${matches.length} complete</span></h3>
  `;
  for (const m of matches) {
    const a = m.resolved_team_a;
    const b = m.resolved_team_b;
    const actual = m.actual;
    const winnerIsA = actual?.winner && actual.winner === a;
    const winnerIsB = actual?.winner && actual.winner === b;
    const isPlaceholderA = isSlotPlaceholder(a);
    const isPlaceholderB = isSlotPlaceholder(b);
    const fa = isPlaceholderA ? '·' : flagFor(a);
    const fb = isPlaceholderB ? '·' : flagFor(b);
    const stamp = m.kickoff_utc ? new Date(m.kickoff_utc).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'TBD';
    const venue = m.venue_id ? venueLabel(data, m.venue_id) : '';
    const wrap = document.createElement('div');
    wrap.className = 'bb-pair';
    const onTap = !isPlaceholderA && !isPlaceholderB
      ? `data-team-a="${escapeHtml(a)}" data-team-b="${escapeHtml(b)}"`
      : '';
    wrap.innerHTML = `
      <button class="bb-slot ${winnerIsA ? 'is-actual-win' : actual && winnerIsB ? 'is-busted' : ''}" ${onTap}>
        <span class="bb-slot-flag">${fa}</span>
        <span>${escapeHtml(a || 'TBD')} ${actual ? `<span class="bb-points">${actual.score_a}</span>` : ''}</span>
      </button>
      <div class="bb-pair-vs">vs</div>
      <button class="bb-slot ${winnerIsB ? 'is-actual-win' : actual && winnerIsA ? 'is-busted' : ''}" ${onTap}>
        <span class="bb-slot-flag">${fb}</span>
        <span>${escapeHtml(b || 'TBD')} ${actual ? `<span class="bb-points">${actual.score_b}</span>` : ''}</span>
      </button>
    `;
    const stampRow = document.createElement('div');
    stampRow.className = 'muted';
    stampRow.style.cssText = 'font-size:11px; margin: 4px 0 8px 4px; display:flex; gap:8px; flex-wrap:wrap;';
    stampRow.innerHTML = `<span>Match #${m.match_number}</span><span>${escapeHtml(stamp)}</span>${venue ? `<span>${escapeHtml(venue)}</span>` : ''}`;
    wrap.querySelectorAll('button.bb-slot').forEach((btn) => {
      if (isPlaceholderA || isPlaceholderB) btn.disabled = true;
      btn.addEventListener('click', () => {
        if (isPlaceholderA || isPlaceholderB) return;
        location.hash = `#/matchup/team_a/${encodeURIComponent(a)}/team_b/${encodeURIComponent(b)}`;
      });
    });
    section.appendChild(wrap);
    section.appendChild(stampRow);
  }
  return section;
}

function venueLabel(data, vid) {
  const v = (data.venues || []).find((x) => x.id === vid);
  return v ? `${v.name}, ${v.city}` : '';
}

function intervalLabel(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'updated just now';
    if (mins < 60) return `updated ${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `updated ${hrs}h ago`;
    return `updated ${Math.floor(hrs / 24)}d ago`;
  } catch { return ''; }
}

function emptyCard(text) {
  const div = document.createElement('div');
  div.className = 'bb-empty';
  div.textContent = text;
  return div;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
