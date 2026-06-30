/* i18n.js — RJ30.1-B: dependency-free i18n FOUNDATION (no build step).
 *
 * A tiny `t()` with English-default per-key fallback, synchronous language
 * detection, a persisted Settings toggle, and Intl number/date/time helpers.
 *
 * Design (locked by docs/rj30.1/B-i18n.md):
 *  - The English catalog (EN) is INLINE here so the default path needs zero
 *    extra fetch and zero flash. Spanish lives in a SEPARATELY lazy-loaded
 *    module (./strings.es.js) imported only when lang === 'es'.
 *  - `t()` returns PLAIN TEXT, never HTML. Callers keep wrapping with the
 *    canonical escape helper exactly as today (no auto-escape → no
 *    double-escape, no XSS regression). Catalog values contain NO HTML — only
 *    {placeholders}.
 *  - Missing-key fallback chain: ES[key] ?? EN[key] ?? humanize(key).
 *  - Flat dot-namespaced keys (O(1) lookup, trivial merge).
 *  - All localStorage access is try/catch-guarded (private mode / quota safe).
 *  - es formatting is fixed to es-MX (Mexico is a host nation; stable QA).
 */

export const SUPPORTED = ['en', 'es'];
export const LS_LANG = 'wc26.lang';

/* ------------------------------------------------------------------ EN catalog
 * Canonical source of truth + the key set the seven key surfaces use. Values
 * are byte-identical to the current literals so existing English assertions
 * keep passing. Spanish (strings.es.js) mirrors this key set.
 */
export const EN = {
  // nav / tabs (index.html literals, exact)
  'nav.home': 'Home',
  'nav.schedule': 'Schedule',
  'nav.projected': 'Projected',
  'nav.play': 'Play',
  'nav.bracket': 'Bracket',
  'nav.pools': 'Pools',
  'nav.myBrackets': 'My Brackets',
  'nav.myPicks': 'My Picks',
  'nav.venues': 'Venues',
  'nav.matches': 'Matches',

  // document.title labels (main.js TITLES map)
  'title.home': 'WC26',
  'title.play': 'Play',
  'title.bracket': 'Bracket',
  'title.pools': 'Pools',
  'title.my-brackets': 'My Brackets',
  'title.my-picks': 'My Picks',
  'title.schedule': 'Schedule',
  'title.projected': 'Projected Bracket',
  'title.venues': 'Venues',
  'title.matches': 'Matches',
  'title.matchup': 'Matchup',
  'title.group': 'Group',
  'title.settings': 'Settings',
  'title.standings-group': 'Standings',
  'title.suffix': 'WC26 Tracker',

  // shell aria-labels (index.html)
  'aria.back': 'Back',
  'aria.settings': 'Settings',
  'aria.account': 'Account',
  'aria.app': 'World Cup 2026 App',
  'aria.dataUpdated': 'Data last updated',

  // home view
  'home.hostsFallback': 'USA · Canada · Mexico',
  'home.datesFallback': '11 June – 19 July 2026',
  'home.dataUpdated': 'Data updated',
  'home.kicksOffIn': 'Kicks off in',
  'home.tournamentStarted': 'Tournament started',
  'home.dontMiss': "Don't miss",
  'home.today': "Today's matches",
  'home.upNext': 'Up next',
  'home.fullSchedule': 'Full schedule',
  'home.allMatches': 'All 104 matches',
  'home.recentResults': 'Recent results',
  'home.noneYet': 'No matches played yet',
  'home.jumpTo': 'Jump to',
  'home.yourTeam': 'Your team',
  'home.pickFavorite': 'Pick your favorite team',
  'home.makePrediction': 'Make your prediction',
  'home.loading': 'Loading…',

  // countdown unit labels
  'unit.days': 'days',
  'unit.hrs': 'hrs',
  'unit.min': 'min',
  'unit.sec': 'sec',

  // stage / round labels (prettyStage)
  'stage.r32': 'Round of 32',
  'stage.r16': 'Round of 16',
  'stage.qf': 'Quarterfinals',
  'stage.sf': 'Semifinals',
  'stage.final': 'Final',
  'stage.third': 'Third-place playoff',

  // schedule view
  'schedule.empty': 'Full tournament schedule is not yet published.',
  'schedule.myMatches': 'My matches',
  'schedule.showing': 'Showing',

  // standings view
  'standings.advanced': 'Advanced',
  'standings.bestThird': 'Best third?',
  'standings.bestThirdShort': 'Best third',
  'standings.eliminated': 'Eliminated',
  'standings.heading': 'Standings',
  'standings.group': 'Group',
  'standings.bestThirds': 'Best third-placed teams',
  'standings.team': 'Team',

  // group view
  'group.label': 'Group',
  'group.team': 'Team',
  'group.notFound': 'Group not found.',

  // matchup-detail section headings (direct-render only)
  'matchup.yourPick': 'Your pick',
  'matchup.whenWhere': 'When & where',
  'matchup.lineups': 'Lineups',
  'matchup.referee': 'Referee',
  'matchup.h2h': 'Head-to-head',
  'matchup.form': 'Form',
  'matchup.scorers': 'Scorers',
  'matchup.weather': 'Weather',
  'matchup.finalResult': 'Final result',

  // settings card titles + language card
  'settings.language': 'Language',
  'settings.english': 'English',
  'settings.spanish': 'Español',
  'settings.favorite': 'Favorite team',
  'settings.theme': 'Theme',
  'settings.motion': 'Motion',
  'settings.account': 'Account',
  'settings.model': 'Model & Analytics',
  'settings.pipeline': 'Pipeline status',
  'settings.reset': 'Reset',
};

/* ------------------------------------------------------------------ internals */

// Mutable in-memory state. EN is always present; ES is filled by initI18n's
// lazy import (or by a test calling _setCatalogES).
let _lang = 'en';
let ES = null;
const _warned = new Set();

/** locale tag for Intl (fixed es-MX per Q4). */
export function localeFor(lang) {
  return (lang || _lang) === 'es' ? 'es-MX' : 'en-US';
}

/** safe localStorage read (private mode / quota → null, never throws). */
function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

/** humanize a dot-key's last segment into a readable dev fallback:
 *  'nav.schedule' → 'Schedule', 'home.recentResults' → 'Recent Results'.
 *  Splits camelCase + separators, then Title-cases each word. */
export function humanize(key) {
  const seg = String(key ?? '').split('.').pop() || '';
  if (!seg) return '';
  const spaced = seg
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  // Title-case each word so multi-word fallbacks read cleanly
  // ('schedule_published' → 'Schedule Published', 'nav.schedule' → 'Schedule').
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** replace {var} tokens; unknown placeholders are left intact. */
function interpolate(str, vars) {
  if (!vars || typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (m, name) =>
    (Object.prototype.hasOwnProperty.call(vars, name) && vars[name] != null)
      ? String(vars[name]) : m);
}

/* ------------------------------------------------------------------- public */

/** Detect language synchronously: stored wc26.lang wins, else first es* in
 *  navigator.languages, else 'en'. Never throws. */
export function detectLang() {
  try {
    const stored = lsGet(LS_LANG);
    if (stored && SUPPORTED.includes(stored)) return stored;
  } catch { /* ignore */ }
  try {
    const langs = (typeof navigator !== 'undefined' && navigator.languages)
      ? navigator.languages
      : (typeof navigator !== 'undefined' && navigator.language ? [navigator.language] : []);
    // Prefix-match the first tag (covers 'es', 'es-MX', 'es-419', 'es_US'),
    // case-insensitive, first hit wins.
    for (const tag of langs) {
      if (typeof tag === 'string' && tag.toLowerCase().replace('_', '-').split('-')[0] === 'es') {
        return 'es';
      }
    }
  } catch { /* ignore */ }
  return 'en';
}

export function getLang() { return _lang; }

/** apply <html lang> when a DOM is present. */
function setHtmlLang(lang) {
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('lang', lang);
    }
  } catch { /* non-DOM env */ }
}

/** Switch language: validate, persist, set <html lang>, fire events. Returns
 *  the resolved lang. Persistence may no-op (private mode) but in-memory +
 *  <html lang> + events still fire so the view re-renders. */
export function setLang(lang) {
  const next = SUPPORTED.includes(lang) ? lang : 'en';
  _lang = next;
  lsSet(LS_LANG, next);
  setHtmlLang(next);
  try {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('lang:change', { detail: { lang: next } }));
      window.dispatchEvent(new CustomEvent('state:change'));
    }
  } catch { /* ignore */ }
  return next;
}

/** Boot: detect synchronously, set <html lang>, and (only for es) lazy-load the
 *  Spanish catalog before resolving so the first paint is already localized.
 *  Returns a Promise (await this in main.js BEFORE the first renderView). */
export async function initI18n() {
  _lang = detectLang();
  setHtmlLang(_lang);
  if (_lang === 'es' && !ES) {
    try {
      const mod = await import('./strings.es.js');
      ES = mod.ES || null;
    } catch (err) {
      // Catalog failed to load → degrade to English (fallback chain handles it).
      ES = null;
    }
  }
  return _lang;
}

/** Test/integration seam: inject the ES catalog without a dynamic import. */
export function _setCatalogES(catalog) { ES = catalog || null; }
/** Test seam: force the in-memory lang without events/persistence. */
export function _setLangForTest(lang) { _lang = SUPPORTED.includes(lang) ? lang : 'en'; }

/** Translate. lang arg is an optional override (mostly for tests); defaults to
 *  the in-memory language. Returns PLAIN TEXT (caller escapes). */
export function t(key, vars, lang) {
  const L = lang || _lang;
  let val;
  if (L === 'es' && ES && ES[key] != null) val = ES[key];
  else if (EN[key] != null) val = EN[key];
  else {
    val = humanize(key);
    if (!_warned.has(key)) {
      _warned.add(key);
      try { console.warn(`[i18n] missing key: ${key}`); } catch { /* ignore */ }
    }
  }
  return interpolate(val, vars);
}

/** Intl number format; NaN/invalid → ''. */
export function fmtNumber(n, opts, lang) {
  const num = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(num)) return '';
  try {
    return new Intl.NumberFormat(localeFor(lang), opts || {}).format(num);
  } catch {
    return String(num);
  }
}

/** Intl date format; invalid ISO → ''. */
export function fmtDate(iso, opts, lang) {
  const d = (iso instanceof Date) ? iso : new Date(iso);
  if (!d || Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(localeFor(lang), opts || { dateStyle: 'long' }).format(d);
  } catch {
    return '';
  }
}

/** Time-only convenience wrapping fmtDate. */
export function fmtTime(iso, opts, lang) {
  return fmtDate(iso, opts || { hour: 'numeric', minute: '2-digit' }, lang);
}
