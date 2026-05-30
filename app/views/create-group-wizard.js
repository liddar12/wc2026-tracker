/* create-group-wizard.js — dedicated 3-step wizard for creating a private group.
   Step 1: Auth gate (sign in or create account if needed)
   Step 2: Group details (name + 8+ char passphrase)
   Step 3: Group created celebration (copy code, copy URL, share, build bracket)
*/
import { setRoute } from '../state.js';
import {
  getCompetitionState,
  isSupabaseConfigured,
  signIn,
  signUp,
  createPrivateGroup,
  initCompetition,
} from '../competition.js';

const ICON_COPY = '📋';
const ICON_SHARE = '↗';

export function renderCreateGroupWizard(root, data) {
  root.innerHTML = '';
  const wizard = document.createElement('section');
  wizard.className = 'cg-wizard';
  root.appendChild(wizard);

  const ctx = {
    step: 1,
    error: '',
    pendingGroup: null,
    data,
  };

  paint(wizard, ctx);
}

function paint(wizard, ctx) {
  const comp = getCompetitionState();
  // If user not signed in and Supabase is configured, force step 1 (auth)
  if (isSupabaseConfigured() && !comp.user) ctx.step = 1;
  else if (ctx.step === 1 && comp.user) ctx.step = 2;

  wizard.innerHTML = `
    ${stepperHtml(ctx.step)}
    <div class="cg-card" id="cg-card-${ctx.step}"></div>
  `;
  const card = wizard.querySelector('.cg-card');

  if (ctx.step === 1) renderAuthStep(card, ctx, () => {
    ctx.step = 2; paint(wizard, ctx);
  });
  else if (ctx.step === 2) renderDetailsStep(card, ctx, (group) => {
    ctx.pendingGroup = group;
    ctx.step = 3;
    paint(wizard, ctx);
  });
  else renderCelebrationStep(card, ctx);
}

function stepperHtml(step) {
  const cls = (n) => n < step ? 'cg-step is-done' : n === step ? 'cg-step is-active' : 'cg-step';
  return `
    <div class="cg-stepper" role="progressbar" aria-valuemin="1" aria-valuemax="3" aria-valuenow="${step}" aria-label="Wizard progress">
      <div class="${cls(1)}"></div>
      <div class="${cls(2)}"></div>
      <div class="${cls(3)}"></div>
    </div>
  `;
}

function renderAuthStep(card, ctx, onDone) {
  if (!isSupabaseConfigured()) {
    card.innerHTML = `
      <h2>Sign in unavailable</h2>
      <p class="muted">This build does not have Supabase configured. Group competitions require login on the deployed site.</p>
      <div class="cg-actions">
        <button class="pick-btn" id="cg-cancel">Back to Home</button>
      </div>
    `;
    card.querySelector('#cg-cancel').addEventListener('click', () => setRoute('home', {}));
    return;
  }
  card.innerHTML = `
    <h2>Step 1 · Sign in</h2>
    <p class="muted">You need an account to create a private group. Username and password — no email needed.</p>
    <label for="cg-username">Username (or email)</label>
    <input id="cg-username" class="auth-input" placeholder="silverotter" autocomplete="username email" aria-label="Username">
    <label for="cg-password">Password</label>
    <input id="cg-password" type="password" class="auth-input" placeholder="8+ characters" autocomplete="current-password" aria-label="Password">
    <p class="muted" id="cg-msg" role="status" aria-live="polite"></p>
    <div class="cg-actions">
      <button class="pick-btn" id="cg-signin">Sign In</button>
      <button class="pick-btn pick-btn-secondary" id="cg-signup">Create Account</button>
    </div>
    <div class="cg-actions">
      <button class="pick-btn pick-btn-secondary" id="cg-cancel" type="button">Cancel</button>
    </div>
  `;
  const msg = card.querySelector('#cg-msg');
  const setMsg = (t, err) => { msg.textContent = t || ''; msg.setAttribute('role', err ? 'alert' : 'status'); };
  const u = () => card.querySelector('#cg-username').value.trim();
  const p = () => card.querySelector('#cg-password').value;
  const busy = (btn, on) => { btn.disabled = !!on; btn.setAttribute('aria-busy', on ? 'true' : 'false'); };
  card.querySelector('#cg-signin').addEventListener('click', async (e) => {
    const btn = e.currentTarget; busy(btn, true);
    try { setMsg(''); await signIn(u(), p()); await initCompetition(ctx.data); onDone(); }
    catch (err) { setMsg(err.message || 'Sign in failed', true); }
    finally { busy(btn, false); }
  });
  card.querySelector('#cg-signup').addEventListener('click', async (e) => {
    const btn = e.currentTarget; busy(btn, true);
    try { setMsg(''); await signUp(u(), p()); await initCompetition(ctx.data); onDone(); }
    catch (err) { setMsg(err.message || 'Account creation failed', true); }
    finally { busy(btn, false); }
  });
  card.querySelector('#cg-cancel').addEventListener('click', () => setRoute('home', {}));
}

function renderDetailsStep(card, ctx, onCreated) {
  card.innerHTML = `
    <h2>Step 2 · Group details</h2>
    <p class="muted">Pick a name and a passphrase that you'll share with friends so they can join.</p>
    <label for="cg-name">Group name</label>
    <input id="cg-name" class="auth-input" placeholder="The Underdogs 2026" aria-label="Group name" required>
    <label for="cg-pass">Group passphrase (8+ characters)</label>
    <input id="cg-pass" type="password" class="auth-input" placeholder="something memorable" aria-label="Passphrase" required>
    <p class="muted" id="cg-validation" role="status" aria-live="polite"></p>
    <p class="muted" id="cg-msg" role="alert" aria-live="assertive"></p>
    <div class="cg-actions">
      <button class="pick-btn" id="cg-create" disabled>Create group</button>
      <button class="pick-btn pick-btn-secondary" id="cg-back" type="button">Cancel</button>
    </div>
  `;
  const name = card.querySelector('#cg-name');
  const pass = card.querySelector('#cg-pass');
  const validation = card.querySelector('#cg-validation');
  const msg = card.querySelector('#cg-msg');
  const createBtn = card.querySelector('#cg-create');
  const setMsg = (t, err) => { msg.textContent = t || ''; msg.setAttribute('role', err ? 'alert' : 'status'); };
  const recheck = () => {
    const n = name.value.trim(); const p = pass.value.trim();
    if (!n) { validation.textContent = 'Enter a group name.'; createBtn.disabled = true; return; }
    if (n.length < 2) { validation.textContent = 'Group name must be at least 2 characters.'; createBtn.disabled = true; return; }
    if (!p) { validation.textContent = 'Enter a passphrase to share with friends.'; createBtn.disabled = true; return; }
    if (p.length < 8) { validation.textContent = 'Passphrase must be at least 8 characters.'; createBtn.disabled = true; return; }
    validation.textContent = '';
    createBtn.disabled = false;
  };
  name.addEventListener('input', recheck);
  pass.addEventListener('input', recheck);
  recheck();
  card.querySelector('#cg-back').addEventListener('click', () => setRoute('home', {}));
  createBtn.addEventListener('click', async () => {
    createBtn.setAttribute('aria-busy', 'true');
    createBtn.disabled = true;
    try {
      setMsg('');
      const group = await createPrivateGroup(name.value, pass.value);
      onCreated(group);
    } catch (err) {
      setMsg(err.message || 'Could not create group. Please try again.', true);
      createBtn.disabled = false;
    } finally {
      createBtn.setAttribute('aria-busy', 'false');
    }
  });
}

function renderCelebrationStep(card, ctx) {
  const group = ctx.pendingGroup;
  if (!group) {
    card.innerHTML = `<p class="muted">Hmm, group reference missing.</p><div class="cg-actions"><button class="pick-btn" id="cg-home">Back to Home</button></div>`;
    card.querySelector('#cg-home').addEventListener('click', () => setRoute('home', {}));
    return;
  }
  const joinUrl = `${location.origin}/join/${encodeURIComponent(group.code)}`;
  const shareMessage = `Join my World Cup 2026 bracket pool "${group.name}" — code ${group.code} at ${joinUrl}`;
  card.classList.add('cg-celebration');
  card.innerHTML = `
    <div class="cg-confetti" aria-hidden="true">🎉</div>
    <h2>Group created</h2>
    <p class="muted">Share the code or magic link below. Friends sign up, enter the passphrase, and join.</p>
    <div class="cg-codebox">
      <div class="cg-codebox-label">Join code</div>
      <div class="cg-codebox-value" id="cg-code">${escapeHtml(group.code)}</div>
    </div>
    <div class="cg-codebox">
      <div class="cg-codebox-label">Magic link</div>
      <div class="cg-codebox-value" id="cg-url" style="font-size:14px;">${escapeHtml(joinUrl)}</div>
    </div>
    <div class="cg-share-row">
      <button class="pick-btn" id="cg-copy-code">${ICON_COPY} Copy code</button>
      <button class="pick-btn" id="cg-copy-url">${ICON_COPY} Copy link</button>
    </div>
    ${navigator.share ? `<div class="cg-share-row" style="grid-template-columns: 1fr;"><button class="pick-btn" id="cg-share-btn">${ICON_SHARE} Share with friends</button></div>` : ''}
    <p class="muted" id="cg-copied" role="status" aria-live="polite"></p>
    <div class="cg-actions">
      <button class="pick-btn" id="cg-build-bracket">Build my bracket →</button>
      <button class="pick-btn pick-btn-secondary" id="cg-done">Done</button>
    </div>
  `;
  const status = card.querySelector('#cg-copied');
  const flash = (t) => { status.textContent = t; setTimeout(() => { if (status.textContent === t) status.textContent = ''; }, 2500); };
  card.querySelector('#cg-copy-code').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(group.code); flash('Code copied to clipboard'); }
    catch { flash('Could not copy — long-press the code to copy manually.'); }
  });
  card.querySelector('#cg-copy-url').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(joinUrl); flash('Link copied to clipboard'); }
    catch { flash('Could not copy — long-press the link to copy manually.'); }
  });
  if (navigator.share) {
    card.querySelector('#cg-share-btn')?.addEventListener('click', async () => {
      try { await navigator.share({ title: 'WC26 group invite', text: shareMessage, url: joinUrl }); flash('Shared'); }
      catch { /* user cancelled, ignore */ }
    });
  }
  card.querySelector('#cg-build-bracket').addEventListener('click', () => setRoute('my-brackets', {}));
  card.querySelector('#cg-done').addEventListener('click', () => setRoute('home', {}));
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
