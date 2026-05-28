/* my-picks.js — show all user picks vs actual, summary, export. */
import { accuracySummary } from '../predictions.js';
import { allPicks, setRoute } from '../state.js';
import {
  initCompetition,
  getCompetitionState,
  signUp,
  signIn,
  signOut,
  continueAsGuest,
  clearAuthDismiss,
  setAuthPanelMode,
  getAuthPanelMode,
  isAuthDismissed,
  isSupabaseConfigured,
  createPrivateGroup,
  joinGroupByCode,
  setActiveGroup,
  saveBracketForActiveGroup,
  fetchLeaderboard,
  getJoinUrls
} from '../competition.js';
import { renderAuthPanel, renderGuestBanner } from '../competition-auth-panel.js';
import { isValidJoinCode } from '../competition-rules.js';

let competitionSection = null;
let competitionData = null;

export function renderMyPicks(root, data) {
  renderCompetition(root, data);

  const summary = accuracySummary(data);

  const stats = document.createElement('div');
  stats.className = 'stat-cards';
  stats.innerHTML = `
    <div class="stat-card"><div class="num">${summary.userCorrect}/${summary.total}</div><div class="lbl">Your correct</div></div>
    <div class="stat-card"><div class="num">${summary.total ? Math.round(summary.userCorrect / summary.total * 100) : 0}%</div><div class="lbl">Your accuracy</div></div>
    <div class="stat-card"><div class="num">${summary.modelCorrect}/${summary.total}</div><div class="lbl">Model correct</div></div>
    <div class="stat-card"><div class="num">${summary.total ? Math.round(summary.modelCorrect / summary.total * 100) : 0}%</div><div class="lbl">Model accuracy</div></div>
  `;
  root.appendChild(stats);

  const exportRow = document.createElement('div');
  exportRow.style.cssText = 'display:flex; gap:8px; margin: 8px 0 16px;';
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'pick-btn';
  exportBtn.textContent = 'Export picks (JSON)';
  exportBtn.addEventListener('click', () => exportPicks());
  exportRow.appendChild(exportBtn);
  root.appendChild(exportRow);

  if (!summary.items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No picks yet. Tap a matchup to make one.';
    root.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'pick-list';
  for (const item of summary.items) {
    const row = document.createElement('div');
    row.className = 'pick-row-item';

    const choice = item.choice === 'team_a' ? item.team_a
      : item.choice === 'team_b' ? item.team_b
      : 'Draw';
    const stamp = item.match
      ? `Group ${item.match.group || '?'} · model: ${escapeHtml(prettyModel(item.match))}`
      : 'Match no longer in data';

    const resCls = item.userResult === 'correct' ? 'correct' : item.userResult === 'wrong' ? 'wrong' : 'pending';
    const resLabel = item.userResult === 'correct' ? '✓' : item.userResult === 'wrong' ? '✗' : '…';

    row.innerHTML = `
      <div>
        <div><strong>${escapeHtml(item.team_a)}</strong> vs <strong>${escapeHtml(item.team_b)}</strong></div>
        <div class="muted" style="font-size:12px;">Your pick: ${escapeHtml(choice)} · ${stamp}</div>
      </div>
      <div class="res ${resCls}" aria-label="${resCls}">${resLabel}</div>
    `;
    if (item.match) {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        location.hash = `#/matchup/team_a/${encodeURIComponent(item.match.team_a)}/team_b/${encodeURIComponent(item.match.team_b)}`;
      });
    }
    list.appendChild(row);
  }
  root.appendChild(list);
}

async function renderCompetition(root, data) {
  competitionData = data;
  const section = document.createElement('section');
  section.className = 'section competition-section';
  section.innerHTML = '<h2>Group Competition (Beta)</h2><p class="muted">Loading competition controls…</p>';
  root.appendChild(section);
  competitionSection = section;
  if (!window.__wc26CompetitionGuestBound) {
    window.__wc26CompetitionGuestBound = true;
    window.addEventListener('competition:guest-continued', () => {
      setRoute('picks', {});
      if (competitionSection && competitionData) {
        paintCompetition(competitionSection, competitionData);
      }
    });
  }
  try {
    await initCompetition(data);
    await paintCompetition(section, data);
  } catch (error) {
    section.innerHTML = `<h2>Group Competition (Beta)</h2><p class="muted">Competition unavailable: ${escapeHtml(error.message || 'Unknown error')}</p>`;
  }
}

function authHandlers(section, data) {
  return {
    getPanelMode: () => getAuthPanelMode(),
    setPanelMode: async (mode, repaint = false) => {
      setAuthPanelMode(mode);
      if (repaint) await paintCompetition(section, data);
    },
    clearGuestDismiss: () => clearAuthDismiss(),
    onGuest: () => {
      continueAsGuest();
    },
    onSignIn: async () => {
      const username = section.querySelector('#comp-username')?.value.trim();
      const password = section.querySelector('#comp-password')?.value;
      try {
        setMessage(section, '');
        if (!isSupabaseConfigured()) throw new Error('Login is not configured on this deploy.');
        await signIn(username, password);
        await paintCompetition(section, data);
      } catch (err) {
        setMessage(section, err.message || 'Sign in failed', true);
      }
    },
    onSignUp: async () => {
      const username = section.querySelector('#comp-username')?.value.trim();
      const password = section.querySelector('#comp-password')?.value;
      try {
        setMessage(section, '');
        if (!isSupabaseConfigured()) throw new Error('Account creation is not configured on this deploy.');
        await signUp(username, password);
        await paintCompetition(section, data);
      } catch (err) {
        setMessage(section, err.message || 'Sign up failed', true);
      }
    }
  };
}

async function paintCompetition(section, data) {
  const comp = getCompetitionState();
  if (!comp.user) {
    if (comp.guestMode && isAuthDismissed()) {
      renderGuestBanner(section, comp, authHandlers(section, data));
      return;
    }
    renderAuthPanel(section, comp, authHandlers(section, data));
    return;
  }

  const joinState = comp.lockState.bracketLocked
    ? `Bracket lock: ${comp.lockState.phase}`
    : 'Bracket open';
  const rows = await fetchLeaderboard(data);
  const { code, path } = getJoinUrls();
  const groups = comp.groups
    .map((g) => `<option value="${escapeHtml(g.id)}" ${comp.activeGroup?.id === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`)
    .join('');
  const leaderboard = rows.length
    ? `<ol style="padding-left:20px;">${rows.map((r) => `<li>${escapeHtml(r.username)} · ${r.score} pts</li>`).join('')}</ol>`
    : '<p class="muted">No submissions yet.</p>';

  section.innerHTML = `
    <h2>Group Competition (Beta)</h2>
    <div class="auth-card">
      <p class="muted">${escapeHtml(joinState)} · Signed in as ${escapeHtml(comp.profile?.username || comp.user.email || 'user')}</p>
      <div class="auth-actions">
        <button class="pick-btn" id="comp-signout">Sign Out</button>
        <button class="pick-btn" id="comp-save" ${comp.lockState.bracketLocked ? 'disabled' : ''}>Save My Bracket to Group</button>
      </div>
      <div style="display:grid; gap:8px; margin:10px 0;">
        <label class="muted">Your groups</label>
        <select id="comp-group-select" class="auth-input"><option value="">Choose group</option>${groups}</select>
        <div class="auth-grid">
          <input id="comp-new-group" class="auth-input" placeholder="New private group name" aria-label="New private group name">
          <button class="pick-btn" id="comp-create-group">Create Group</button>
        </div>
        <div class="auth-grid">
          <input id="comp-join-code" class="auth-input" placeholder="Join code (silver-otter-4821)" aria-label="Join code">
          <button class="pick-btn" id="comp-join-group">Join by Code</button>
        </div>
      </div>
      ${code ? `<p class="muted">Code: <code>${escapeHtml(code)}</code> · URL: <a href="${escapeHtml(path)}">${escapeHtml(path)}</a></p>` : '<p class="muted">Select a group to share code + URL.</p>'}
      ${comp.joinNotice ? `<p class="muted auth-join-note">${escapeHtml(comp.joinNotice)}</p>` : ''}
      <h3 style="margin-top:12px;">Leaderboard</h3>
      ${leaderboard}
      <p class="muted" id="comp-msg" role="status" aria-live="polite" style="margin-top:8px;"></p>
    </div>
  `;

  section.querySelector('#comp-signout').addEventListener('click', async () => {
    const signOutBtn = section.querySelector('#comp-signout');
    setButtonBusy(signOutBtn, true);
    try {
      setMessage(section, '');
      await signOut();
      await paintCompetition(section, data);
    } catch (err) {
      setMessage(section, err.message || 'Could not sign out', true);
    } finally {
      setButtonBusy(signOutBtn, false);
    }
  });
  section.querySelector('#comp-group-select').addEventListener('change', async (e) => {
    try {
      setMessage(section, '');
      setActiveGroup(e.target.value);
      await paintCompetition(section, data);
    } catch (err) {
      setMessage(section, err.message || 'Could not switch group', true);
    }
  });
  section.querySelector('#comp-create-group').addEventListener('click', async () => {
    const createBtn = section.querySelector('#comp-create-group');
    const name = section.querySelector('#comp-new-group').value.trim();
    setButtonBusy(createBtn, true);
    try {
      setMessage(section, '');
      if (!name) throw new Error('Enter a group name');
      await createPrivateGroup(name);
      await paintCompetition(section, data);
    } catch (err) {
      setMessage(section, err.message || 'Could not create group. Please try again.', true);
    } finally {
      setButtonBusy(createBtn, false);
    }
  });
  section.querySelector('#comp-join-group').addEventListener('click', async () => {
    const joinBtn = section.querySelector('#comp-join-group');
    const codeInput = section.querySelector('#comp-join-code').value.trim();
    setButtonBusy(joinBtn, true);
    try {
      setMessage(section, '');
      if (!codeInput) throw new Error('Enter a join code');
      if (!isValidJoinCode(codeInput)) throw new Error('Code format must look like silver-otter-4821');
      await joinGroupByCode(codeInput);
      await paintCompetition(section, data);
    } catch (err) {
      setMessage(section, err.message || 'Could not join group. Verify the code and try again.', true);
    } finally {
      setButtonBusy(joinBtn, false);
    }
  });
  section.querySelector('#comp-save').addEventListener('click', async () => {
    const saveBtn = section.querySelector('#comp-save');
    setButtonBusy(saveBtn, true);
    try {
      setMessage(section, '');
      const score = await saveBracketForActiveGroup(data);
      setMessage(section, `Bracket saved. Current score: ${score}`);
      await paintCompetition(section, data);
    } catch (err) {
      setMessage(section, err.message || 'Could not save bracket. Check group access and try again.', true);
    } finally {
      setButtonBusy(saveBtn, false);
    }
  });
}

function prettyModel(m) {
  if (m.predicted_winner === 'draw_likely') return `draw (${m.win_confidence_pct.toFixed(0)}%)`;
  return `${m.predicted_winner} ${m.win_confidence_pct.toFixed(0)}%`;
}

function exportPicks() {
  const blob = new Blob([JSON.stringify(allPicks(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wc26-picks-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function setMessage(section, text, isError = false) {
  const msgEl = section.querySelector('#comp-msg');
  if (!msgEl) return;
  msgEl.textContent = text || '';
  msgEl.setAttribute('role', isError ? 'alert' : 'status');
  msgEl.setAttribute('aria-live', isError ? 'assertive' : 'polite');
}

function setButtonBusy(button, busy) {
  if (!button) return;
  button.disabled = !!busy;
  button.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
