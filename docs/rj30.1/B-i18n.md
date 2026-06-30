# RJ30.1 — Item B: Spanish (es) Internationalization Foundation

**Owner:** Jimmy Liddar (liddar12) · **Status:** PLAN (not built) · **Scope:** scoped enhancement on a mature repo → regression gate + Gate-4 deploy (no Gates 1–3 re-derivation).
**Constraint:** $0 cost. Pure client-side code, no new dependencies, no build step, no network, no Supabase writes. RTL not required (es is LTR).

---

## 0. Why this is shaped as a FOUNDATION + key-surfaces-first pass

A 2026 World Cup hosted across the USA, Canada, and **Mexico** has a large Spanish-first audience. But this app is ~140 vanilla-JS ES modules that build HTML strings inline with `escapeHtml()` (no template framework, no existing i18n hook). Extracting **every** string in one pass would touch ~80 files, collide with every other RJ30.1 partition, and be impossible to QA at 90%+ in one increment.

So the plan is two-layered:

1. **Foundation** (`app/lib/i18n.js` + `app/lib/strings.es.js`): a tiny, dependency-free `t()` with English-default fallback, language detection, a Settings toggle persisted in `localStorage`, and `Intl`-based number/date/time helpers. No build step — strings live in a static ES module, lazy-loaded only when the language is `es`.
2. **Key-surfaces-first application**: wire `t()` into the seven highest-traffic surfaces only (home, schedule, matchup-detail, standings, group, settings, nav/tab labels). Everything else falls back to English automatically via the missing-key contract, so the app is never broken — it's progressively translated.

This is the recommended scope (see Open Questions Q1/Q2). Each subsequent view can be migrated incrementally in later increments without re-touching the foundation.

### Files read to ground this plan
- `app/main.js` — `TITLES` map (L87–115), `document.title` set (L185), tab `bindNav()` (L269–300), `initSettingsPrefs()` boot (L339), route loop.
- `index.html` — `<html lang="en">` (L2), hardcoded tab labels (L76–85), header `aria-label`s, footer.
- `app/state.js` — `loadPrefs()`/`persistPrefs()` + `setPref()` pattern (the persistence model `i18n` will mirror), `emit()` → `state:change`.
- `app/lib/escape.js` — canonical `escapeHtml` (interpolation safety; `t()` output must stay escape-compatible).
- `app/views/home-view.js` — heavy inline-HTML strings (hero, countdown labels, card titles, CTAs, `prettyStage`, MOTD, recent/quick-links).
- `app/views/schedule-view.js` — `toLocaleDateString`/`toLocaleTimeString` calls using `undefined` locale (L99–100, 118–120, 192–193), empty-state copy, "My matches".
- `app/views/settings-view.js` — card titles + the radio/toggle pattern the Language card will copy verbatim (`renderThemeCard`).
- `app/views/standings-view.js` — `ADVANCE_LABEL` map, "Group" switcher, advance copy.
- `app/views/group-view.js` — group switcher, standings table headers.
- `app/views/matchup-detail.js` — section order comment + `sectionHeading()` labels.
- `tests/playwright.config.mjs` — 390×844, baseURL `http://localhost:8088`, `testIgnore qa-*`.
- `tests/feature/match-status.test.mjs` — `node:test` + `assert/strict` + read-JSON-from-root convention.
- `tests/ux/status-view.spec.mjs` — Playwright route/skip/selector conventions.

---

## ITEM B — User stories & acceptance criteria

### Epic: Spanish internationalization (foundation + key surfaces)

#### Story B1 — As a Spanish-speaking visitor, the app auto-detects my language on first load
- **AC-B1.1**
  - **Given** a first-time visitor with no stored language preference and a browser whose `navigator.languages` leads with an `es*` tag (e.g. `es-MX`, `es-419`, `es`)
  - **When** the app boots
  - **Then** `t()` resolves to the Spanish catalog and the seven key surfaces render in Spanish, **with no flash of English** (detection runs synchronously at boot, before first paint of any view).
- **AC-B1.2**
  - **Given** a first-time visitor whose `navigator.languages` leads with any non-`es` tag (or detection throws)
  - **When** the app boots
  - **Then** the app renders in English (default), and no error is logged.
- **AC-B1.3**
  - **Given** `localStorage` is unavailable (private mode / quota)
  - **When** detection runs
  - **Then** it falls back to `navigator.languages` only, never throws, and the app renders (English unless `es` is detected).

#### Story B2 — As any user, I can switch language in Settings and it persists
- **AC-B2.1**
  - **Given** I'm on `#/settings`
  - **When** I open the new **Language / Idioma** card
  - **Then** I see two radio options — **English** and **Español** — with the active one checked (matching detected/stored state).
- **AC-B2.2**
  - **Given** I select **Español**
  - **When** the change fires
  - **Then** the preference is written to `localStorage` key `wc26.lang`, a `lang:change` (and `state:change`) event fires, the current view re-renders in Spanish without a full page reload, and `<html lang>` updates to `es`.
- **AC-B2.3**
  - **Given** I selected Español and reload the app
  - **When** it boots
  - **Then** the stored `wc26.lang=es` wins over `navigator.languages` and the app is Spanish immediately, no flash.
- **AC-B2.4** — Switching back to **English** restores English everywhere and sets `<html lang="en">`.

#### Story B3 — As a developer, `t()` never renders a broken/blank string
- **AC-B3.1** (missing-key fallback)
  - **Given** a key that exists in English but **not** in the Spanish catalog
  - **When** `t(key)` is called with `lang=es`
  - **Then** it returns the English string for that key (graceful per-key fallback), never `undefined`, never the raw key.
- **AC-B3.2** (unknown key)
  - **Given** a key absent from **both** catalogs
  - **When** `t(key)` is called
  - **Then** it returns the key's last segment humanized as a dev fallback (e.g. `nav.schedule` → `Schedule`) and `console.warn`s once per key in dev — never throws.
- **AC-B3.3** (interpolation)
  - **Given** `t('home.signedInSummary', { name, count })` with a template containing `{name}` / `{count}`
  - **When** rendered
  - **Then** placeholders are substituted; **interpolated values are still passed through `escapeHtml` by the caller** (t() does NOT auto-escape — it returns plain text, callers wrap as today), so no double-escaping and no XSS regression.

#### Story B4 — As a Spanish user, numbers, dates, and times are localized
- **AC-B4.1**
  - **Given** `lang=es`
  - **When** a kickoff date renders in Schedule
  - **Then** it uses `Intl.DateTimeFormat('es-MX', …)` (e.g. "jueves, 11 de junio de 2026") instead of the English long date, while still bucketing matches by the canonical ET match-day (no change to the existing UTC/ET bucketing logic — only the *display* locale changes).
- **AC-B4.2**
  - **Given** `lang=es`
  - **When** a percentage / probability renders (e.g. winner odds `42.1%`)
  - **Then** the decimal separator follows `Intl.NumberFormat('es-MX')` where the value passes through the new number helper. (Scope: only values already routed through the helper in the key surfaces; raw `.toFixed()` literals elsewhere stay as-is and are a follow-up.)
- **AC-B4.3** — Countdown unit labels (`days/hrs/min/sec`) render as `días/h/min/s` in Spanish.

#### Story B5 — No UX/iOS regression on the installed PWA
- **AC-B5.1** — At 390×844, every translated surface fits with **no horizontal overflow** (`document.documentElement.scrollWidth ≤ 390`). Spanish strings are ~15–25% longer than English; tab labels and buttons must not clip or force a second scroll.
- **AC-B5.2** — The tab-bar overflow hint logic (`initTabBarScrollHints`) still works with longer Spanish labels (it's length-agnostic — assert it still computes overflow classes).
- **AC-B5.3** — `<html lang>` is correct for the active language (a11y + iOS VoiceOver pronunciation).
- **AC-B5.4** — All existing `data-testid`s and routes are unchanged; the full regression gate stays green with `lang` defaulting to English in the test environment (tests opt into `es` explicitly).

---

## Architecture & contracts

### `app/lib/i18n.js` (NEW — the foundation, ~120 lines)
Public API (named exports), all synchronous after boot:

```
SUPPORTED = ['en', 'es']
LS_LANG = 'wc26.lang'

detectLang()            // stored wc26.lang → else first navigator.languages es* → 'en'; never throws
getLang()               // current in-memory lang ('en' | 'es')
setLang(lang)           // validate ∈ SUPPORTED; persist wc26.lang; set <html lang>; dispatch 'lang:change' + 'state:change'
initI18n()              // boot: lang = detectLang(); set <html lang>; if 'es' lazy-load strings.es.js; returns Promise
t(key, vars)            // lookup es→en→humanize(key); interpolate {var}; returns PLAIN TEXT (caller escapes)
fmtNumber(n, opts)      // Intl.NumberFormat(localeFor(lang), opts).format(n); NaN-safe → ''
fmtDate(iso, opts)      // Intl.DateTimeFormat(localeFor(lang), opts).format(new Date(iso)); invalid → ''
fmtTime(iso, opts)      // time-only convenience wrapping fmtDate
localeFor(lang)         // 'es' → 'es-MX', 'en' → 'en-US'
```

**Key design decisions (locking them so build agents don't drift):**
- **English catalog is INLINE in `i18n.js`** (the `EN` object) so the default path needs zero extra fetch and zero flash. Spanish is a **separately lazy-loaded module** (`strings.es.js`) imported only when `lang==='es'`. Boot is synchronous for English; `initI18n()` awaits the Spanish import only in the es branch.
- **No-flash guarantee:** `initI18n()` is `await`ed in `main.js` **before** the first `renderView()`/`loadData().then(...)` triggers a view render. Detection itself is synchronous; only the Spanish *catalog* is async, and we gate first paint on it. Skeleton (`viewSkeleton()`) is locale-neutral (it has no user copy), so it can paint during the await without flashing English text.
- **`t()` returns plain text, not HTML.** Callers keep wrapping with `escapeHtml(...)` exactly as today. This preserves the existing XSS-safety contract (`app/lib/escape.js`) and avoids double-escaping. Strings catalog values contain **no HTML** — only `{placeholders}`.
- **Missing-key fallback chain:** `ES[key] ?? EN[key] ?? humanize(key)`. Flat dot-namespaced keys (`nav.schedule`, `home.recentResults`, `settings.language`) — flat object, not nested, so lookup is `O(1)` and merge is trivial.
- **Persistence mirrors `state.js`:** same `try/catch` localStorage idiom as `loadPrefs`/`persistPrefs`. We use a **dedicated key `wc26.lang`** (not folded into `wc26.prefs`) so language survives a prefs-shape migration and is readable by a tiny inline boot snippet if we later want to set `<html lang>` pre-module (see iOS notes).

### `app/lib/strings.es.js` (NEW — Spanish catalog, lazy)
```
export const ES = {
  'nav.home': 'Inicio',
  'nav.schedule': 'Calendario',
  'nav.projected': 'Pronóstico',
  'nav.play': 'Jugar',
  'nav.bracket': 'Llaves',
  'nav.pools': 'Grupos',
  'nav.myBrackets': 'Mis llaves',
  'nav.myPicks': 'Mis picks',
  'nav.venues': 'Sedes',
  'nav.matches': 'Partidos',
  'settings.language': 'Idioma',
  'settings.english': 'English',
  'settings.spanish': 'Español',
  // … all keys touched by the seven key surfaces
};
```
The English catalog (`EN`) inside `i18n.js` holds the **same key set** (canonical source of truth). A test asserts ES ⊆ EN (no orphan ES keys) and reports EN keys missing from ES (allowed, but tracked).

### `app/views/strings/en.js` vs inline — DECISION
English stays **inline in `i18n.js`** (single source, no second fetch on the default path). Do not split English into its own lazy module — that would reintroduce a flash risk for the majority (English) audience.

---

## Tasks (exact files / functions)

### T1 — Foundation lib (`app/lib/i18n.js`) — NEW
- Implement the API above. `EN` object seeded with every key the seven surfaces need (enumerate during T3–T8).
- `humanize(key)`: take last dot segment, split camelCase, capitalize first letter.
- `interpolate(str, vars)`: replace `/\{(\w+)\}/g`; leave unknown placeholders intact.
- All localStorage access wrapped in `try/catch` returning safe defaults.

### T2 — Spanish catalog (`app/lib/strings.es.js`) — NEW
- Export `ES` with translations for every key in `EN`. Keep `ensure_ascii`-style discipline irrelevant here (JS source, UTF-8 is fine — but verify the file is saved UTF-8 and accents render).

### T3 — Boot wiring (`app/main.js`)
- Import `{ initI18n, getLang } from './lib/i18n.js'`.
- Call `await initI18n()` **before** the `loadData()` chain renders a view. Concretely: wrap the existing boot tail so `initI18n()` resolves first; the pre-data skeleton may paint during the await (it's locale-neutral).
- Replace `TITLES` literals with `t('title.home')` etc. at the point `document.title` is built (L185) — compute titles through `t()` so the iOS task-switcher label localizes. Keep the `TITLES` object but map values to keys, or call `t('title.'+view)`.
- After `bindNav()`, add a `lang:change` listener that re-localizes the static tab labels + header `aria-label`s in `index.html` (they're not re-rendered by `renderView`, so patch their `textContent` directly) and calls `renderView()`.
- Add a one-time function `localizeShell()` that sets the 10 tab labels + header `aria-label`s + footer from `t('nav.*')`; call it on boot (after `initI18n`) and on `lang:change`.

### T4 — Settings Language card (`app/views/settings-view.js`)
- New `renderLanguageCard()` cloned structurally from `renderThemeCard()` (radio group, `is-active`, `change` handler). Insert it **first or right after Favorite** in `renderSettingsView`. Recommend: directly under the Favorite card (language is a top-level chrome preference).
- On change: `setLang(value)` from `i18n.js`. Add `data-testid="settings-language"` on the card and `value="en"|"es"` radios named `settings-lang`.
- Localize the existing Settings card titles via `t()` (Favorite team, Theme, Motion, Account, Model & Analytics, Pipeline status, Reset).

### T5 — Nav/tab + shell labels (`index.html` + handled in T3)
- `index.html`: keep English text as the literal fallback (so a no-JS / pre-module paint shows English), but `localizeShell()` overwrites to Spanish when `lang==='es'`. Set `<html lang="en">` stays the static default; `setLang`/`initI18n` updates it at runtime.
- Header `aria-label`s ("Settings", "Account", "Back", "Sign in" toolbar label) routed through `t()`.

### T6 — Home view (`app/views/home-view.js`)
- Route user-facing literals through `t()` + `escapeHtml`: hero eyebrow ("FIFA World Cup 2026"), `meta.dates`/`hosts` fallbacks, "Data updated", countdown label ("Kicks off in"/"Tournament started") + unit labels, "Don't miss", "Today's matches"/"Up next", "Full schedule"/"All 104 matches", "Recent results"/"No matches played yet", "Jump to" + each quick-link label, auth-slot titles/copy, "Your team"/"Pick your favorite team", movers labels.
- `prettyStage()` round labels (R32/R16/QF/SF/Final/3rd) → `t('stage.*')`.
- Dates: `r.when` → `fmtDate`; countdown numbers stay numeric but `fmtNumber` not required (digits are locale-neutral; only unit *labels* translate).
- **Do NOT translate team names** (proper nouns, canonical) or data-derived values.

### T7 — Schedule view (`app/views/schedule-view.js`)
- Empty-state + "My matches"/"Showing" + heading.
- Replace `toLocaleDateString(undefined, …)` / `toLocaleTimeString(...)` with `fmtDate(iso, opts)` so the day-pill (`dow`/`md`), heading long-date, and any times follow the active locale. Keep the ET bucketing (`utcDateISO`) untouched — only the *format* call localizes.

### T8 — Standings + Group views
- `standings-view.js`: `ADVANCE_LABEL` map → `t('standings.advanced'|'.bestThird'|'.out')`; "Group" switcher label; "chance to advance"/"what each team needs" headings.
- `group-view.js`: "Group" switcher; table headers (`xPts`/`xGF`/`Adv%` — decide: keep abbreviations or translate; recommend keep abbreviations, translate the column tooltips/long forms only).

### T9 — Matchup detail (`app/views/matchup-detail.js`)
- Section headings via `t()` (the `sectionHeading()`/`tooltip` labels: "Your pick", "When + where + how to watch", "Lineups", "Referee", "Head-to-head", "Form", "Scorers", "Weather", "Final result"). Many of these come from shared components (`when-where-watch.js`, `lineups.js`, etc.) — **scope note:** for this pass, translate only the headings rendered directly by `matchup-detail.js`; component-internal strings fall back to English (acceptable per the foundation contract) and are a follow-up partition. Flag in build notes which strings are component-owned.

### T10 — Tests (see QA section).

---

## Edge cases (explicit)
1. **No flash on load (es)** — gate first view render on `initI18n()`; skeleton is locale-neutral. Verified by AC-B1.1 + a Playwright assertion that the *first* painted home title is Spanish (no intermediate English).
2. **Missing key** → English fallback (AC-B3.1); unknown key → humanized + single `console.warn` (AC-B3.2).
3. **`localStorage` unavailable** → detection still works off `navigator.languages`; `setLang` no-ops persistence but still updates in-memory + `<html lang>` + re-render.
4. **`es-419` / `es-MX` / `es-US` / `es`** all detect as `es` (prefix match on `navigator.languages`, case-insensitive, first hit wins).
5. **Stored pref beats browser** (AC-B2.3).
6. **Interpolation + escaping** — `t()` returns plain text with `{vars}` substituted; caller escapes (AC-B3.3). Strings contain no HTML.
7. **Invalid date/number** → `fmtDate`/`fmtNumber` return `''` (mirrors existing `isNaN` guards), never "Invalid Date".
8. **Team names / proper nouns** never translated.
9. **Longer Spanish strings** can't overflow 390px (AC-B5.1) or clip tab labels.
10. **`document.title`** localizes (iOS standalone task-switcher) without breaking the `· WC26 Tracker` suffix.
11. **Component-owned strings** (shared `app/components/*`) intentionally stay English this pass — documented, not a bug.
12. **Round-trip toggle** (es→en→es) leaves no stale Spanish in the shell (localizeShell re-runs on every `lang:change`).

---

## QA — concrete test scripts

### Gate (run in order; 100% green before deploy):
`python3 scripts/validate_data.py` → `bash tests/smoke.sh` → `node --test tests/feature/*.mjs tests/competition.test.mjs` → `npx playwright test --config tests/playwright.config.mjs tests/ux tests/integrated`

### QA-1 — `tests/feature/i18n.test.mjs` (NEW, node:test + assert/strict)
Imports `app/lib/i18n.js` + `app/lib/strings.es.js` directly (pure logic, no DOM). Stub a minimal `globalThis` if the module reads `navigator`/`localStorage` (guard with `typeof`).
- `t('nav.schedule')` with lang=en → `'Schedule'`; with lang=es → `'Calendario'`.
- **Fallback:** a key in EN but not ES, with lang=es → returns the EN value (`assert.equal`).
- **Unknown key:** `t('totally.unknown.deepKey')` → `'Deep Key'` (humanized), and does not throw.
- **Interpolation:** `t('test.greet', { name: 'Ana', count: 2 })` against a seeded template `'Hola {name}, {count} grupos'` → `'Hola Ana, 2 grupos'`; unknown placeholder left intact.
- **`fmtDate`:** `fmtDate('2026-06-11T19:00:00Z', { month:'long' }, 'es')` includes `'junio'`; `'en'` includes `'June'`. Invalid ISO → `''`.
- **`fmtNumber`:** `fmtNumber(1234.5, {}, 'es')` and `'en'` differ in grouping/decimal where applicable; `NaN` → `''`.
- **`detectLang`:** with stubbed `navigator.languages = ['es-MX','en']` and no stored key → `'es'`; with `['en-US']` → `'en'`; with stored `wc26.lang='en'` overriding `['es']` → `'en'`.
- **Catalog integrity:** every key in `ES` exists in `EN` (no orphans): `assert.ok(EN[k] !== undefined)` for each `k` in `ES`. (Reverse is allowed — EN-only keys fall back.)
- Assertions use `assert.equal` / `assert.match` / `assert.ok`.

### QA-2 — `tests/ux/i18n-settings.spec.mjs` (NEW, Playwright 390×844)
Follows `status-view.spec.mjs` conventions (route-aware, graceful skip if the Language card isn't wired yet so the suite stays green pre-integration).
- **Toggle persists + re-renders:**
  - `page.goto('/#/settings')`; locate `[data-testid="settings-language"]`. `test.skip` if absent (PENDING INTEGRATOR).
  - Click the **Español** radio (`input[name="settings-lang"][value="es"]`).
  - Assert `localStorage.getItem('wc26.lang') === 'es'` (`page.evaluate`).
  - Assert `document.documentElement.lang === 'es'`.
  - Assert a known Settings title localized: `expect(page.getByText('Idioma')).toBeVisible()`.
- **Tab labels localize:** after es, `expect(page.locator('[data-testid="tab-schedule"]')).toHaveText('Calendario')`; `[data-route="home"]` → `'Inicio'`.
- **No overflow at 390 in es:** `goto('/#/')` after es, assert `document.documentElement.scrollWidth <= 390`.
- **Schedule long-date localizes:** `goto('/#/schedule')` in es, assert the heading matches `/\b(enero|febrero|...|junio|julio|...)\b/i` (Spanish month) and NOT an English month.
- **Round-trip:** switch back to **English**, assert `tab-schedule` → `'Schedule'` and `html.lang === 'en'`.

### QA-3 — `tests/ux/i18n-no-flash.spec.mjs` (NEW, Playwright)
- Pre-seed `wc26.lang='es'` via `addInitScript(() => localStorage.setItem('wc26.lang','es'))`.
- `page.goto('/#/')`.
- Capture the home hero title's text **as soon as it's non-empty** (poll `[data-testid]`/`.home-hero-title` once visible) and assert it's the Spanish value — i.e. it was never the English string in between (no-flash). Acceptable approximation: assert the **first** visible localized title is Spanish and that no English nav label ever appeared (`page.on('console')` clean + a `waitForFunction` that the schedule tab text equals `Calendario` within the first frame batch).
- Assert no `pageerror` fired.

### QA-4 — regression guard (extend existing, not new file)
- Confirm the existing `tests/integrated/happy-path.spec.mjs` and `tests/ux/nav-toolbar.spec.mjs` still pass **with default (English) env** — the test browser has no `es` in `navigator.languages` and no stored key, so default English keeps every existing selector/text assertion valid. If any existing spec asserts a literal that now flows through `t()`, the English value is byte-identical (catalog seeded from current literals) → no change required. **Build agent must diff existing literal assertions against the seeded EN catalog and keep them identical.**

---

## iOS / UX notes
- **iOS-first installed PWA:** language toggle lives in Settings (reachable via the header gear), consistent with Theme/Motion. No new tab-bar chrome.
- **No-flash matters more on iOS:** standalone PWA cold-starts show a blank/splash then first paint; gating first render on `initI18n()` (sync detection + only-es async catalog) keeps Spanish users from seeing an English frame. The locale-neutral skeleton covers the await.
- **VoiceOver:** `<html lang>` must track the active language so iOS pronounces Spanish copy correctly (AC-B5.3). Set it in `setLang` and `initI18n`.
- **Longer strings:** Spanish runs ~15–25% longer. The tab-bar is already horizontally scrollable with overflow hints (`initTabBarScrollHints`) — longer labels are fine, but buttons must not wrap; verify `white-space:nowrap` holds (it does via `.tab`). Card CTAs ("All 104 matches →" → "Los 104 partidos →") must not clip — QA-2 overflow assertion covers this.
- **Reuse existing tokens/components:** the Language card uses `.home-card` + `.settings-radio` classes verbatim (zero new CSS ideally; if a width tweak is needed it goes in `app/styles.css` under an existing settings block, no new file).
- **Number/date `Intl`** is native in iOS Safari ≥ supported targets — no polyfill, $0.

---

## Files touched / new (partitioning)

**NEW:**
- `app/lib/i18n.js` — foundation (`t`, detect, set, fmt*). **Owner: i18n-foundation agent.**
- `app/lib/strings.es.js` — Spanish catalog. **Owner: i18n-foundation agent (or a translator pass).**
- `tests/feature/i18n.test.mjs`
- `tests/ux/i18n-settings.spec.mjs`
- `tests/ux/i18n-no-flash.spec.mjs`

**TOUCHED (disjoint where possible for parallel build):**
- `app/main.js` — boot await + title + `localizeShell` + `lang:change` listener. **(shell partition — coordinate, shared file)**
- `index.html` — runtime `<html lang>` is JS-set; English literals kept as fallback. **(shell partition)**
- `app/views/settings-view.js` — Language card + localize titles. **(settings partition)**
- `app/views/home-view.js` — **(home partition)**
- `app/views/schedule-view.js` — **(schedule partition)**
- `app/views/standings-view.js` + `app/views/group-view.js` — **(standings/group partition)**
- `app/views/matchup-detail.js` — direct-render headings only. **(matchup partition)**

**Partitioning recommendation:** `app/lib/i18n.js` + `strings.es.js` must land **first** (everything imports them). Then the six view partitions (home / schedule / standings+group / matchup / settings / shell) are independent and can run concurrently (5–6 agents), each importing the frozen `t()` API. The shell partition (`main.js` + `index.html`) is the only shared-file coordination point — assign it solo.

**Rollback (Gate 4):** the foundation is additive and English-default. One-line revert: `git revert <merge-sha>`. Even partial breakage degrades to English (the `t()` fallback chain), so a forward-fix is low-risk; full revert removes the Language card and restores literal strings.

---

## OPEN QUESTIONS (owner decision — each has a recommendation)

**Q1 — First-pass view scope.** Translate (a) the 7 named key surfaces only [home, schedule, matchup-detail, standings, group, settings, nav/tabs], (b) those 7 + Pools/Play funnel, or (c) all views.
→ **Recommend (a)** — highest-traffic surfaces, lowest collision with other RJ30.1 partitions, fully QA-able at 90%+ this increment; the fallback chain keeps the rest working in English. Expand in a later increment.

**Q2 — String extraction depth.** Extract (a) only the literals in the 7 key surfaces' *view files*, leaving shared `app/components/*` strings English-for-now, or (b) also refactor shared components (`when-where-watch`, `lineups`, `referee`, etc.) into `t()` now.
→ **Recommend (a) key-surfaces-first.** Component refactor multiplies the blast radius and re-touches files other partitions own; do it as a dedicated follow-up partition once the foundation is proven.

**Q3 — Spanish translation source.** (a) I (Claude) author the `strings.es.js` catalog now (free, in-house, World-Cup register), (b) you supply/review translations, or (c) machine-translate then you review.
→ **Recommend (a) then your quick review** — $0, immediate, and football-Spanish is well-covered; you eyeball `strings.es.js` before deploy (a 1-screen file).

**Q4 — Locale for `Intl`.** Use a fixed `es-MX` for all Spanish formatting, or honor the user's exact `navigator.language` (`es-AR`, `es-419`, …)?
→ **Recommend fixed `es-MX`** — Mexico is a host nation, formatting is stable/predictable, and it avoids per-user date-format variance that would complicate QA. (Trivial to revisit.)

**Q5 — Toggle placement.** Language card position in Settings: (a) top (above Favorite), (b) just under Favorite, (c) bottom.
→ **Recommend (b)** — Favorite team is the most personal/primary setting; Language sits right beneath it as the other top-level chrome preference, above Theme/Motion.
