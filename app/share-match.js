/* share-match.js — RJ30.1 Item C-1.
   Build the shareable `/m/<A>__vs__<B>` URL for a single matchup.

   WHY a real path (not the `#/matchup/…` hash): URL fragments never reach the
   server, so a crawler that pastes a hash matchup link only sees the bare SPA
   shell + generic OG tags. The `/m/<pair>` path is served by
   netlify/functions/match-card.mjs, which emits per-match OG/Twitter meta and
   then bounces humans back into `#/matchup/team_a/<A>/team_b/<B>`. This mirrors
   buildShareUrl() in app/share-bracket.js, whose `/s/<token>` path exists for
   the same reason. Kept in its own file so the matchup-share rationale lives
   next to its single responsibility.

   Pairing convention matches the SPA + the server function + the on-disk
   match_id: `${teamA}__vs__${teamB}`. The whole pair is URI-encoded as one
   component so spaces/apostrophes round-trip; the server splits on the LAST
   `__vs__` and decodes each side. */

const SEP = '__vs__';

// Resolve the site origin. In a browser this is location.origin; the optional
// override keeps the helper pure/testable off-DOM.
function siteOrigin(origin) {
  if (origin) return String(origin).replace(/\/+$/, '');
  if (typeof location !== 'undefined' && location.origin) return location.origin;
  return '';
}

export function buildMatchShareUrl(teamA, teamB, origin) {
  const a = String(teamA ?? '').trim();
  const b = String(teamB ?? '').trim();
  const pair = `${a}${SEP}${b}`;
  return `${siteOrigin(origin)}/m/${encodeURIComponent(pair)}`;
}

// Reuse the bracket sharer's navigator.share → clipboard fallback so the
// matchup Share button behaves identically to the bracket Share button.
export { tryShareViaNavigator } from './share-bracket.js';
