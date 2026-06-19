/* hidden-features.js — reversible nav/feature hiding (owner request, lack of use).
 *
 * To RESTORE a feature later: delete its route from HIDDEN_ROUTES (one line) and
 * redeploy — the nav tab and its in-content entry points reappear. Routes still
 * RESOLVE by direct URL even while hidden (so invite/join deep links don't break);
 * this only removes the surfaced entry points (nav tabs + [data-go] buttons).
 */
export const HIDDEN_ROUTES = new Set([
  'play',
  'bracket', 'brackets',     // aliases
  'pools',
  'my-brackets',
  'my-picks', 'picks',       // aliases
]);

export function isRouteHidden(route) {
  return HIDDEN_ROUTES.has(String(route || ''));
}

/** Hide nav tabs + in-content [data-go] entry points for hidden routes. Safe to
 *  call repeatedly (after every view render). Tabs toggle both ways so removing
 *  a route from HIDDEN_ROUTES restores its tab automatically. */
export function applyHiddenFeatures(scope = document) {
  for (const tab of scope.querySelectorAll('.tab[data-route]')) {
    tab.hidden = isRouteHidden(tab.getAttribute('data-route'));
  }
  // In-content entry points: only force-hide hidden routes (never force-show,
  // so a view's own conditional rendering is respected).
  for (const el of scope.querySelectorAll('[data-go]')) {
    if (isRouteHidden(el.getAttribute('data-go'))) el.hidden = true;
  }
}
