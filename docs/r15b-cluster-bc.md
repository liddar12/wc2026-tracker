# R15b — Cluster B + C (drafts for review)

Branch: `r15b-cluster-bc` · **Nothing here is live.** Everything is gated on your
review. The migration is NOT applied to prod; the Netlify functions deploy only
when the branch is merged + published.

Tests: **90 feature + 16 Playwright + 1 competition = all green.** Playwright
booted the app in chromium on the vendored supabase bundle through Play Stage 3.

---

## #21 — Server-side lock enforcement  (migration, NOT applied)
`supabase/migrations/20260604060000_server_side_lock_enforcement.sql`

Today the only thing stopping picks-after-kickoff is the client. This adds a DB
gate as **defense in depth** (the lock UI is unchanged):

- `tournament_config` — single row holding the 3 phase boundaries, seeded with
  the real WC26 times from `data/schedule_full.json`
  (firstGroup `2026-06-11T19:00Z`, lastGroup `2026-06-28T02:00Z`, firstR32 `2026-06-28T19:00Z`).
- `lock_state_now()` — SECURITY DEFINER, mirrors `deriveLockState()` 1:1
  (same 4 phases, same +2h group-end grace).
- BEFORE INSERT/UPDATE triggers on `group_predictions` (blocked when groups
  locked) and `group_brackets` (blocked when bracket locked).
- **Fails OPEN** if config is missing — never bricks writes.

**Review decision needed:** the server-side scorer (when it lands) will need to
write `score` after lock. Options noted in the migration footer (a definer
bypass fn, or a `picks`-unchanged skip). Left strict so you choose.

To apply after approval: `supabase db push`.

---

## #44 — actual_results health monitor  (Netlify function)
`netlify/functions/results-health.mjs` + `_lib/results-health-core.mjs`

Guards against scoring silently freezing if the results feed stops updating
mid-tournament. Two roles in one function:
- **HTTP:** `GET /.netlify/functions/results-health` → JSON (`200` ok / `503`
  degraded). Point any free uptime monitor at it for alerting.
- **Scheduled:** runs `@hourly` (Netlify cron), logs a warning when degraded.

Logic is pure + unit-tested (6 tests): stale-timestamp detection (only while
live) and empty-current-stage detection, phase-aware so pre-tournament empties
are fine. No secrets — reads the public `/data/*.json`.

**Review decision:** alerting today is "log + 503 for an external monitor." If
you want push/email, name the channel and I'll wire it (was deferred as not-100%-
automated without a channel).

---

## #8 — OG / Twitter share cards  (Netlify function + 1 client line)
`netlify/functions/share-card.mjs`, `netlify.toml`, `app/share-bracket.js`

**Root finding:** share links were `…/#/shared/token/<t>`. The token sits in the
URL *fragment*, which **never reaches the server** — so pasted links produced no
preview. Fix moves token links to a real path `/s/<token>`:
- New function renders proper OG/Twitter meta (label, pick count, champion) from
  the snapshot, then bounces humans to `#/shared/token/<t>` (existing SPA route).
  Crawlers read the meta and stop.
- `netlify.toml`: `/s/*` → function (token via query param, before the SPA
  catch-all).
- `share-bracket.js`: token URLs now emit `/s/<token>`; inline links unchanged.

Verified: function returns valid OG HTML + SPA redirect (smoke test).

**Known follow-up (not blocking):** OG image is the 512² app icon. A branded
1200×630 card needs an image renderer (satori/@vercel/og) = a build dep, so I
left it as a static image + dynamic text. Flag if you want the dynamic image.

---

## #40 — esm.sh dependency vendoring
`vendor/` + `scripts/vendor-deps.mjs` + import rewrites + sw.js

esm.sh was a runtime CDN on the **critical path** (the entire Supabase data
layer + Play drag-reorder). A CDN blip could dark the app. Now vendored:
- `vendor/supabase-js.js` (207 KB, supabase-js **2.107.0**) — used by
  `competition.js`, **precached** by the service worker.
- `vendor/sortablejs.js` (35 KB, sortablejs **1.15.2**) — dynamic import on Play
  Stage 2.
- Both bundled with esbuild to be fully self-contained (0 external imports);
  regenerate via `node scripts/vendor-deps.mjs` (see `vendor/README.md`).
- `sw.js` / `version-purge.js` bumped `wc26-v14 → wc26-v15` (forces a clean PWA
  cache refresh on deploy).
- New test `r15b-no-cdn-imports.test.mjs` fails if a CDN JS import returns.

**Intentionally NOT vendored:** flag-icons CSS + Google Fonts (non-critical,
heavy asset sets, graceful fallbacks already exist).

---

## How to ship after you approve
1. Review the diff on `r15b-cluster-bc`.
2. For #21: `supabase db push` (applies the lock migration to prod).
3. Merge the branch → Netlify deploys the functions + vendored app + v15 SW.
