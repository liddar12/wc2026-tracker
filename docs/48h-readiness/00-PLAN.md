# WC26 — 48-Hour Readiness Plan (R16)

**Goal:** get the app tournament-ready before the **2026-06-11 19:00Z** first kickoff.
**Branch:** `r16-48h-readiness` · **Hard rule:** nothing reaches prod until every QA level is 100% green (see §QA Gates).

## Decisions locked (from review)
| # | Decision | Choice |
|---|----------|--------|
| Auth UX | Sign in/up presentation + entry points | **Centered modal + one `openAuth(mode)`**, wired to every entry point; fix logout repaint |
| Scoring | Post-lock scoring + leaderboard total | **Client combined-total fix first** (all pools), **authoritative server scorer** as target (required by Everyone-pool scale) |
| Caching | Remove offline + anon expiry | **Network-only SW via version bump** (no unregister) + **90-min / stage-3 anon-draft expiry** via `version-purge` pattern |
| Everyone pool | Build the global default pool | **Full build**: seeded system-owned group + security-definer auto-join trigger + paginated server-side ranked leaderboard RPC |

## Critical-path ordering (by risk + dependency)
The auth fix is **Phase 1** per your instruction. Everything is sequenced so each phase ships behind 100%-green QA before the next starts, and the low-risk visible fixes land before the bigger server work.

| Phase | Window | Workstream | Risk | Why here |
|-------|--------|-----------|------|----------|
| **0** | 0–1h | Branch, green baseline, snapshot | none | start from known-good (90/90 feature green) |
| **1** | 1–10h | **AUTH** — single `openAuth()` modal, all entry points, logout repaint | med | the critical first step; unblocks everything user-facing |
| **2** | 10–13h | **Leaderboard combined total** (group 84 + knockout 96 = 180) | low | clear bug fix, no schema change, immediate value |
| **3** | 13–18h | **Caching/offline removal + anon 90-min/stage-3 expiry** | low–med | isolated to sw.js + version-purge; reversible |
| **4** | 18–40h | **Server scorer + Everyone pool** (migration, RPC, auto-join, seed) | high | biggest build; depends on the leaderboard total shape from Phase 2 |
| **5** | 40–48h | **Full regression + QA hardening + preview sign-off** | — | 100%-green gate before any prod deploy |

Each phase is a separate PR with its own green CI; phases merge in order. If Phase 4 runs long, Phases 1–3 are already shippable on their own (the client combined-total fix is the Everyone-pool fallback).

## Dependencies & coupling
- **Phase 4 needs Phase 2's total definition** (group+knockout sum, max 180) — the server RPC computes the same total server-side.
- **Everyone pool (Q4) ⇒ server scorer (Q2-B)**: the paginated RPC ranks by stored `score`; those columns only stay correct during the tournament if the scorer writes them. The new lock triggers (`20260604060000`) must get a SECURITY DEFINER bypass for the scorer.
- **Phase 3 vs Phase 4**: network-only SW means "expire cache" reduces to clearing localStorage anon drafts (no Cache Storage left). Do Phase 3 before Phase 4 to avoid building Cache-Storage-clearing code we'd delete.

## QA Gates (every phase must pass ALL before merge→prod)
1. **L1 Unit/feature** — `node --test tests/feature/*.mjs` (currently 90 green)
2. **L2 Logic/integration** — pure-function tests for new logic (auth state machine, scoring sum, expiry TTL, RPC contracts)
3. **L3 UX e2e** — `playwright … tests/ux` (guest, signed-out, signed-in, pwa-ios) + new auth-modal specs for **every** entry point + signout
4. **L4 Integrated** — `tests/integrated/happy-path`
5. **L5 Preview** — Netlify deploy-preview + the preview Supabase project; smoke the changed flows
6. **L6 Customer scenarios** — the `tests/ux/qa-*` scenario specs run explicitly + manual sign-off
**Gate:** 100% green at L1–L4 in CI, L5 preview verified, L6 signed off → then merge to main → prod deploy → re-verify on prod.

## Go / No-Go for prod
- Auth: all 5 entry points open the modal; sign in, sign up, sign out, guest each verified on preview (signed-in + guest + invited).
- Leaderboard shows combined 0–180 total with real usernames.
- Offline genuinely off (no SW cache serving); anon drafts expire at 90 min / after stage-3.
- Everyone pool: new signup auto-joins; leaderboard paginates; no unbounded client query.
- No regression in the 90 feature + 16 Playwright suites.

See `01-REQUIREMENTS.md`, `02-ARCHITECTURE.md`, `03-TECH-SPEC.md`.
