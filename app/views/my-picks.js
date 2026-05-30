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
  getJoinUrls,
  listBracketDrafts,
  getActiveDraftId,
  setActiveDraft,
  createBracketDraft
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
  const drafts = listBracketDrafts();
  const activeDraftId = getActiveDraftId();
  const groups = comp.groups
    .map((g) => `<option value="${escapeHtml(g.id)}" ${comp.activeGroup?.id === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`)
    .join('');
  const draftOptions = drafts
    .map((d) => `<option value="${escapeHtml(d.id)}" ${d.id === activeDraftId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`)
    .join('');
  const activeDraft = drafts.find((d) => d.id === activeDraftId) || drafts[0] || null;
  const activeDraftPickCount = Array.isArray(activeDraft?.picks) ? activeDraft.picks.length : 0;
  const canSubmitBracket = !comp.lockState.bracketLocked && Boolean(comp.activeGroup) && activeDraftPickCount > 0;
  const leaderboard = rows.length
    ? `<ol style="padding-left:20px;">${rows.map((r) => `<li>${escapeHtml(r.username)} · ${r.score} pts</li>`).join('')}</ol>`
    : '<p class="muted">No submissions yet.</p>';

  section.innerHTML = `
    <h2>Group Competition (Beta)</h2>
    <div class="auth-card">
      <p class="muted">${escapeHtml(joinState)} · Signed in as ${escapeHtml(comp.profile?.username || comp.user.email || 'user')}</p>
      <div class="auth-actions">
        <button class="pick-btn" id="comp-signout">Sign Out</button>
        <button class="pick-btn" id="comp-go-create">Create Group</button>
      </div>
      <div style="display:grid; gap:8px; margin:10px 0;">
        <label class="muted">Your groups</label>
        <select id="comp-group-select" class="auth-input"><option value="">Choose group</option>${groups}</select>
        <div class="auth-grid">
          <input id="comp-join-code" class="auth-input" placeholder="Join code (silver-otter-4821)" aria-label="Join code">
          <input id="comp-join-passphrase" class="auth-input" placeholder="Group passphrase" type="password" aria-label="Group passphrase">
          <button class="pick-btn" id="comp-join-group">Join by Code</button>
        </div>
      </div>
      ${code ? `<p class="muted">Code: <code>${escapeHtml(code)}</code> · URL: <a href="${escapeHtml(path)}">${escapeHtml(path)}</a></p>` : '<p class="muted">Select a group to share code + URL.</p>'}
      ${comp.joinNotice ? `<p class="muted auth-join-note">${escapeHtml(comp.joinNotice)}</p>` : ''}
      <h3 style="margin-top:12px;">My Brackets</h3>
      <div class="auth-grid">
        <select id="comp-draft-select" class="auth-input">${draftOptions}</select>
        <div class="auth-grid" style="grid-template-columns: 1fr auto;">
          <input id="comp-new-draft" class="auth-input" placeholder="Bracket name for this group">
          <button class="pick-btn" id="comp-create-draft">Create</button>
        </div>
        <p class="muted">Selected bracket has ${activeDraftPickCount} pick${activeDraftPickCount === 1 ? '' : 's'}.</p>
        <button class="pick-btn" id="comp-submit-group" ${canSubmitBracket ? '' : 'disabled'}>Submit Selected Bracket to Group</button>
      </div>
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
  section.querySelector('#comp-go-create').addEventListener('click', () => paintCreateGroup(section, data));
  section.querySelector('#comp-join-group').addEventListener('click', async () => {
    const joinBtn = section.querySelector('#comp-join-group');
    const codeInput = section.querySelector('#comp-join-code').value.trim();
    const passphrase = section.querySelector('#comp-join-passphrase').value;
    setButtonBusy(joinBtn, true);
    try {
      setMessage(section, '');
      if (!codeInput) throw new Error('Enter a join code');
      if (!isValidJoinCode(codeInput)) throw new Error('Code format must look like silver-otter-4821');
      if (!String(passphrase || '').trim()) throw new Error('Passphrase is required to join this private group.');
      await joinGroupByCode(codeInput, passphrase);
      await paintCompetition(section, data);
    } catch (err) {
      setMessage(section, err.message || 'Could not join group. Verify the code and try again.', true);
    } finally {
      setButtonBusy(joinBtn, false);
    }
  });
  section.querySelector('#comp-draft-select').addEventListener('change', (e) => {
    setActiveDraft(e.target.value);
  });
  section.querySelector('#comp-create-draft').addEventListener('click', async () => {
    const createBtn = section.querySelector('#comp-create-draft');
    const name = section.querySelector('#comp-new-draft').value;
    setButtonBusy(createBtn, true);
    try {
      setMessage(section, '');
      createBracketDraft(name);
      await paintCompetition(section, data);
      setMessage(section, 'Bracket draft created from your current local picks.');
    } catch (err) {
      setMessage(section, err.message || 'Could not create bracket draft.', true);
    } finally {
      setButtonBusy(createBtn, false);
    }
  });
  section.querySelector('#comp-submit-group').addEventListener('click', async () => {
    const submitBtn = section.querySelector('#comp-submit-group');
    setButtonBusy(submitBtn, true);
    try {
      setMessage(section, '');
      const score = await saveBracketForActiveGroup(data);
      setMessage(section, `Bracket saved to group. Current score: ${score}. You can edit and re-submit until lock.`);
      await paintCompetition(section, data);
    } catch (err) {
      const message = String(err?.message || '');
      if (/duplicate|unique|group_brackets_pkey/i.test(message)) {
        setMessage(section, 'You already submitted one bracket to this group. One submission per user is enforced.', true);
      } else {
        setMessage(section, message || 'Could not submit bracket. Check group access and try again.', true);
      }
    } finally {
      setButtonBusy(submitBtn, false);
    }
  });
}

function paintCreateGroup(section, data) {
  section.innerHTML = `
    <h2>Group Competition (Beta)</h2>
    <div class="auth-card">
      <h3 style="margin:0;">Create Private Group</h3>
      <p class="muted">Step 1 of 3: Create your group before bracket submission.</p>
      <input id="comp-group-name" class="auth-input" placeholder="Group name" aria-label="Group name" required>
      <input id="comp-group-passphrase" class="auth-input" placeholder="Passphrase (8+ characters)" type="password" aria-label="Passphrase" required>
      <p class="muted" id="comp-group-validation" role="status" aria-live="polite"></p>
      <div class="auth-actions">
        <button class="pick-btn" id="comp-create-submit" disabled>Create Group</button>
        <button class="pick-btn pick-btn-secondary" id="comp-create-cancel" type="button">Back</button>
      </div>
      <p class="muted" id="comp-msg" role="status" aria-live="polite"></p>
    </div>
  `;
  const nameEl = section.querySelector('#comp-group-name');
  const passEl = section.querySelector('#comp-group-passphrase');
  const createBtn = section.querySelector('#comp-create-submit');
  const validation = section.querySelector('#comp-group-validation');
  const refreshValidity = () => {
    const name = nameEl.value.trim();
    const pass = passEl.value.trim();
    if (!name && !pass) {
      validation.textContent = 'Group name and passphrase are required.';
      createBtn.disabled = true;
      return;
    }
    if (!name) {
      validation.textContent = 'Enter a group name.';
      createBtn.disabled = true;
      return;
    }
    if (!pass) {
      validation.textContent = 'Enter a passphrase.';
      createBtn.disabled = true;
      return;
    }
    if (pass.length < 8) {
      validation.textContent = 'Passphrase must be at least 8 characters.';
      createBtn.disabled = true;
      return;
    }
    validation.textContent = '';
    createBtn.disabled = false;
  };
  nameEl.addEventListener('input', refreshValidity);
  passEl.addEventListener('input', refreshValidity);
  refreshValidity();
  section.querySelector('#comp-create-cancel').addEventListener('click', () => paintCompetition(section, data));
  createBtn.addEventListener('click', async () => {
    setButtonBusy(createBtn, true);
    try {
      setMessage(section, '');
      const group = await createPrivateGroup(nameEl.value, passEl.value);
      paintGroupCreated(section, data, group);
    } catch (err) {
      setMessage(section, err.message || 'Could not create group. Please try again.', true);
    } finally {
      setButtonBusy(createBtn, false);
    }
  });
}

function paintGroupCreated(section, data, group) {
  const joinUrl = `${location.origin}/join/${encodeURIComponent(group.code)}`;
  const drafts = listBracketDrafts();
  const activeDraftId = getActiveDraftId();
  const draftOptions = drafts
    .map((d) => `<option value="${escapeHtml(d.id)}" ${d.id === activeDraftId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`)
    .join('');
  const selectedDraft = drafts.find((d) => d.id === activeDraftId) || drafts[0] || null;
  const pickCount = Array.isArray(selectedDraft?.picks) ? selectedDraft.picks.length : 0;
  const comp = getCompetitionState();
  const canSubmitNow = !comp.lockState.bracketLocked && pickCount > 0;
  section.innerHTML = `
    <h2>Group Competition (Beta)</h2>
    <div class="auth-card">
      <h3 style="margin:0;">Group Created</h3>
      <p class="muted">Step 2 of 3 complete. Share these details with your group.</p>
      <p><strong>Group code:</strong> <code>${escapeHtml(group.code)}</code></p>
      <p><strong>Join URL:</strong> <a href="${escapeHtml(joinUrl)}">${escapeHtml(joinUrl)}</a></p>
      <h3 style="margin:8px 0 0;">Step 3 of 3: Submit your bracket</h3>
      <p class="muted">Use your Local default bracket (based on current My Picks) or create one for this group.</p>
      <div class="auth-grid">
        <select id="comp-created-draft-select" class="auth-input">${draftOptions}</select>
        <div class="auth-grid" style="grid-template-columns: 1fr auto;">
          <input id="comp-created-new-draft" class="auth-input" placeholder="Bracket name for this group">
          <button class="pick-btn" id="comp-created-create-draft">Create</button>
        </div>
        <p class="muted" id="comp-created-draft-count">Selected bracket has ${pickCount} pick${pickCount === 1 ? '' : 's'}.</p>
      </div>
      <div class="auth-actions">
        <button class="pick-btn" id="comp-created-submit" ${canSubmitNow ? '' : 'disabled'}>Submit Selected Bracket to Group</button>
        <button class="pick-btn" id="comp-continue-bracket">Continue to Bracket Setup</button>
      </div>
      <p class="muted" id="comp-msg" role="status" aria-live="polite"></p>
    </div>
  `;
  const updateCreatedState = () => {
    const currentDrafts = listBracketDrafts();
    const selectedId = getActiveDraftId();
    const selected = currentDrafts.find((d) => d.id === selectedId) || currentDrafts[0] || null;
    const selectedCount = Array.isArray(selected?.picks) ? selected.picks.length : 0;
    const countEl = section.querySelector('#comp-created-draft-count');
    if (countEl) {
      countEl.textContent = `Selected bracket has ${selectedCount} pick${selectedCount === 1 ? '' : 's'}.`;
    }
    const submitBtn = section.querySelector('#comp-created-submit');
    if (submitBtn) {
      submitBtn.disabled = getCompetitionState().lockState.bracketLocked || selectedCount === 0;
    }
  };
  section.querySelector('#comp-created-draft-select')?.addEventListener('change', (e) => {
    setActiveDraft(e.target.value);
    updateCreatedState();
  });
  section.querySelector('#comp-created-create-draft')?.addEventListener('click', async () => {
    const createBtn = section.querySelector('#comp-created-create-draft');
    const name = section.querySelector('#comp-created-new-draft')?.value || '';
    setButtonBusy(createBtn, true);
    try {
      setMessage(section, '');
      createBracketDraft(name);
      paintGroupCreated(section, data, group);
      setMessage(section, 'Bracket draft created from your current local picks.');
    } catch (err) {
      setMessage(section, err.message || 'Could not create bracket draft.', true);
    } finally {
      setButtonBusy(createBtn, false);
    }
  });
  section.querySelector('#comp-created-submit')?.addEventListener('click', async () => {
    const submitBtn = section.querySelector('#comp-created-submit');
    setButtonBusy(submitBtn, true);
    try {
      setMessage(section, '');
      const score = await saveBracketForActiveGroup(data);
      setMessage(section, `Bracket saved to ${group.name}. Current score: ${score}. You can edit and re-submit until lock.`);
      await paintCompetition(section, data);
    } catch (err) {
      const message = String(err?.message || '');
      if (/duplicate|unique|group_brackets_pkey/i.test(message)) {
        setMessage(section, 'You already submitted one bracket to this group. One submission per user is enforced.', true);
      } else {
        setMessage(section, message || 'Could not submit bracket. Check group access and try again.', true);
      }
    } finally {
      setButtonBusy(submitBtn, false);
    }
  });
  updateCreatedState();
  section.querySelector('#comp-continue-bracket').addEventListener('click', () => paintCompetition(section, data));
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
