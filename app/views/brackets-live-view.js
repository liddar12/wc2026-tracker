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

const STAGE_LABELS = {
  round_of_32: 'Round of 32',
  round_of_16: 'Round of 16',
  quarterfinals: 'Quarter-finals',
  semifinals: 'Semi-finals',
  third_place: 'Bronze final',
  final: 'Final',
};

const STAGE_ORDER = [
  'round_of_32', 'round_of_16', 'quarterfinals', 'semifinals', 'third_place', 'final'
];

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
  const resolved = resolveSlots(knockouts, data);

  for (const stage of STAGE_ORDER) {
    const matches = resolved.filter((m) => m.stage === stage);
    if (!matches.length) continue;
    root.appendChild(renderStage(stage, matches, data));
  }
}

function resolveSlots(knockouts, data) {
  const byNumber = new Map(knockouts.map((m) => [m.match_number, m]));
  const winners = new Map(); // match_number -> resolved winner team name
  const losers = new Map();

  // Tier order: R32 first, etc.
  for (const m of knockouts) {
    const resolvedA = resolveSlot(m.team_a, data, winners, losers);
    const resolvedB = resolveSlot(m.team_b, data, winners, losers);
    m.resolved_team_a = resolvedA;
    m.resolved_team_b = resolvedB;
    const actual = lookupActual(data, m.stage, resolvedA, resolvedB);
    m.actual = actual;
    if (actual && actual.winner) {
      winners.set(m.match_number, actual.winner);
      const loser = actual.winner === resolvedA ? resolvedB : actual.winner === resolvedB ? resolvedA : null;
      if (loser) losers.set(m.match_number, loser);
    }
  }
  return knockouts;
}

function resolveSlot(slot, data, winners, losers) {
  if (!slot || typeof slot !== 'string') return null;
  // Already a real team name (no slot pattern)
  if (!/^\d[A-L]$/.test(slot) && !/^3 [A-L]+$/.test(slot) && !/^W\d+$/.test(slot) && !/^L\d+$/.test(slot)) {
    return slot; // assume team name
  }
  // 1A / 2B = winner / runner-up of group A/B (post-group stage)
  const grpMatch = slot.match(/^(\d)([A-L])$/);
  if (grpMatch) {
    return resolveGroupSlot(data, parseInt(grpMatch[1], 10), grpMatch[2]);
  }
  // "3 ABCDF" = best 3rd-placed team from one of A,B,C,D,F
  const thirdMatch = slot.match(/^3 ([A-L]+)$/);
  if (thirdMatch) {
    return resolveThirdSlot(data, thirdMatch[1]);
  }
  // W74 = winner of match 74
  const winMatch = slot.match(/^W(\d+)$/);
  if (winMatch) {
    return winners.get(parseInt(winMatch[1], 10)) || slot;
  }
  // L101 = loser of match 101 (used for bronze final)
  const loseMatch = slot.match(/^L(\d+)$/);
  if (loseMatch) {
    return losers.get(parseInt(loseMatch[1], 10)) || slot;
  }
  return slot;
}

function resolveGroupSlot(data, place, group) {
  const standings = computeGroupStandings(data, group);
  if (!standings) return `${place}${group}`;
  const team = standings[place - 1];
  return team?.team || `${place}${group}`;
}

function resolveThirdSlot(data, letters) {
  // Best 3rd-place across these groups
  const candidates = [];
  for (const g of letters) {
    const s = computeGroupStandings(data, g);
    if (s && s[2]) candidates.push({ ...s[2], group: g });
  }
  if (!candidates.length) return `3 ${letters}`;
  candidates.sort((a, b) => (b.points || 0) - (a.points || 0) || (b.gd || 0) - (a.gd || 0) || (b.gf || 0) - (a.gf || 0));
  return candidates[0]?.team || `3 ${letters}`;
}

function computeGroupStandings(data, group) {
  // Use actual group stage results when available; otherwise leave unresolved
  const gs = data?.actualResults?.group_stage || {};
  const gm = data?.groupMatchups?.[group];
  if (!gm) return null;
  const teams = gm.teams || [];
  // Initialize standings
  const tbl = Object.fromEntries(teams.map((t) => [t, { team: t, points: 0, gf: 0, ga: 0, gd: 0, played: 0 }]));
  let played = 0;
  for (const m of (gm.matches || [])) {
    const key1 = `${m.team_a}__vs__${m.team_b}`;
    const key2 = `${m.team_b}__vs__${m.team_a}`;
    const rec = gs[key1] || gs[key2];
    if (!rec) continue;
    const a = rec.score_a ?? rec.team_a_score;
    const b = rec.score_b ?? rec.team_b_score;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const flipped = !!gs[key2];
    const teamA = flipped ? m.team_b : m.team_a;
    const teamB = flipped ? m.team_a : m.team_b;
    if (!tbl[teamA] || !tbl[teamB]) continue;
    tbl[teamA].played++; tbl[teamB].played++;
    tbl[teamA].gf += a; tbl[teamA].ga += b;
    tbl[teamB].gf += b; tbl[teamB].ga += a;
    tbl[teamA].gd = tbl[teamA].gf - tbl[teamA].ga;
    tbl[teamB].gd = tbl[teamB].gf - tbl[teamB].ga;
    if (a > b) tbl[teamA].points += 3;
    else if (a < b) tbl[teamB].points += 3;
    else { tbl[teamA].points += 1; tbl[teamB].points += 1; }
    played++;
  }
  if (played < (gm.matches || []).length) return null; // group not complete
  return Object.values(tbl).sort((x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team));
}

function lookupActual(data, stage, a, b) {
  if (!a || !b) return null;
  const tier = data?.actualResults?.[stage];
  if (!tier) return null;
  const rec = tier[`${a}__vs__${b}`] || tier[`${b}__vs__${a}`];
  if (!rec) return null;
  const sa = rec.score_a ?? rec.team_a_score;
  const sb = rec.score_b ?? rec.team_b_score;
  if (!Number.isFinite(sa) || !Number.isFinite(sb)) return null;
  const flipped = !!tier[`${b}__vs__${a}`];
  const score_a = flipped ? sb : sa;
  const score_b = flipped ? sa : sb;
  let winner = null;
  if (score_a > score_b) winner = a;
  else if (score_b > score_a) winner = b;
  // Knockout penalty resolution: if rec.winner specified explicitly, trust it
  if (rec.winner && rec.winner === a) winner = a;
  else if (rec.winner && rec.winner === b) winner = b;
  return { score_a, score_b, winner, kickoff_utc: rec.kickoff_utc };
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

function isSlotPlaceholder(s) {
  if (typeof s !== 'string') return true;
  return /^\d[A-L]$/.test(s) || /^3 [A-L]+$/.test(s) || /^W\d+$/.test(s) || /^L\d+$/.test(s);
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
