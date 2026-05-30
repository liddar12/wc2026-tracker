/* favorites.js — favorite team picker state.
   Stored in localStorage; primary key used by views to default to the
   favorite team's FIFA group instead of group D.
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
  // Notify any view that wants to re-render on change.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('favorite:change', { detail: { team } }));
  }
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
