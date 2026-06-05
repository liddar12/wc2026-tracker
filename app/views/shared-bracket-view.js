/* shared-bracket-view.js — A8: render a read-only shared bracket from a
   token (Supabase RPC) or inline base64 payload. Lets the visitor preview
   then "Copy to my brackets" or jump straight to making their own. */

import { escapeHtml } from '../lib/escape.js';
import { loadSharedBracket } from '../share-bracket.js';
import { flagFor } from '../components/team-flag.js';
import { setRoute } from '../state.js';

export async function renderSharedBracketView(root, data, params) {
  root.innerHTML = '<p class="loading">Loading shared bracket…</p>';
  const token = params.token;
  const inline = params.inline;
  let payload = null;
  if (token) payload = await loadSharedBracket(token);
  else if (inline) payload = await loadSharedBracket(`inline:${inline}`);

  root.innerHTML = '';
  if (!payload || !payload.picks) {
    root.innerHTML = `
      <div class="home-card">
        <h2 class="home-card-title">Shared bracket unavailable</h2>
        <p class="muted">The link may be invalid or expired. Build your own at
          <a href="#/my-brackets">My Brackets</a>.</p>
      </div>`;
    return;
  }

  const meta = payload.meta || {};
  const picks = payload.picks;
  const head = document.createElement('div');
  head.className = 'home-card';
  head.innerHTML = `
    <h2 class="home-card-title">${escapeHtml(meta.label || 'Shared bracket')}</h2>
    <p class="muted" style="font-size:12px; margin:0;">${meta.created_at ? `Created ${escapeHtml(formatDate(meta.created_at))} · ` : ''}${Object.keys(picks).length} picks</p>
    <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
      <button class="pick-btn" id="copy-bracket">Copy to my brackets</button>
      <button class="pick-btn pick-btn-secondary" id="open-mine">Open My Brackets</button>
    </div>
  `;
  root.appendChild(head);

  head.querySelector('#copy-bracket').addEventListener('click', () => {
    const draftKey = 'wc26.mybrackets.local';
    const existing = JSON.parse(localStorage.getItem(draftKey) || '{"picks":{}}');
    existing.picks = { ...picks };
    localStorage.setItem(draftKey, JSON.stringify(existing));
    setRoute('my-brackets', {});
  });
  head.querySelector('#open-mine').addEventListener('click', () => setRoute('my-brackets', {}));

  // Render the picks as a simple table
  const list = document.createElement('div');
  list.className = 'home-card';
  list.style.marginTop = '12px';
  list.innerHTML = `<h3 style="margin:0 0 8px;">Picks</h3>`;
  const ul = document.createElement('ul');
  ul.className = 'shared-picks-list';
  const matchNums = Object.keys(picks).sort((a, b) => Number(a) - Number(b));
  for (const k of matchNums) {
    const p = picks[k];
    if (!p?.team) continue;
    const li = document.createElement('li');
    li.className = 'shared-pick-row';
    li.innerHTML = `
      <span class="muted shared-pick-num">M${escapeHtml(k)}</span>
      <span class="shared-pick-vs">${flagFor(p.team_a)} ${escapeHtml(p.team_a || '')} vs ${flagFor(p.team_b)} ${escapeHtml(p.team_b || '')}</span>
      <strong class="shared-pick-winner">${flagFor(p.team)} ${escapeHtml(p.team)}</strong>
    `;
    ul.appendChild(li);
  }
  list.appendChild(ul);
  root.appendChild(list);
}

function formatDate(iso) {
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

