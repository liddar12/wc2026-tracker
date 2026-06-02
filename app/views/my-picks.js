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
  joinPoolByCode,
  joinPoolByName,
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
import { helpCard, HELP_COPY } from '../components/help-card.js';

let competitionSection = null;
let competitionData = null;

export function renderMyPicks(root, data) {
  // R6: help card at the top of My Picks
  root.appendChild(helpCard({ ...HELP_COPY.myPicks, persistKey: 'my-picks' }));
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
  if (!comp.user && !comp.guestMode) {
    // R6: auth UI lives in the toolbar — surface a single hint here
    // instead of mounting the full sign-in panel inline.
    section.innerHTML = `
      <div class="home-card">
        <h2 class="home-card-title">Leaderboard</h2>
        <p class="muted" style="margin:0;">Sign in or continue as a guest from the
          account button in the toolbar to see pool standings here.</p>
      </div>
    `;
    return;
  }

  const joinState = comp.lockState.bracketLocked
    ? `Bracket lock: ${comp.lockState.phase}`
    : 'Bracket open';
  const rows = await fetchLeaderboard(data);
  const activeName = comp.activeGroup?.name || null;
  const leaderboard = rows.length
    ? `<ol class="my-picks-leaderboard">${rows.slice(0, 8).map((r) => `<li><span class="lb-name">${escapeHtml(r.username)}</span><span class="lb-score">${r.score} pts</span></li>`).join('')}</ol>`
    : '<p class="muted">No submissions to this pool yet.</p>';

  // Slimmed panel: pool management moved to /#/pools, bracket building/submitting
  // moved to /#/my-brackets. This card surfaces signed-in status + active
  // pool leaderboard preview + quick links.
  section.innerHTML = `
    <div class="auth-card my-picks-status">
      <div class="my-picks-status-row">
        <div>
          <h2 style="margin:0 0 4px; font-size: 16px;">Signed in as ${escapeHtml(comp.profile?.username || comp.user.email || 'user')}</h2>
          <p class="muted" style="margin: 0; font-size: 12px;">${escapeHtml(joinState)} · ${comp.groups.length} pool${comp.groups.length === 1 ? '' : 's'}${activeName ? ` · Active: ${escapeHtml(activeName)}` : ''}</p>
        </div>
        <button class="pick-btn pick-btn-secondary" id="comp-signout" style="flex: 0 0 auto;">Sign out</button>
      </div>

      <div class="my-picks-cta-grid">
        <a class="pick-btn" href="#/pools">Pools →</a>
        <a class="pick-btn" href="#/my-brackets">My Brackets →</a>
        <a class="pick-btn pick-btn-secondary" href="#/group-picks">Group Picks →</a>
        <a class="pick-btn pick-btn-secondary" href="#/settings">Settings →</a>
      </div>

      ${activeName ? `
        <h3 style="margin: 14px 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-muted);">${escapeHtml(activeName)} leaderboard</h3>
        ${leaderboard}
      ` : '<p class="muted" style="margin-top: 14px;">Pick an active pool from <a href="#/pools">Pools</a> to see its leaderboard here.</p>'}

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
