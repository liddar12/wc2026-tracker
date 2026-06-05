/* pool-standings-view.js — R18: a pool's STANDINGS (place · player · points).
 *
 * Fixes the gap where tapping a pool sent you to My Brackets / My Pools instead
 * of showing the ranked leaderboard. Reached via #/standings/id/<poolId>.
 *
 * States:
 *   - signed-out  → "sign in to view standings" (RLS needs an authed user)
 *   - member      → ranked list from fetchLeaderboard (Everyone uses the
 *                   paginated RPC; other pools use the client combine). Your row
 *                   is highlighted. Total = group (max 84) + knockout (max 96).
 *   - non-member  → "join to view standings" (RLS blocks reading non-member
 *                   standings); join is optional, one tap.
 */
import { setRoute } from '../state.js';
import { escapeHtml } from '../lib/escape.js';
import { openAuth } from '../auth-modal.js';
import {
  getCompetitionState,
  fetchLeaderboard,
  joinPoolByCode,
  setActiveGroup,
  isSupabaseConfigured,
  EVERYONE_GROUP_ID,
} from '../competition.js';

const PAGE = 50;

export function renderPoolStandingsView(root, data, params = {}) {
  root.innerHTML = '';
  const id = params?.id || null;
  if (!id) {
    root.innerHTML = '<section class="home-card"><p class="muted">No pool selected. <a href="#/pools">Browse pools →</a></p></section>';
    return;
  }
  const comp = getCompetitionState();
  const isEveryone = id === EVERYONE_GROUP_ID;
  const pool = (comp.groups || []).find((g) => g.id === id) || null;
  const isMember = !!pool;
  const name = pool?.name || (isEveryone ? 'Everyone' : 'Pool');

  root.appendChild(renderHeader(name, isMember, id));

  const body = document.createElement('section');
  body.className = 'home-card';
  body.dataset.testid = 'pool-standings';
  root.appendChild(body);

  // Signed-out (or Supabase off): standings need an authed reader.
  if (!comp.user) {
    body.innerHTML = `
      <p class="muted" style="margin:0 0 10px;">${isSupabaseConfigured()
        ? 'Sign in to view this pool’s standings.'
        : 'Cloud is not configured on this deploy, so pool standings aren’t available.'}</p>`;
    if (isSupabaseConfigured()) {
      const b = document.createElement('button');
      b.className = 'pick-btn';
      b.textContent = 'Sign in';
      b.addEventListener('click', () => openAuth('signin'));
      body.appendChild(b);
    }
    return;
  }

  // Signed-in but not a member of this pool → RLS blocks reading standings.
  if (!isMember && !isEveryone) {
    body.innerHTML = `<p class="muted" style="margin:0 0 10px;">Join <strong>${escapeHtml(name)}</strong> to see its standings.</p>`;
    if (params.code) {
      const b = document.createElement('button');
      b.className = 'pick-btn';
      b.textContent = `Join ${name}`;
      b.setAttribute('data-testid', 'standings-join');
      b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = 'Joining…';
        try { await joinPoolByCode(params.code); setRoute('standings', { id }); }
        catch (err) { b.disabled = false; b.textContent = `Join ${name}`; body.appendChild(errLine(err.message || 'Could not join.')); }
      });
      body.appendChild(b);
    } else {
      body.insertAdjacentHTML('beforeend', '<p class="muted" style="font-size:12px;">Find it in the <a href="#/pools">Discover</a> tab.</p>');
    }
    return;
  }

  // Member (or Everyone): show the standings. Set active so Home/My-Picks agree.
  setActiveGroup(id);
  body.innerHTML = '<p class="loading">Loading standings…</p>';
  void paintStandings(body, data, id, isEveryone, comp.profile?.username || null);
}

async function paintStandings(body, data, id, isEveryone, myName) {
  let offset = 0;
  let rows = [];
  try {
    rows = await fetchLeaderboard(data, { groupId: id, limit: PAGE, offset });
  } catch (err) {
    body.innerHTML = '';
    body.appendChild(errLine(err.message || 'Could not load standings.'));
    return;
  }
  if (!rows.length) {
    body.innerHTML = '<p class="muted" style="margin:0;">No submissions to this pool yet. Be the first — build your bracket in Play.</p>';
    return;
  }

  body.innerHTML = `
    <h2 class="home-card-title" style="margin-bottom:4px;">Standings</h2>
    <p class="muted" style="margin:0 0 10px; font-size:12px;">Place · player · points (group + knockout, max 180).${isEveryone ? ' Scores update as matches are played.' : ''}</p>
    <ol class="pw-standings" data-testid="standings-list"></ol>
  `;
  const ol = body.querySelector('.pw-standings');
  appendRows(ol, rows, myName);

  // Pagination (Everyone/RPC only — the client combine returns the full pool).
  if (isEveryone && rows.length === PAGE) {
    const more = document.createElement('button');
    more.className = 'pick-btn pick-btn-secondary';
    more.style.marginTop = '10px';
    more.textContent = 'Load more';
    more.addEventListener('click', async () => {
      more.disabled = true; more.textContent = 'Loading…';
      offset += PAGE;
      let next = [];
      try { next = await fetchLeaderboard(data, { groupId: id, limit: PAGE, offset }); }
      catch { next = []; }
      appendRows(ol, next, myName);
      if (next.length === PAGE) { more.disabled = false; more.textContent = 'Load more'; }
      else more.remove();
    });
    body.appendChild(more);
  }
}

function appendRows(ol, rows, myName) {
  for (const r of rows) {
    const place = r.rank ?? (ol.children.length + 1);
    const isMe = myName && r.username === myName;
    const li = document.createElement('li');
    li.className = `pw-standings-row${isMe ? ' is-me' : ''}`;
    const split = (typeof r.groupScore === 'number' && typeof r.knockoutScore === 'number')
      ? `<span class="pw-standings-split muted">${r.groupScore} grp · ${r.knockoutScore} ko</span>` : '';
    li.innerHTML = `
      <span class="pw-standings-place">${place}</span>
      <span class="pw-standings-name">${escapeHtml(r.username)}${isMe ? ' <span class="muted">(you)</span>' : ''}</span>
      <span class="pw-standings-pts"><strong>${r.score}</strong> pts ${split}</span>
    `;
    ol.appendChild(li);
  }
}

function renderHeader(name, isMember, id) {
  const head = document.createElement('section');
  head.className = 'home-card';
  head.style.marginBottom = '12px';
  head.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
      <div>
        <button class="link-btn" id="standings-back" style="background:none;border:0;color:var(--accent);cursor:pointer;padding:0;font-size:13px;">← Pools</button>
        <h1 class="home-card-title" style="margin:4px 0 0;">${escapeHtml(name)}</h1>
      </div>
      ${isMember ? '<button class="pick-btn pick-btn-secondary" id="standings-edit" style="flex:0 0 auto;">Edit my bracket →</button>' : ''}
    </div>
  `;
  head.querySelector('#standings-back')?.addEventListener('click', () => setRoute('pools', {}));
  head.querySelector('#standings-edit')?.addEventListener('click', () => { setActiveGroup(id); setRoute('my-brackets', {}); });
  return head;
}

function errLine(text) {
  const p = document.createElement('p');
  p.className = 'muted';
  p.style.cssText = 'color: var(--bad); margin: 8px 0 0;';
  p.textContent = text;
  return p;
}
