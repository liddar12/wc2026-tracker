# Parity Audit — Live Site → Design

**Live target:** `worldcup2026.j5lagenticstrategy.com` · build tag **`v5-kalshi`** (the `kalshi` tag
strongly implies prediction-market / contracts integration — confirm in source).
**Source of truth for code:** GitHub repo **`liddar12`**.

> ⚠️ **Status: partial.** The live app is client-rendered, so its individual screens, states, modals,
> and lightboxes can't be read from the page source alone. The map below is built from the live
> **navigation inventory** + the design. Rows marked **🔍 verify in source** must be confirmed
> against `liddar12` and the running app to reach a true 1:1. Connect GitHub and I'll complete this.

## Live navigation inventory (observed)
Primary nav: **Home · Schedule · Play · Bracket · Pools · My Brackets · My Picks · Venues · Matches**
Global: **Sign in** (`👤`) · **Settings** (`⚙`) · footer build `v5-kalshi · WC26`.

## Coverage map

| Live destination | In design? | Maps to | Action |
|---|---|---|---|
| **Home** | ✅ Covered | `Home` | Restyle to "The Goal" shell + tokens. |
| **Matches** | ✅ Covered | `Matches` | Covered (fixtures + filters + rows). |
| **Bracket** | ✅ Covered | `Bracket` | Covered (knockout columns + ties). |
| **My Picks** | ✅ Covered | `My Picks` | Covered (stats + pick list). |
| **Pools** | 🟡 Partial | `Leaderboard` | Leaderboard ≈ a pool's ranking. **Need:** pools *list*, create/join pool, invite, pool settings. |
| **Settings** (`⚙`) | 🟡 Partial | `Profile` | Profile holds settings rows. **Need:** full settings screens (notifications, account, theme). |
| **Schedule** | ❌ Missing | — | Calendar/day view of fixtures (distinct from the Matches list). **Recommend** a date-grouped schedule. |
| **Play** | ❌ Missing | — | Likely the core prediction/markets game (the `kalshi` angle). **Highest-priority design gap.** 🔍 verify in source. |
| **My Brackets** | ❌ Missing | — | Manage *multiple* saved/shared brackets (the design assumes one). **Recommend** a brackets list + per-bracket view/edit/share/duplicate/delete. |
| **Venues** | ❌ Missing | — | Stadiums/host-city directory + venue detail (map, matches at venue). **Recommend** a venues grid + detail lightbox. |
| **Sign in / Auth** | ❌ Missing | — | Sign-in/up, session, gated routes. **Recommend** auth screens + signed-out states. |

## Recommended additions (the "path to recommend what isn't captured")
Prioritized so a developer can sequence the work:

1. **Auth & gated states** (foundational) — sign-in/up, session, signed-out top bar, per-route gates
   for Play / Pools / My Brackets / My Picks. Without this the personalized screens have no real state.
2. **Play** — design the prediction game / markets flow to match `v5-kalshi`. This is the product's
   core loop and the biggest unknown; confirm exact mechanics (per-match markets? contracts? points?)
   from `liddar12` before designing. Add to the tab bar and the Goal menu.
3. **Pools** (expand Leaderboard) — pools list, create/join (code or link), invite, per-pool
   leaderboard, pool settings, leave pool. Keep the current leaderboard as the pool-detail view.
4. **My Brackets** — list of brackets, create from template, edit, share (image + link), duplicate,
   delete, lock at deadline. Fold the single Bracket screen in as the editor.
5. **Schedule** — date-grouped fixture calendar with day switcher; complements the flat Matches list.
6. **Venues** — host cities/stadiums directory + venue detail (matches here, map, capacity) as a
   pushed screen or lightbox.
7. **Settings** — promote from Profile rows to real screens: notifications/push, account, appearance,
   data & privacy, sign out.
8. **Nav capacity** — with these added, the 5-slot tab bar overflows. **This is exactly why "The Goal"
   menu exists:** keep 4 core tabs + the Goal FAB, and let the full-screen menu host the complete set
   (Home, Schedule, Matches, Play, Bracket, Pools, My Brackets, My Picks, Venues, Profile/Settings).
   Desktop inline nav shows the top ~6 and the goal icon opens the rest.

## 1:1 verification checklist (complete with `liddar12` source access)
For each live route, confirm and document against the design:
- [ ] Exact route path, params, and deep-link behavior
- [ ] Real data shape + endpoints (for `screens.js` replacement)
- [ ] **Loading** state (replace "Loading data…" with skeletons)
- [ ] **Empty** state copy + primary action
- [ ] **Error / failover** (retry, partial data, stale-while-revalidate)
- [ ] **Offline** behavior (what's cached, what's queued)
- [ ] **Auth gate** (signed-out treatment)
- [ ] Every **modal / lightbox / sheet**: match detail, pick entry, bracket-tie editor, share,
      auth, settings, venue detail, pool create/join, install — with open/close, focus trap,
      scrim/Esc dismiss, and their own loading/error states
- [ ] Form **validation** rules (pick lock times, input constraints)
- [ ] **Live update** mechanism (poll/stream, cadence, reconnect)
- [ ] **Responsive** breakpoints + any tablet/desktop-specific layouts
- [ ] **Animations/transitions** to preserve or replace
- [ ] Exact **copy** and microcopy
- [ ] Any **analytics / feature flags** (e.g. the `kalshi` variant) that change UI

> Once GitHub is connected, I'll walk `liddar12` route-by-route, fill in every box above, enumerate
> the real modal/lightbox set, and update the coverage map to a confirmed 1:1 — then regenerate this
> file as the authoritative spec.
```
```
