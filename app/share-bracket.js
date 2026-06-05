/* share-bracket.js — A8: shareable bracket link via Supabase RPC.
   Uses a public RPC `create_share_token` that inserts an immutable snapshot
   of the user's bracket and returns a short token. Recipients fetch via
   `get_shared_bracket(token)` — no auth required, no RLS escalation.

   Fallback path when Supabase is not configured: encode the bracket as a
   base64-url JSON blob in the URL hash. Recipients reconstruct on load. */

import { getCompetitionState, isSupabaseConfigured } from './competition.js';

function getClient() {
  const state = getCompetitionState();
  return state?.client || null;
}

const FALLBACK_PREFIX = '#share=';

export async function createShareLink(picks, opts = {}) {
  const meta = {
    label: opts.label || 'My WC26 Bracket',
    created_at: new Date().toISOString(),
    pick_count: Object.keys(picks || {}).length,
  };
  const supabaseClient = getClient();
  if (isSupabaseConfigured() && supabaseClient) {
    try {
      const { data, error } = await supabaseClient.rpc('create_share_token', {
        p_payload: { picks, meta },
      });
      if (error) throw error;
      const token = data?.token || data;
      if (typeof token === 'string' && token.length > 4) {
        return buildShareUrl({ token });
      }
    } catch (err) {
      console.warn('[share] RPC create_share_token failed, falling back', err);
    }
  }
  return buildShareUrl({ inline: encodeInline({ picks, meta }) });
}

export async function loadSharedBracket(tokenOrInline) {
  if (!tokenOrInline) return null;
  if (tokenOrInline.startsWith('inline:')) {
    return decodeInline(tokenOrInline.slice(7));
  }
  const supabaseClient = getClient();
  if (isSupabaseConfigured() && supabaseClient) {
    try {
      const { data, error } = await supabaseClient.rpc('get_shared_bracket', {
        p_token: tokenOrInline,
      });
      if (error) throw error;
      return data?.payload || data;
    } catch (err) {
      console.warn('[share] RPC get_shared_bracket failed', err);
      return null;
    }
  }
  return null;
}

function buildShareUrl({ token, inline }) {
  const base = `${location.origin}${location.pathname}`;
  // R15b (#8): token links use a real path (/s/<token>) so the Netlify
  // share-card function can serve OG/Twitter previews — URL fragments never
  // reach the server. The function bounces humans on to #/shared/token/<token>,
  // which the SPA router already handles. Inline links have no server lookup,
  // so they stay in the hash.
  if (token) return `${location.origin}/s/${encodeURIComponent(token)}`;
  if (inline) return `${base}#/shared/inline/${inline}`;
  return base;
}

function encodeInline(obj) {
  try {
    const json = JSON.stringify(obj);
    // base64url for URL safety
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch {
    return '';
  }
}

function decodeInline(s) {
  try {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function tryShareViaNavigator(url, title = 'My WC26 Bracket') {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url });
      return true;
    } catch {
      // user dismissed or share denied — fall through to clipboard
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return 'clipboard';
    } catch { return false; }
  }
  return false;
}
