import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { allPicks } from './state.js';
import { deriveLockState, isValidJoinCode, buildPostJoinPath, extractJoinCodeFromPath } from './competition-rules.js';
import { normalizeUsername, normalizeSignInIdentifier, usernameToAuthEmail } from './competition-auth.js';
import { normalizeBracketPicks, normalizeKnockoutPicks, scoreBracket, scoreBracketWeighted, compareLeaderboardEntries } from './competition-scoring.js';

const LS_GROUP = 'wc26.competition.group';
const LS_GUEST_MODE = 'wc26.competition.guestMode';
const LS_AUTH_DISMISSED = 'wc26.competition.authDismissed';
const LS_AUTH_PANEL = 'wc26.competition.authPanel';
const LS_BRACKET_DRAFTS = 'wc26.competition.bracketDrafts';
const LS_ACTIVE_DRAFT = 'wc26.competition.activeDraft';
const WORDS = ['silver', 'otter', 'falcon', 'cedar', 'lunar', 'atlas', 'harbor', 'summit', 'cobalt', 'aurora'];

const state = {
  client: null,
  user: null,
  profile: null,
  groups: [],
  activeGroup: null,
  activeCode: null,
  invalidJoinCode: null,
  joinNotice: '',
  lockState: { isLocked: false, phase: 'open' },
  guestMode: loadGuestMode(),
  authDismissed: loadAuthDismissed(),
  authPanel: loadAuthPanel(),
  bracketDrafts: loadBracketDrafts(),
  activeDraftId: loadActiveDraftId(),
  authSubscription: null,
  hadJoinLanding: false
};

export function getCompetitionState() {
  return state;
}

export async function initCompetition(data) {
  state.lockState = deriveLockState(data?.scheduleFull || []);
  state.invalidJoinCode = null;
  state.joinNotice = '';
  const pendingJoinCode = extractJoinCodeFromPath(location.pathname);
  if (pendingJoinCode) {
    state.activeCode = pendingJoinCode;
    state.hadJoinLanding = true;
    state.joinNotice = `Invite code ${pendingJoinCode} detected. Sign in to join this private group.`;
    state.authDismissed = false;
    state.authPanel = 'entry';
    stripJoinPath();
  } else if (location.pathname.split('/').filter(Boolean).includes('join')) {
    const parts = location.pathname.split('/').filter(Boolean);
    const joinIndex = parts.indexOf('join');
    state.invalidJoinCode = decodeURIComponent(parts[joinIndex + 1] || '').toLowerCase() || '(missing)';
    state.joinNotice = 'Invite link looks invalid. Check that the code matches word-word-1234.';
    stripJoinPath();
  }
  if (state.client) {
    state.user = await resolveCurrentUser();
    if (state.user) {
      setGuestMode(false);
      await loadProfileAndGroups();
      await consumePendingJoinCode();
    }
    return state;
  }
  const cfg = getConfig();
  if (!cfg.url || !cfg.anonKey) return state;
  state.client = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  wireAuthSubscription();

  state.user = await resolveCurrentUser();
  if (state.user) {
    setGuestMode(false);
    await loadProfileAndGroups();
    await consumePendingJoinCode();
  }
  return state;
}

function getConfig() {
  const env = window.__WC26_CONFIG__ || {};
  return {
    url: env.supabaseUrl || localStorage.getItem('wc26.supabase.url') || '',
    anonKey: env.supabaseAnonKey || localStorage.getItem('wc26.supabase.anonKey') || ''
  };
}

function stripJoinPath() {
  history.replaceState({}, '', buildPostJoinPath(location.pathname, location.hash));
}

async function loadProfileAndGroups() {
  if (!state.client || !state.user) return;
  const { data: profile } = await state.client
    .from('profiles')
    .select('user_id,username')
    .eq('user_id', state.user.id)
    .maybeSingle();
  state.profile = profile || null;

  const { data: memberships } = await state.client
    .from('group_members')
    .select('group_id, groups:groups!inner(id,name,code,created_by)')
    .eq('user_id', state.user.id);
  state.groups = (memberships || []).map((m) => m.groups);
  const desiredGroup = localStorage.getItem(LS_GROUP);
  state.activeGroup = state.groups.find((g) => g.id === desiredGroup) || state.groups[0] || null;
}

export async function signUp(identifier, password) {
  if (!state.client) throw new Error('Supabase not configured');
  assertPassword(password);
  const raw = String(identifier || '').trim();
  let email;
  let profileUsername;
  if (raw.includes('@')) {
    const parsed = normalizeSignInIdentifier(raw);
    email = parsed.email;
    profileUsername = parsed.inferredUsername || `user_${crypto.randomUUID().slice(0, 8)}`;
  } else {
    profileUsername = normalizeUsername(raw);
    email = usernameToAuthEmail(profileUsername);
  }
  const { data, error } = await state.client.auth.signUp({ email, password });
  if (error) throw error;
  state.user = await resolveCurrentUser();
  if (data.user) {
    await upsertProfileUsername(data.user.id, profileUsername);
  }
  if (!state.user) {
    throw new Error('Account created, but session is not active. Please sign in to continue.');
  }
  if (state.user) {
    clearAuthDismiss();
    setGuestMode(false);
    await loadProfileAndGroups();
    await consumePendingJoinCode();
  }
}

export async function signIn(identifier, password) {
  if (!state.client) throw new Error('Supabase not configured');
  assertPassword(password);
  const { email, inferredUsername } = normalizeSignInIdentifier(identifier);
  const { data, error } = await state.client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  state.user = data.user || (await resolveCurrentUser());
  if (data.user) {
    await ensureProfileExists(data.user.id, inferredUsername);
  }
  if (!state.user) {
    throw new Error('Signed in response received without an active session. Try again.');
  }
  clearAuthDismiss();
  setGuestMode(false);
  await loadProfileAndGroups();
  await consumePendingJoinCode();
}

export async function signOut() {
  if (!state.client) return;
  await state.client.auth.signOut();
  state.user = null;
  state.profile = null;
  state.groups = [];
  state.activeGroup = null;
  setGuestMode(true);
  state.authDismissed = false;
  state.authPanel = 'entry';
  persistAuthDismissed();
}

export async function createPrivateGroup(name, passphraseInput) {
  if (!state.client || !state.user) throw new Error('Login required');
  try {
    const code = generateGroupCode();
    const passphrase = normalizeGroupPassphrase(passphraseInput);
    const { data: group, error } = await state.client.rpc('create_private_group', {
      p_name: String(name || '').trim(),
      p_code: code,
      p_passphrase: passphrase
    });
    if (error || !group) {
      const fallback = await state.client
        .from('groups')
        .insert({ name, code, created_by: state.user.id })
        .select('*')
        .single();
      if (fallback.error) throw fallback.error;
      const { error: membershipError } = await state.client
        .from('group_members')
        .insert({ group_id: fallback.data.id, user_id: state.user.id });
      if (membershipError) throw membershipError;
      await loadProfileAndGroups();
      setActiveGroup(fallback.data.id);
      state.joinNotice = 'Group created, but secure passphrase RPC is missing on this preview. Apply latest migration.';
      return fallback.data;
    }
    const { error: membershipError } = await state.client
      .from('group_members')
      .insert({ group_id: group.id, user_id: state.user.id });
    if (membershipError) throw membershipError;
    await loadProfileAndGroups();
    setActiveGroup(group.id);
    state.joinNotice = `Group "${group.name}" created. Share code ${group.code}.`;
    return group;
  } catch (error) {
    throw toCompetitionError(error, 'createGroup');
  }
}

export async function joinGroupByCode(code, passphrase = '', options = {}) {
  if (passphrase && typeof passphrase === 'object') {
    options = passphrase;
    passphrase = '';
  }
  if (!state.client || !state.user) {
    const pendingCode = String(code || '').trim().toLowerCase();
    state.activeCode = pendingCode;
    state.joinNotice = pendingCode
      ? `Invite code ${pendingCode} saved. Sign in to finish joining.`
      : 'Enter a valid join code like silver-otter-4821.';
    return null;
  }
  const normalized = String(code || '').trim().toLowerCase();
  if (!isValidJoinCode(normalized)) throw new Error('Code format must look like silver-otter-4821');
  try {
    const { data: group, error } = await state.client.rpc('join_group_by_code', {
      p_code: normalized,
      p_passphrase: String(passphrase || '')
    });
    if (error) throw error;
    if (!group) throw new Error('Invalid code');
    state.activeCode = null;
    await loadProfileAndGroups();
    const hasMembership = state.groups.some((entry) => entry.id === group.id);
    if (!hasMembership) {
      throw new Error('Join request accepted, but group access is still syncing. Try again in a few seconds.');
    }
    setActiveGroup(group.id);
    state.joinNotice = `Joined group "${group.name}".`;
    return group;
  } catch (error) {
    const mapped = toCompetitionError(error, 'joinGroup');
    state.joinNotice = mapped.message;
    if (options.silent) return null;
    throw mapped;
  }
}

export function setActiveGroup(groupId) {
  state.activeGroup = state.groups.find((g) => g.id === groupId) || null;
  if (state.activeGroup) localStorage.setItem(LS_GROUP, state.activeGroup.id);
}

export function setGuestMode(enabled) {
  state.guestMode = Boolean(enabled);
  try {
    localStorage.setItem(LS_GUEST_MODE, state.guestMode ? '1' : '0');
  } catch {}
  if (!enabled) {
    state.authDismissed = false;
    persistAuthDismissed();
  }
}

export function isSupabaseConfigured() {
  const cfg = getConfig();
  return Boolean(cfg.url && cfg.anonKey);
}

export function getAuthPanelMode() {
  return state.authPanel || 'entry';
}

export function setAuthPanelMode(mode) {
  state.authPanel = mode || 'entry';
  try {
    localStorage.setItem(LS_AUTH_PANEL, state.authPanel);
  } catch {}
}

export function isAuthDismissed() {
  return Boolean(state.authDismissed);
}

export function clearAuthDismiss() {
  state.authDismissed = false;
  persistAuthDismissed();
}

export function continueAsGuest() {
  setGuestMode(true);
  state.authDismissed = true;
  state.authPanel = 'entry';
  persistAuthDismissed();
  window.dispatchEvent(new CustomEvent('competition:guest-continued'));
}

export function consumeJoinLanding() {
  const landing = Boolean(state.hadJoinLanding);
  state.hadJoinLanding = false;
  return landing;
}

export async function saveBracketForActiveGroup(data) {
  if (!state.client || !state.user || !state.activeGroup) throw new Error('Select a group first');
  if (state.lockState.bracketLocked) throw new Error(`Bracket locked (${state.lockState.phase})`);
  const picks = normalizeKnockoutPicks(resolveSelectedDraftPicks());
  if (!picks.length) throw new Error('Add at least one knockout pick (draws are not valid) before submitting a bracket.');
  const score = scoreBracketWeighted(picks, data).score;
  // Upsert (not insert) so a player can edit and re-submit their one bracket
  // while the bracket is unlocked; PK (group_id,user_id) keeps it one-per-group.
  const { error } = await state.client.from('group_brackets').upsert({
    group_id: state.activeGroup.id,
    user_id: state.user.id,
    picks,
    score,
    updated_at: new Date().toISOString()
  }, { onConflict: 'group_id,user_id' });
  if (error) throw toCompetitionError(error, 'submitBracket');
  return score;
}

export function listBracketDrafts() {
  return [{ id: 'local', name: 'Local default bracket', picks: normalizeBracketPicks(allPicks()) }, ...state.bracketDrafts];
}

export function getActiveDraftId() {
  return state.activeDraftId || 'local';
}

export function setActiveDraft(id) {
  const next = String(id || 'local');
  state.activeDraftId = next;
  try { localStorage.setItem(LS_ACTIVE_DRAFT, next); } catch {}
}

export function createBracketDraft(name) {
  const trimmed = String(name || '').trim();
  if (trimmed.length < 2) throw new Error('Bracket name must be at least 2 characters.');
  const draft = {
    id: crypto.randomUUID(),
    name: trimmed,
    picks: normalizeBracketPicks(allPicks()),
    created_at: new Date().toISOString()
  };
  state.bracketDrafts = [draft, ...state.bracketDrafts];
  persistBracketDrafts();
  setActiveDraft(draft.id);
  return draft;
}

function resolveSelectedDraftPicks() {
  const id = getActiveDraftId();
  if (id === 'local') return allPicks();
  const draft = state.bracketDrafts.find((entry) => entry.id === id);
  return draft?.picks || allPicks();
}

export async function fetchLeaderboard(data) {
  if (!state.client || !state.activeGroup) return [];
  const { data: rows, error } = await state.client
    .from('group_brackets')
    .select('user_id,picks,score,updated_at')
    .eq('group_id', state.activeGroup.id);
  if (error) throw error;
  const ids = [...new Set((rows || []).map((r) => r.user_id).filter(Boolean))];
  let namesById = {};
  if (ids.length) {
    const { data: profiles } = await state.client.from('profiles').select('user_id,username').in('user_id', ids);
    namesById = Object.fromEntries((profiles || []).map((p) => [p.user_id, p.username]));
  }
  const entries = (rows || []).map((r) => {
    const weighted = scoreBracketWeighted(r.picks || [], data);
    return {
      username: namesById[r.user_id] || 'Player',
      score: weighted.score,
      breakdown: weighted.breakdown,
      lastRoundCorrect: weighted.lastRoundCorrect,
      championCorrect: weighted.championCorrect,
      updatedAt: r.updated_at || null,
    };
  });
  entries.sort(compareLeaderboardEntries);
  return entries;
}

export function getJoinUrls() {
  if (!state.activeGroup) return { code: '', path: '' };
  return {
    code: state.activeGroup.code,
    path: `${location.origin}/join/${encodeURIComponent(state.activeGroup.code)}`
  };
}

function generateGroupCode() {
  const a = WORDS[Math.floor(Math.random() * WORDS.length)];
  const b = WORDS[Math.floor(Math.random() * WORDS.length)];
  const n = String(Math.floor(Math.random() * 9000) + 1000);
  return `${a}-${b}-${n}`;
}

async function ensureProfileExists(userId, fallbackUsername) {
  const { data: profile } = await state.client
    .from('profiles')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (profile) return;
  const username = fallbackUsername || `user_${String(userId).slice(0, 8).toLowerCase()}`;
  await upsertProfileUsername(userId, username);
}

async function upsertProfileUsername(userId, username) {
  const { error } = await state.client
    .from('profiles')
    .upsert({ user_id: userId, username }, { onConflict: 'user_id' });
  if (error) throw error;
}

function loadGuestMode() {
  try {
    return localStorage.getItem(LS_GUEST_MODE) === '1';
  } catch {
    return false;
  }
}

function loadAuthDismissed() {
  try {
    return localStorage.getItem(LS_AUTH_DISMISSED) === '1';
  } catch {
    return false;
  }
}

function persistAuthDismissed() {
  try {
    localStorage.setItem(LS_AUTH_DISMISSED, state.authDismissed ? '1' : '0');
  } catch {}
}

function loadAuthPanel() {
  try {
    const raw = localStorage.getItem(LS_AUTH_PANEL);
    return raw === 'signin' || raw === 'signup' ? raw : 'entry';
  } catch {
    return 'entry';
  }
}

function assertPassword(password) {
  if (typeof password !== 'string' || !password.trim()) {
    throw new Error('Enter a password.');
  }
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
}

function normalizeGroupPassphrase(value) {
  const passphrase = String(value || '').trim();
  if (!passphrase) throw new Error('Passphrase is required.');
  if (passphrase.length < 8) throw new Error('Passphrase must be at least 8 characters.');
  return passphrase;
}

function loadBracketDrafts() {
  try {
    const raw = localStorage.getItem(LS_BRACKET_DRAFTS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && entry.id && entry.name) : [];
  } catch {
    return [];
  }
}

function persistBracketDrafts() {
  try {
    localStorage.setItem(LS_BRACKET_DRAFTS, JSON.stringify(state.bracketDrafts));
  } catch {}
}

function loadActiveDraftId() {
  try {
    return localStorage.getItem(LS_ACTIVE_DRAFT) || 'local';
  } catch {
    return 'local';
  }
}

function wireAuthSubscription() {
  if (!state.client || state.authSubscription) return;
  const { data } = state.client.auth.onAuthStateChange(async (_event, session) => {
    state.user = session?.user || null;
    if (state.user) {
      setGuestMode(false);
      await loadProfileAndGroups();
      return;
    }
    state.profile = null;
    state.groups = [];
    state.activeGroup = null;
  });
  state.authSubscription = data?.subscription || null;
}

async function resolveCurrentUser() {
  if (!state.client) return null;
  try {
    const { data, error } = await state.client.auth.getUser();
    if (error) return null;
    return data?.user || null;
  } catch {
    return null;
  }
}

async function consumePendingJoinCode() {
  if (!state.activeCode) return;
  await joinGroupByCode(state.activeCode, { silent: true });
}

function toCompetitionError(error, context) {
  const message = String(error?.message || '').trim();
  if (/invalid code/i.test(message)) {
    return new Error('Join code not found. Check the invite and try again.');
  }
  if (/passphrase required/i.test(message)) {
    return new Error('Group passphrase is required to join.');
  }
  if (/invalid passphrase/i.test(message)) {
    return new Error('Passphrase is incorrect. Ask the group owner for the latest passphrase.');
  }
  if (/duplicate key value|unique constraint|group_brackets_pkey/i.test(message)) {
    return new Error('You already submitted one bracket to this group.');
  }
  if (/row-level security|permission denied|not allowed|forbidden|not authorized/i.test(message)) {
    if (context === 'joinGroup') {
      return new Error('Join request was received, but access is still pending. Ask the group owner to confirm membership.');
    }
    return new Error('You do not have access to that group yet. Refresh and try again.');
  }
  if (!message) return new Error('Competition request failed');
  return error instanceof Error ? error : new Error(message);
}
