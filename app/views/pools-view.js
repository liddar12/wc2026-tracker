/* pools-view.js — discover and join bracket pools.
   - "Discover" tab: public pools, anyone signed-in can join.
   - "My pools" tab: pools you've created or joined.
   - Always-visible "Join by code" and "Join by name" boxes (private pools).
   - "Create pool" CTA → /#/create-group wizard.
*/
import { escapeHtml } from '../lib/escape.js';
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
import { helpCard, HELP_COPY } from '../components/help-card.js';
import { loadBracketDraft } from '../bracket-builder.js';
import { openAuth } from '../auth-modal.js';
import { isStage1Complete, isStage2Complete, loadGroupPicks } from '../group-picks-builder.js';

export function renderPoolsView(root, data, params) {
  root.innerHTML = '';
  root.appendChild(helpCard({ ...HELP_COPY.pools, persistKey: 'pools' }));
  const comp = getCompetitionState();
  if (!isSupabaseConfigured()) {
    root.appendChild(notice('Pools require cloud login (not configured on this build).'));
    return;
  }

  // Hero with join inputs + create CTA
  root.appendChild(renderHero(comp));

  // R6: per-pool "Finish your bracket" status flag
  const incomplete = (comp.groups || []).filter((g) => !isCompleteBracketFor(g.id));
  if (incomplete.length) {
    const banner = document.createElement('section');
    banner.className = 'home-card pw-pool-status-banner';
    banner.setAttribute('data-testid', 'pools-finish-banner');
    banner.innerHTML = `
      <h2 class="home-card-title">Brackets owed</h2>
      <p class="muted" style="font-size:12px; margin: 0 0 8px;">${incomplete.length} pool${incomplete.length === 1 ? '' : 's'} still need your entry.</p>
      <ul class="pw-pool-owed-list">
        ${incomplete.slice(0, 6).map((g) => `
          <li>
            <span>${escapeHtml(g.name)}</span>
            <button class="pick-btn pick-btn-secondary" data-pool="${escapeHtml(g.id)}" data-testid="pool-finish-${escapeHtml(g.id)}">Finish your bracket →</button>
          </li>
        `).join('')}
      </ul>
    `;
    banner.querySelectorAll('[data-pool]').forEach((b) => {
      b.addEventListener('click', () => {
        setActiveGroup(b.dataset.pool);
        setRoute('play', { stage: '1' });
      });
    });
    root.appendChild(banner);
  }

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
  // R20 (RC3): open the auth modal like every other "Sign in" — was the lone
  // setRoute('picks') dead-end.
  hero.querySelector('#pools-signin')?.addEventListener('click', () => openAuth('signin'));
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
  wrap.addEventListener('click', (e) => {
    const card = e.target.closest('[data-pool-id]');
    if (!card) return;
    // R18: tapping a pool opens its STANDINGS (place · player · points). The
    // standings view shows the ranked list for members, or a "join to view"
    // CTA for non-members (RLS blocks reading non-member standings). Pass the
    // code so the standings view can offer one-tap join.
    setRoute('standings', { id: card.dataset.poolId, code: card.dataset.poolCode });
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
    // R18: open the pool's standings (was → my-brackets, which showed YOUR
    // bracket, not the ranked list).
    setRoute('standings', { id: card.dataset.poolId });
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

// R6: "is the bracket complete for this pool?" — used by the Brackets-owed banner.
function isCompleteBracketFor(poolId) {
  try {
    const picks = loadGroupPicks(poolId);
    if (!isStage1Complete(picks) || !isStage2Complete(picks)) return false;
    const draft = loadBracketDraft(poolId);
    if (!draft?.picks) return false;
    // 3rd place + Final must be decided
    if (!draft.picks['103']?.team) return false;
    if (!draft.picks['104']?.team) return false;
    return true;
  } catch { return false; }
}
