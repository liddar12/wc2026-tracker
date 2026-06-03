import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { allPicks } from './state.js';
import { deriveLockState, isValidJoinCode, buildPostJoinPath, extractJoinCodeFromPath } from './competition-rules.js';
import { normalizeUsername, normalizeSignInIdentifier, usernameToAuthEmail } from './competition-auth.js';
import { normalizeBracketPicks, normalizeKnockoutPicks, scoreBracket, scoreBracketWeighted, compareLeaderboardEntries } from './competition-scoring.js';
import { scoreGroupPredictions, normalizeGroupPredictions } from './group-scoring.js';
import { pullServerFavoriteIfAuthed } from './favorites.js';

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
  guestHandle: loadGuestHandle(),
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
    try { await loadProfileAndGroups(); }
    catch (err) { console.warn('[auth] loadProfileAndGroups soft-failed', err?.message || err); }
    try { await consumePendingJoinCode(); }
    catch (err) { console.warn('[auth] consumePendingJoinCode soft-failed', err?.message || err); }
  }
  // R6 QA: notify the toolbar of the resolved state on cold boot
  window.dispatchEvent(new CustomEvent('competition:state-change'));
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
    .select('user_id,username,favorite_team')
    .eq('user_id', state.user.id)
    .maybeSingle();
  state.profile = profile || null;

  const { data: memberships } = await state.client
    .from('group_members')
    .select('group_id, groups:groups!inner(id,name,code,created_by,visibility)')
    .eq('user_id', state.user.id);
  state.groups = (memberships || []).map((m) => m.groups);
  const desiredGroup = localStorage.getItem(LS_GROUP);
  state.activeGroup = state.groups.find((g) => g.id === desiredGroup) || state.groups[0] || null;

  // Sync favorite team from server (server wins for signed-in users so the
  // favorite follows them across devices).
  await pullServerFavoriteIfAuthed();
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
    try { await upsertProfileUsername(data.user.id, profileUsername); }
    catch (err) { console.warn('[auth] upsertProfileUsername soft-failed', err?.message || err); }
  }
  if (!state.user) {
    throw new Error('Account created, but session is not active. Please sign in to continue.');
  }
  clearAuthDismiss();
  setGuestMode(false);
  try { await loadProfileAndGroups(); }
  catch (err) { console.warn('[auth] loadProfileAndGroups soft-failed', err?.message || err); }
  try { await consumePendingJoinCode(); }
  catch (err) { console.warn('[auth] consumePendingJoinCode soft-failed', err?.message || err); }
  // R11: bring any guest-mode drafts forward under the new identity.
  if (state.user?.id) {
    const m = migrateGuestDraftsToUser(state.user.id);
    if (m.migrated.length) console.info('[auth] migrated guest drafts', m.migrated);
  }
  window.dispatchEvent(new CustomEvent('competition:state-change'));
}

export async function signIn(identifier, password) {
  if (!state.client) throw new Error('Supabase not configured');
  assertPassword(password);
  const { email, inferredUsername } = normalizeSignInIdentifier(identifier);
  const { data, error } = await state.client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  state.user = data.user || (await resolveCurrentUser());
  // R6 QA: profile/groups bootstrap must not destroy a successful auth.
  // The deploy-preview Supabase project is missing public.profiles +
  // public.group_members tables, which used to throw out of ensureProfileExists
  // and abort the entire sign-in flow. Best-effort the side calls.
  if (data.user) {
    try { await ensureProfileExists(data.user.id, inferredUsername); }
    catch (err) { console.warn('[auth] ensureProfileExists soft-failed', err?.message || err); }
  }
  if (!state.user) {
    throw new Error('Signed in response received without an active session. Try again.');
  }
  clearAuthDismiss();
  setGuestMode(false);
  try { await loadProfileAndGroups(); }
  catch (err) { console.warn('[auth] loadProfileAndGroups soft-failed', err?.message || err); }
  try { await consumePendingJoinCode(); }
  catch (err) { console.warn('[auth] consumePendingJoinCode soft-failed', err?.message || err); }
  // R11: bring any guest-mode drafts forward under the new identity.
  if (state.user?.id) {
    const m = migrateGuestDraftsToUser(state.user.id);
    if (m.migrated.length) console.info('[auth] migrated guest drafts on signIn', m.migrated);
  }
  // R6 QA: notify the toolbar so its label flips from "Sign in" to the
  // signed-in pill. Without this dispatch the toolbar reverts on the next
  // navigation because syncLabel reads stale state.
  window.dispatchEvent(new CustomEvent('competition:state-change'));
}

export async function signOut() {
  if (!state.client) return;
  await state.client.auth.signOut();
  state.user = null;
  state.profile = null;
  state.groups = [];
  state.activeGroup = null;
  // R6 QA: a sign-out should return the user to the truly-signed-out
  // state, not silently flip them to guest. Toolbar listens for this
  // event to repaint the chip.
  setGuestMode(false);
  state.authDismissed = false;
  state.authPanel = 'entry';
  persistAuthDismissed();
  window.dispatchEvent(new CustomEvent('competition:state-change'));
}

// New: create a pool (public or private). No passphrase. Server-side
// `create_pool` RPC generates the join code and inserts membership atomically.
export async function createPool(name, visibility = 'private') {
  if (!state.client || !state.user) throw new Error('Login required');
  const trimmed = String(name || '').trim();
  if (trimmed.length < 2) throw new Error('Pool name must be at least 2 characters.');
  if (trimmed.length > 80) throw new Error('Pool name must be at most 80 characters.');
  const vis = visibility === 'public' ? 'public' : 'private';
  try {
    const { data: group, error } = await state.client.rpc('create_pool', {
      p_name: trimmed,
      p_visibility: vis,
    });
    if (error) throw error;
    if (!group) throw new Error('Pool creation failed (no row returned).');
    await loadProfileAndGroups();
    setActiveGroup(group.id);
    state.joinNotice = `Pool "${group.name}" created${vis === 'public' ? ' (public)' : ' (private)'}. Share code ${group.code}.`;
    return group;
  } catch (error) {
    throw toCompetitionError(error, 'createGroup');
  }
}

// Backwards-compat shim. Older client code calls createPrivateGroup(name, passphrase);
// the passphrase is now ignored.
export async function createPrivateGroup(name, _passphraseIgnored) {
  return createPool(name, 'private');
}

// New: join by exact name. Only matches private pools (public pools may share
// names). Case-insensitive.
export async function joinPoolByName(name) {
  if (!state.client || !state.user) throw new Error('Login required');
  const trimmed = String(name || '').trim();
  if (trimmed.length < 2) throw new Error('Enter the pool name.');
  try {
    const { data: group, error } = await state.client.rpc('join_pool_by_name', {
      p_name: trimmed,
    });
    if (error) throw error;
    if (!group) throw new Error('No pool by that name.');
    await loadProfileAndGroups();
    setActiveGroup(group.id);
    state.joinNotice = `Joined "${group.name}".`;
    return group;
  } catch (error) {
    throw toCompetitionError(error, 'joinGroup');
  }
}

// New: join a pool by its join code (public or private). No passphrase.
export async function joinPoolByCode(code, options = {}) {
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
    const { data: group, error } = await state.client.rpc('join_pool_by_code', {
      p_code: normalized,
    });
    if (error) throw error;
    if (!group) throw new Error('Invalid code');
    state.activeCode = null;
    await loadProfileAndGroups();
    const hasMembership = state.groups.some((entry) => entry.id === group.id);
    if (!hasMembership) {
      throw new Error('Join request accepted, but pool access is still syncing. Try again in a few seconds.');
    }
    setActiveGroup(group.id);
    state.joinNotice = `Joined "${group.name}".`;
    return group;
  } catch (error) {
    const mapped = toCompetitionError(error, 'joinGroup');
    state.joinNotice = mapped.message;
    if (options.silent) return null;
    throw mapped;
  }
}

// Backwards-compat shim. Older client code calls joinGroupByCode(code, passphrase).
export async function joinGroupByCode(code, _passphraseIgnored = '', options = {}) {
  // Allow the historical 2-arg overload where second arg was options object.
  if (_passphraseIgnored && typeof _passphraseIgnored === 'object') {
    options = _passphraseIgnored;
  }
  return joinPoolByCode(code, options);
}

// New: list publicly discoverable pools. Anon can read these (RLS allows).
export async function fetchPublicPools(limit = 100) {
  if (!state.client) return [];
  try {
    const { data, error } = await state.client
      .from('groups')
      .select('id,name,code,visibility,created_at,created_by')
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    // Pull member counts only when the viewer is authenticated. Anon users
    // can't read group_members (RLS gates it to authenticated + is-member),
    // so for guests we skip the call entirely — otherwise it 401s and
    // shows a noisy error in the console.
    const ids = (data || []).map((g) => g.id);
    let countByGroup = {};
    if (ids.length && state.user) {
      const { data: members } = await state.client
        .from('group_members')
        .select('group_id')
        .in('group_id', ids);
      for (const row of members || []) {
        countByGroup[row.group_id] = (countByGroup[row.group_id] || 0) + 1;
      }
    }
    return (data || []).map((g) => ({ ...g, member_count: countByGroup[g.id] || 0 }));
  } catch {
    return [];
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

export async function saveBracketForActiveGroup(data, explicitPicks) {
  if (!state.client || !state.user || !state.activeGroup) throw new Error('Select a group first');
  if (state.lockState.bracketLocked) throw new Error(`Bracket locked (${state.lockState.phase})`);
  // R14: callers (the Play funnel) now pass the funnel draft's pick array
  // explicitly. The old resolveSelectedDraftPicks() path read the unrelated
  // wc26.picks store and is kept only as a fallback for any legacy caller.
  const picks = normalizeKnockoutPicks(explicitPicks || resolveSelectedDraftPicks());
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

// Upsert group_predictions for the active pool.
export async function saveGroupPredictionsForActiveGroup(picks, data) {
  if (!state.client || !state.user || !state.activeGroup) throw new Error('Select a pool first');
  if (state.lockState.bracketLocked) throw new Error(`Bracket locked (${state.lockState.phase})`);
  const normalized = normalizeGroupPredictions(picks);
  const stored = { ...normalized.groups, best_thirds: normalized.best_thirds };
  const score = scoreGroupPredictions(stored, data).score;
  const { error } = await state.client.from('group_predictions').upsert({
    group_id: state.activeGroup.id,
    user_id: state.user.id,
    picks: stored,
    score,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'group_id,user_id' });
  if (error) throw toCompetitionError(error, 'submitGroupPicks');
  return score;
}

// Fetch the current user's group_predictions for the active pool (or null).
// Also caches the picks on state.cachedGroupPredictions keyed by group_id so
// synchronous callers (my-brackets-view R32 seeding) can read the server-stored
// picks without making the view async.
export async function fetchMyGroupPredictions() {
  if (!state.client || !state.user || !state.activeGroup) return null;
  const { data, error } = await state.client
    .from('group_predictions')
    .select('picks,score,updated_at')
    .eq('group_id', state.activeGroup.id)
    .eq('user_id', state.user.id)
    .maybeSingle();
  if (error) return null;
  if (!state.cachedGroupPredictions) state.cachedGroupPredictions = {};
  if (data?.picks) {
    state.cachedGroupPredictions[state.activeGroup.id] = data.picks;
  }
  return data;
}

// Read-only cache accessor for sync callers. Returns the most recent server-
// fetched group_predictions for the active pool, or null if not yet fetched.
export function getCachedGroupPredictions() {
  if (!state.activeGroup?.id) return null;
  return state.cachedGroupPredictions?.[state.activeGroup.id] || null;
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

// R11: migrateGuestDraftsToUser lives in app/lib/draft-migration.js so the
// node test runner can import it without pulling Supabase via esm.sh.
import { migrateGuestDraftsToUser as _migrate } from './lib/draft-migration.js';
export const migrateGuestDraftsToUser = _migrate;

function loadGuestMode() {
  try {
    return localStorage.getItem(LS_GUEST_MODE) === '1';
  } catch {
    return false;
  }
}

// R6 QA: declare the storage key as a local string inside the loader so it
// is not subject to the temporal dead zone when called during state init
// (the previous const declaration sat below state init and silently dropped
// the seeded handle, surfacing as a "Guest" label instead of "Jimmy").
function loadGuestHandle() {
  try {
    return localStorage.getItem('wc26.competition.guestHandle') || null;
  } catch { return null; }
}

const LS_GUEST_HANDLE = 'wc26.competition.guestHandle';

export function setGuestHandle(handle) {
  state.guestHandle = (handle || '').toString().slice(0, 30) || null;
  try {
    if (state.guestHandle) localStorage.setItem(LS_GUEST_HANDLE, state.guestHandle);
    else localStorage.removeItem(LS_GUEST_HANDLE);
  } catch {}
  window.dispatchEvent(new CustomEvent('competition:state-change'));
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
  // R6 QA: don't leak raw Postgres/PostgREST errors when an RPC or table
  // hasn't been deployed yet. Re-skin them as friendly text.
  if (/could not find the function|could not find the table|PGRST205/i.test(message)) {
    if (context === 'joinGroup') return new Error('Pool not found — double-check the code, or ask the host to confirm the link.');
    if (context === 'createGroup') return new Error('Pool creation is offline right now. Try again in a moment.');
    return new Error('That feature is offline right now. Try again in a moment.');
  }
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
