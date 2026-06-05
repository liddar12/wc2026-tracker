/* brackets-live-view.js — read-only view of the official tournament bracket.
   Source of truth: data/schedule_full.json (knockout matches with slot
   placeholders like "1A", "2B", "W74") + data/actual_results.json for played
   outcomes. Pre-tournament: shows seeded R32 with "Awaiting group stage"
   labels. During tournament: completed matches show score + winner; future
   rounds show resolved teams once their qualifying match completes.
*/
import { escapeHtml } from '../lib/escape.js';
import { setRoute } from '../state.js';
import { flagFor } from '../components/team-flag.js';
import { statusPill } from '../components/status-pill.js';
import { openMatchSheet } from '../components/match-sheet.js';
import { renderBracketView } from './bracket-view.js';
import { STAGE_LABELS, STAGE_ORDER, resolveSlots, isSlotPlaceholder, computeGroupStandings, computeProjectedGroupOrder } from '../bracket-resolver.js';
import { getFavoriteTeam } from '../favorites.js';
import { getCompetitionState } from '../competition.js';

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
  const mode = params?.mode === 'projected' ? 'projected'
            : params?.mode === 'compare'   ? 'compare'
            : 'live';
  const sub = document.createElement('div');
  sub.className = 'brackets-tabs';
  sub.innerHTML = `
    <button type="button" class="${mode === 'live' ? 'is-active' : ''}" data-mode="live">Live</button>
    <button type="button" class="${mode === 'projected' ? 'is-active' : ''}" data-mode="projected">Projected</button>
    <button type="button" class="${mode === 'compare' ? 'is-active' : ''}" data-mode="compare">Compare</button>
  `;
  sub.addEventListener('click', (e) => {
    const t = e.target.closest('button[data-mode]');
    if (!t) return;
    const next = t.dataset.mode;
    if (next === mode) return;
    setRoute('brackets', next === 'live' ? {} : { mode: next });
  });
  root.appendChild(sub);

  if (mode === 'projected') {
    const wrap = document.createElement('div');
    root.appendChild(wrap);
    renderBracketView(wrap, data);
    return;
  }
  if (mode === 'compare') {
    renderCompareView(root, data);
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

  // Inline group-stage standings: tap any group letter A–L to expand a mini table.
  root.appendChild(renderGroupStandingsStrip(data));

  // "We are here" indicator — find the round that's currently in progress
  // (or upcoming next) based on kickoffs and rendered as a divider before
  // that round's section.
  const currentStage = findCurrentStage(knockouts);

  for (const stage of STAGE_ORDER) {
    const matches = knockouts.filter((m) => m.stage === stage);
    if (!matches.length) continue;
    if (stage === currentStage) {
      const here = document.createElement('div');
      here.className = 'bb-here';
      here.innerHTML = `<span class="bb-here-dot" aria-hidden="true"></span><span class="bb-here-label">We are here</span>`;
      root.appendChild(here);
    }
    root.appendChild(renderStage(stage, matches, data));
  }
}

function findCurrentStage(knockouts) {
  const now = Date.now();
  // The current stage = the earliest stage whose latest kickoff is still in
  // the future, OR the latest stage where matches have started but not all
  // played (live).
  for (const stage of STAGE_ORDER) {
    const m = knockouts.filter((x) => x.stage === stage);
    if (!m.length) continue;
    const allDone = m.every((x) => x.actual);
    if (allDone) continue;
    return stage;
  }
  return null;
}

function renderGroupStandingsStrip(data) {
  const wrap = document.createElement('section');
  wrap.className = 'home-card';
  wrap.style.marginBottom = '12px';
  const letters = Object.keys(data?.groupMatchups || {}).sort();
  if (!letters.length) {
    wrap.innerHTML = `<h2 class="home-card-title">Group stage</h2><p class="muted">No groups yet.</p>`;
    return wrap;
  }
  wrap.innerHTML = `
    <h2 class="home-card-title">Group stage</h2>
    <p class="muted" style="font-size:12px; margin: 0 0 8px;">Tap a letter to see standings.</p>
    <div class="bb-group-strip" role="tablist">
      ${letters.map((g) => `<button type="button" class="bb-group-letter" data-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('')}
    </div>
    <div class="bb-group-standings" id="bb-group-standings" hidden></div>
  `;
  const stripBtns = wrap.querySelectorAll('.bb-group-letter');
  const target = wrap.querySelector('#bb-group-standings');
  stripBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const g = btn.dataset.group;
      const alreadyOpen = !target.hidden && target.dataset.openGroup === g;
      stripBtns.forEach((b) => b.classList.toggle('is-active', b === btn && !alreadyOpen));
      if (alreadyOpen) { target.hidden = true; target.dataset.openGroup = ''; return; }
      target.dataset.openGroup = g;
      target.hidden = false;
      target.innerHTML = renderGroupTable(g, data);
    });
  });
  return wrap;
}

function renderGroupTable(g, data) {
  // Prefer real standings if all group matches are played; otherwise show projected.
  const real = computeGroupStandings(data, g);
  const projected = !real ? computeProjectedGroupOrder(data, g) : null;
  const standings = real || projected || [];
  const sourceLabel = real ? 'Standings' : 'Projected order';
  if (!standings.length) {
    return `<p class="muted">No data for Group ${escapeHtml(g)}.</p>`;
  }
  const rows = standings.map((r, i) => `
    <tr class="bb-stand-row ${i < 2 ? 'is-qual' : ''}">
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(r.team)}</strong></td>
      <td class="num">${r.played ?? 0}</td>
      <td class="num">${(r.points ?? 0).toFixed ? (r.points).toFixed(1) : r.points}</td>
      <td class="num">${r.gd ?? 0}</td>
    </tr>
  `).join('');
  return `
    <div class="muted" style="font-size:11px; margin: 0 0 4px;">${escapeHtml(sourceLabel)} · Group ${escapeHtml(g)}</div>
    <table class="bb-stand-table">
      <thead><tr><th>#</th><th>Team</th><th class="num">P</th><th class="num">Pts</th><th class="num">GD</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderStage(stage, matches, data) {
  const section = document.createElement('section');
  section.className = 'bb-round';
  const totalPlayed = matches.filter((m) => m.actual).length;
  section.innerHTML = `
    <h3>${escapeHtml(STAGE_LABELS[stage] || stage)} <span class="bb-round-meta muted">${totalPlayed}/${matches.length} complete</span></h3>
  `;
  const fav = getFavoriteTeam();
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
    const venue = m.venue_id ? venueLabel(data, m.venue_id) : '';
    const aIsFav = fav && a === fav;
    const bIsFav = fav && b === fav;
    const wrap = document.createElement('div');
    wrap.className = 'bb-pair' + (aIsFav || bIsFav ? ' has-fav' : '');
    const onTap = !isPlaceholderA && !isPlaceholderB
      ? `data-team-a="${escapeHtml(a)}" data-team-b="${escapeHtml(b)}"`
      : '';
    wrap.innerHTML = `
      <button class="bb-slot ${winnerIsA ? 'is-actual-win' : actual && winnerIsB ? 'is-busted' : ''} ${aIsFav ? 'is-fav-slot' : ''}" data-testid="bracket-slot" data-team="${escapeHtml(a || '')}" data-match="${m.match_number}" ${onTap}>
        <span class="bb-slot-flag">${fa}</span>
        <span>${escapeHtml(a || 'TBD')} ${actual ? `<span class="bb-points">${actual.score_a}</span>` : ''}</span>
      </button>
      <div class="bb-pair-vs">vs</div>
      <button class="bb-slot ${winnerIsB ? 'is-actual-win' : actual && winnerIsA ? 'is-busted' : ''} ${bIsFav ? 'is-fav-slot' : ''}" data-testid="bracket-slot" data-team="${escapeHtml(b || '')}" data-match="${m.match_number}" ${onTap}>
        <span class="bb-slot-flag">${fb}</span>
        <span>${escapeHtml(b || 'TBD')} ${actual ? `<span class="bb-points">${actual.score_b}</span>` : ''}</span>
      </button>
    `;
    const stampRow = document.createElement('div');
    stampRow.className = 'muted';
    stampRow.style.cssText = 'font-size:11px; margin: 4px 0 8px 4px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;';
    const meta = document.createElement('span');
    meta.textContent = `Match #${m.match_number}`;
    stampRow.appendChild(meta);
    stampRow.appendChild(statusPill(m, actual));
    if (venue) {
      const v = document.createElement('span');
      v.textContent = venue;
      stampRow.appendChild(v);
    }
    wrap.querySelectorAll('button.bb-slot').forEach((btn) => {
      if (isPlaceholderA || isPlaceholderB) btn.disabled = true;
      btn.addEventListener('click', () => {
        if (isPlaceholderA || isPlaceholderB) return;
        openMatchSheet(data, { teamA: a, teamB: b });
      });
      // Long-press → quick actions
      attachLongPress(btn, () => openQuickActions(a, b, btn));
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

function renderCompareView(root, data) {
  // Side-by-side: my pick vs model pick per matchup, with actual on top
  // when present.
  const intro = document.createElement('div');
  intro.className = 'home-card';
  intro.style.marginBottom = '12px';
  intro.innerHTML = `
    <h2 class="home-card-title">My picks vs Model</h2>
    <p class="muted" style="margin:0;">For each knockout match: your bracket pick (filled chip), the model's projection (outline chip), and the actual winner (green outline) once played.</p>
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
  // Resolve slots, with model winners chained through downstream rounds so
  // the model column shows team names all the way to the Champion.
  resolveSlots(knockouts, data, {
    winnerResolver: ({ team_a, team_b }) => {
      const ca = data?.teams?.[team_a]?.composite;
      const cb = data?.teams?.[team_b]?.composite;
      if (typeof ca !== 'number' || typeof cb !== 'number') return team_a;
      return ca >= cb ? team_a : team_b;
    },
  });

  // Pull user picks from localStorage for the active pool / local draft.
  // (Was using a never-set window global; switch to the actual competition
  // state import.)
  const comp = (typeof getCompetitionState === 'function') ? getCompetitionState() : null;
  let bracket = { picks: {} };
  try {
    const key = comp?.activeGroup?.id
      ? `wc26.mybrackets.${comp.activeGroup.id}`
      : 'wc26.mybrackets.local';
    const raw = localStorage.getItem(key);
    if (raw) bracket = JSON.parse(raw);
  } catch {}

  for (const stage of STAGE_ORDER) {
    const matches = knockouts.filter((m) => m.stage === stage);
    if (!matches.length) continue;
    const section = document.createElement('section');
    section.className = 'bb-round';
    section.innerHTML = `<h3>${escapeHtml(STAGE_LABELS[stage] || stage)}</h3>`;
    for (const m of matches) {
      const a = m.resolved_team_a;
      const b = m.resolved_team_b;
      const actualWinner = m.actual?.winner || null;
      const modelWinner = m.projected_winner || null;
      const userPick = bracket.picks?.[String(m.match_number)]?.team || null;
      const row = document.createElement('div');
      row.className = 'bb-compare-row';
      row.innerHTML = `
        <div class="bb-compare-pair">${escapeHtml(a || 'TBD')} <span class="muted">vs</span> ${escapeHtml(b || 'TBD')}</div>
        <div class="bb-compare-chips">
          <span class="bb-chip bb-chip-mine ${userPick ? 'is-set' : ''}">${escapeHtml(userPick || '—')}</span>
          <span class="bb-chip bb-chip-model">${escapeHtml(modelWinner || '—')}</span>
          ${actualWinner ? `<span class="bb-chip bb-chip-actual">${escapeHtml(actualWinner)}</span>` : ''}
        </div>
        ${userPick && modelWinner && userPick !== modelWinner
          ? `<div class="bb-compare-flag">Diverges from model</div>`
          : ''}
      `;
      section.appendChild(row);
    }
    root.appendChild(section);
  }
}

function emptyCard(text) {
  const div = document.createElement('div');
  div.className = 'bb-empty';
  div.textContent = text;
  return div;
}

// Long-press helper — fires onLong if the user holds for >=550ms without
// moving significantly. Cancelled by drag/scroll.
function attachLongPress(el, onLong) {
  let timer = null;
  let startX = 0, startY = 0;
  const start = (e) => {
    const t = e.touches ? e.touches[0] : e;
    startX = t.clientX; startY = t.clientY;
    cancel();
    timer = setTimeout(() => { timer = null; try { onLong(); } catch {} }, 550);
  };
  const move = (e) => {
    if (!timer) return;
    const t = e.touches ? e.touches[0] : e;
    if (Math.hypot(t.clientX - startX, t.clientY - startY) > 10) cancel();
  };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchmove', move, { passive: true });
  el.addEventListener('touchend', cancel);
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('mousedown', start);
  el.addEventListener('mousemove', move);
  el.addEventListener('mouseup', cancel);
  el.addEventListener('mouseleave', cancel);
}

function openQuickActions(teamA, teamB, anchor) {
  // Minimal action sheet — bottom slide-up with favorite/share/pick options.
  const existing = document.querySelector('.wc-actions');
  if (existing) existing.remove();
  const sheet = document.createElement('div');
  sheet.className = 'wc-actions';
  sheet.innerHTML = `
    <button type="button" class="wc-actions-btn" data-act="fav-a">⭐ Favorite ${escapeHtml(teamA)}</button>
    <button type="button" class="wc-actions-btn" data-act="fav-b">⭐ Favorite ${escapeHtml(teamB)}</button>
    <button type="button" class="wc-actions-btn" data-act="share">↗ Share matchup</button>
    <button type="button" class="wc-actions-btn" data-act="pick-mine">📝 Pick this in My Brackets</button>
    <button type="button" class="wc-actions-btn wc-actions-cancel" data-act="cancel">Cancel</button>
  `;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  sheet.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    sheet.classList.remove('is-open');
    setTimeout(() => sheet.remove(), 250);
    if (act === 'cancel') return;
    if (act === 'fav-a' || act === 'fav-b') {
      const team = act === 'fav-a' ? teamA : teamB;
      const { setFavoriteTeam } = await import('../favorites.js');
      setFavoriteTeam(team);
      return;
    }
    if (act === 'share') {
      const text = `${teamA} vs ${teamB} — WC26 Tracker`;
      const url = `${location.origin}/#/matchup/team_a/${encodeURIComponent(teamA)}/team_b/${encodeURIComponent(teamB)}`;
      try {
        if (navigator.share) await navigator.share({ title: text, url });
        else await navigator.clipboard.writeText(url);
      } catch {}
      return;
    }
    if (act === 'pick-mine') {
      // Navigate to My Brackets so the user can pick this matchup.
      location.hash = '#/my-brackets';
      return;
    }
  });
  // Dismiss on outside tap
  setTimeout(() => {
    document.addEventListener('click', function once(e) {
      if (sheet.contains(e.target)) return;
      sheet.classList.remove('is-open');
      setTimeout(() => sheet.remove(), 250);
      document.removeEventListener('click', once);
    });
  }, 100);
}

