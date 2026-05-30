/* pools-view.js — discover and join bracket pools.
   - "Discover" tab: public pools, anyone signed-in can join.
   - "My pools" tab: pools you've created or joined.
   - Always-visible "Join by code" and "Join by name" boxes (private pools).
   - "Create pool" CTA → /#/create-group wizard.
*/
import { setRoute } from '../state.js';
import { isValidJoinCode } from '../competition-rules.js';
import {
  getCompetitionState,
  isSupabaseConfigured,
  fetchPublicPools,
  joinPoolByCode,
  joinPoolByName,
  setActiveGroup,
} from '../competition.js';

export function renderPoolsView(root, data, params) {
  root.innerHTML = '';
  const comp = getCompetitionState();
  if (!isSupabaseConfigured()) {
    root.appendChild(notice('Pools require cloud login (not configured on this build).'));
    return;
  }

  // Hero with join inputs + create CTA
  root.appendChild(renderHero(comp));

  const view = params?.view === 'mine' ? 'mine' : 'discover';
  const tabs = document.createElement('div');
  tabs.className = 'pools-tabs';
  tabs.innerHTML = `
    <button type="button" class="${view === 'discover' ? 'is-active' : ''}" data-view="discover">Discover</button>
    <button type="button" class="${view === 'mine' ? 'is-active' : ''}" data-view="mine">My pools (${comp.groups.length})</button>
  `;
  tabs.addEventListener('click', (e) => {
    const t = e.target.closest('button[data-view]');
    if (!t) return;
    setRoute('pools', t.dataset.view === 'mine' ? { view: 'mine' } : {});
  });
  root.appendChild(tabs);

  const listWrap = document.createElement('div');
  listWrap.className = 'pools-list';
  root.appendChild(listWrap);

  if (view === 'mine') {
    renderMyPools(listWrap, comp);
  } else {
    listWrap.innerHTML = '<p class="loading">Loading public pools…</p>';
    fetchPublicPools(100).then((pools) => {
      renderDiscoverList(listWrap, pools, comp);
    }).catch(() => {
      listWrap.innerHTML = '';
      listWrap.appendChild(notice('Could not load public pools. Try again in a moment.'));
    });
  }
}

function renderHero(comp) {
  const hero = document.createElement('section');
  hero.className = 'pools-hero';
  const signedIn = !!comp.user;
  hero.innerHTML = `
    <h2>Bracket pools</h2>
    <p class="muted">Compete with friends. Public pools are listed below; private pools join by name or magic link — no passwords.</p>
    ${signedIn ? `
      <div class="cg-actions" style="margin: 0;">
        <button class="pick-btn" id="pools-create">Create a pool</button>
      </div>
      <div class="pools-join-row" style="margin-top: 14px;">
        <input id="pools-join-code" class="auth-input" placeholder="Join by code (silver-otter-4821)" aria-label="Join by code">
        <button class="pick-btn pick-btn-secondary" id="pools-join-code-btn">Join</button>
      </div>
      <div class="pools-join-row">
        <input id="pools-join-name" class="auth-input" placeholder="Join private pool by exact name" aria-label="Join by exact name">
        <button class="pick-btn pick-btn-secondary" id="pools-join-name-btn">Join</button>
      </div>
      <p class="muted" id="pools-msg" role="status" aria-live="polite" style="margin: 6px 0 0; font-size: 12px;"></p>
    ` : `
      <p class="muted">Sign in to create or join a pool.</p>
      <div class="cg-actions" style="margin: 0;">
        <button class="pick-btn" id="pools-signin">Sign in</button>
      </div>
    `}
  `;

  const setMsg = (text, err) => {
    const el = hero.querySelector('#pools-msg');
    if (!el) return;
    el.textContent = text || '';
    el.setAttribute('role', err ? 'alert' : 'status');
  };

  hero.querySelector('#pools-create')?.addEventListener('click', () => setRoute('create-group', {}));
  hero.querySelector('#pools-signin')?.addEventListener('click', () => setRoute('picks', {}));
  hero.querySelector('#pools-join-code-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const input = hero.querySelector('#pools-join-code');
    const code = String(input?.value || '').trim().toLowerCase();
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      setMsg('');
      if (!code) throw new Error('Enter a join code.');
      if (!isValidJoinCode(code)) throw new Error('Code looks like silver-otter-4821.');
      const group = await joinPoolByCode(code);
      setMsg(`Joined ${group?.name || 'pool'}. Go to My Brackets to submit.`);
      setRoute('pools', { view: 'mine' });
    } catch (err) {
      setMsg(err.message || 'Could not join.', true);
    } finally {
      btn.disabled = false; btn.setAttribute('aria-busy', 'false');
    }
  });
  hero.querySelector('#pools-join-name-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const input = hero.querySelector('#pools-join-name');
    const name = String(input?.value || '').trim();
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      setMsg('');
      if (!name) throw new Error('Type the exact pool name.');
      const group = await joinPoolByName(name);
      setMsg(`Joined ${group?.name || 'pool'}. Go to My Brackets to submit.`);
      setRoute('pools', { view: 'mine' });
    } catch (err) {
      setMsg(err.message || 'Could not join.', true);
    } finally {
      btn.disabled = false; btn.setAttribute('aria-busy', 'false');
    }
  });
  return hero;
}

function renderDiscoverList(wrap, pools, comp) {
  wrap.innerHTML = '';
  if (!pools || !pools.length) {
    wrap.appendChild(emptyState('No public pools yet. Be the first — create one above.'));
    return;
  }
  const myIds = new Set((comp.groups || []).map((g) => g.id));
  for (const p of pools) {
    wrap.appendChild(renderPoolCard(p, { joined: myIds.has(p.id), kind: 'public' }));
  }
  wrap.addEventListener('click', async (e) => {
    const card = e.target.closest('[data-pool-code]');
    if (!card) return;
    const code = card.dataset.poolCode;
    const id = card.dataset.poolId;
    if (myIds.has(id)) {
      // already a member — set as active and route to my-brackets
      setActiveGroup(id);
      setRoute('my-brackets', {});
      return;
    }
    try {
      await joinPoolByCode(code);
      setRoute('pools', { view: 'mine' });
    } catch (err) {
      const msg = document.createElement('p');
      msg.className = 'muted';
      msg.style.cssText = 'color: var(--bad); margin: 8px 0;';
      msg.textContent = err.message || 'Could not join.';
      card.appendChild(msg);
    }
  });
}

function renderMyPools(wrap, comp) {
  wrap.innerHTML = '';
  const list = comp.groups || [];
  if (!list.length) {
    wrap.appendChild(emptyState("You haven't joined any pools yet. Find one in Discover or paste a magic link."));
    return;
  }
  for (const p of list) {
    wrap.appendChild(renderPoolCard(p, { joined: true, kind: p.visibility || 'private' }));
  }
  wrap.addEventListener('click', (e) => {
    const card = e.target.closest('[data-pool-id]');
    if (!card) return;
    setActiveGroup(card.dataset.poolId);
    setRoute('my-brackets', {});
  });
}

function renderPoolCard(p, { joined, kind }) {
  const div = document.createElement('div');
  div.className = 'pool-card';
  div.dataset.poolId = p.id;
  div.dataset.poolCode = p.code;
  div.setAttribute('role', 'button');
  div.setAttribute('tabindex', '0');
  const visBadge = kind === 'public' ? 'is-public' : 'is-private';
  const visLabel = kind === 'public' ? 'PUBLIC' : 'PRIVATE';
  const memberLine = typeof p.member_count === 'number' ? `${p.member_count} member${p.member_count === 1 ? '' : 's'} · ` : '';
  div.innerHTML = `
    <div>
      <div class="pool-name">${escapeHtml(p.name)}</div>
      <div class="pool-meta">${memberLine}code <code>${escapeHtml(p.code || '')}</code></div>
    </div>
    <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end;">
      <span class="pool-badge ${visBadge}">${visLabel}</span>
      ${joined ? '<span class="pool-badge is-joined">JOINED</span>' : ''}
    </div>
  `;
  return div;
}

function emptyState(text) {
  const div = document.createElement('div');
  div.className = 'pools-empty';
  div.textContent = text;
  return div;
}

function notice(text) {
  const div = document.createElement('div');
  div.className = 'bb-locked-banner';
  div.textContent = text;
  return div;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
