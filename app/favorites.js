/* favorites.js — favorite team picker state.
   Stored in localStorage for offline + guest use; ALSO synced to
   profiles.favorite_team on Supabase when the user is signed in, so
   the favorite follows them across devices.
*/
const LS_FAVORITE = 'wc26.favoriteTeam';

export function getFavoriteTeam() {
  try {
    return localStorage.getItem(LS_FAVORITE) || null;
  } catch {
    return null;
  }
}

export function setFavoriteTeam(team) {
  try {
    if (team) localStorage.setItem(LS_FAVORITE, String(team));
    else localStorage.removeItem(LS_FAVORITE);
  } catch {}
  // Best-effort server sync (fire-and-forget). Doesn't block the UI; if the
  // user isn't signed in or the network fails, localStorage stays authoritative.
  void syncFavoriteToServer(team);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('favorite:change', { detail: { team } }));
  }
}

async function syncFavoriteToServer(team) {
  try {
    const mod = await import('./competition.js');
    const state = mod.getCompetitionState?.();
    if (!state?.client || !state?.user) return;
    const value = team || null;
    const { error } = await state.client
      .from('profiles')
      .update({ favorite_team: value })
      .eq('user_id', state.user.id);
    if (error) console.warn('favorite sync failed:', error.message || error);
  } catch (e) {
    // Network or import errors are non-fatal.
  }
}

// Pull the server-stored favorite on login. Called from competition.js after
// loadProfileAndGroups so the favorite follows the user across devices. The
// server value wins if it disagrees with localStorage (server is source of
// truth for signed-in users).
export async function pullServerFavoriteIfAuthed() {
  try {
    const mod = await import('./competition.js');
    const state = mod.getCompetitionState?.();
    if (!state?.client || !state?.user) return;
    const { data, error } = await state.client
      .from('profiles')
      .select('favorite_team')
      .eq('user_id', state.user.id)
      .maybeSingle();
    if (error) return;
    const serverFav = data?.favorite_team || null;
    const localFav = getFavoriteTeam();
    if (serverFav && serverFav !== localFav) {
      try { localStorage.setItem(LS_FAVORITE, serverFav); } catch {}
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('favorite:change', { detail: { team: serverFav } }));
      }
    } else if (!serverFav && localFav) {
      // Local set, server empty — push local up.
      void syncFavoriteToServer(localFav);
    }
  } catch {}
}

// Returns the FIFA group letter (A-L) for the favorite team, or null if no
// favorite is set, or null if data isn't loaded.
export function favoriteTeamGroup(data) {
  const fav = getFavoriteTeam();
  if (!fav || !data?.groupMatchups) return null;
  for (const [letter, info] of Object.entries(data.groupMatchups)) {
    if (Array.isArray(info.teams) && info.teams.includes(fav)) return letter;
  }
  return null;
}

// Returns the default group letter for views that need one:
// favorite team's group if set, otherwise 'D' (existing behavior).
export function defaultGroup(data) {
  return favoriteTeamGroup(data) || 'D';
}

// All teams from teams.json, sorted alphabetically.
export function allTeamNames(data) {
  if (!data?.teams) return [];
  return Object.keys(data.teams).sort((a, b) => a.localeCompare(b));
}
