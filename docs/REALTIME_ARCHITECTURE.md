# WC26 Tracker — Real-Time & Durability Architecture (Vercel)

**Status:** Proposal for review · **Author:** Claude · **Date:** 2026-06-16

---

## 1. Problem (why we keep firefighting)

Live data (scores, clock, goals, cards) is produced by **GitHub Actions cron**
(`*/15` `live_update`) → commits JSON to `main` → **Netlify** rebuilds → browser.
Two structural failures keep recurring:

1. **GitHub throttles high-frequency schedules.** `*/15` actually fired ~every
   **3–5 hours** on Jun 16 (verified via `gh run list`). France 3-1 never got
   scraped for 2.5h because no run executed after kickoff.
2. **Deploy latency.** Even when it fires: ESPN → Actions → commit → Netlify
   deploy = **15–25 min** best case. That is not "real-time" by any definition.

Today's mitigations (client-side ESPN polling, multi-cron results floor) help
but are band-aids. We want a **durable, real-time data plane** that does not
depend on GitHub's scheduler or a redeploy to show a score.

## 2. Goals

| # | Requirement | Target |
|---|---|---|
| G1 | Live score/clock latency (open app) | **≤ 15 s** |
| G2 | A finished game's final shows without a redeploy | **always** |
| G3 | Reliable scheduler (not GitHub's dropped crons) | **99%+ on-time** |
| G4 | Canonical results persisted for scoring/leaderboards/history | **≤ 2 min after FINAL** |
| G5 | No regression to the static-site model for non-live data | unchanged |
| G6 | Fail-safe: a backend outage degrades gracefully, never blanks scores | required |

**Non-goal:** moving the site off Netlify. Vercel hosts a *small live-data
backend only*; the PWA stays on Netlify.

## 3. Proposed architecture — two decoupled paths

```
                         ┌──────────────────────────────────────────┐
                         │            VERCEL (new project)            │
                         │            wc26-live (Node/Edge)           │
                         │                                            │
  ESPN scoreboard ───────┼─▶  /api/live   (Edge Fn, read-through)     │
  site.api.espn.com      │     • fetch ESPN, normalize to our schema  │
       ▲                 │     • CORS: allow Netlify origin           │
       │                 │     • Cache-Control: s-maxage=10, SWR=30   │◀──┐ 30s poll
       │                 │                                            │   │ (live window)
       │                 │   Vercel Cron (1–3 min, match-gated)       │   │
       └─────────────────┼─◀  /api/sync   (Serverless Fn)             │   │
                         │     • fetch ESPN                           │   │
                         │     • on STATUS change → write snapshot    │   │
                         │     • on FINAL (new) → commit to GitHub ───┼───┼──┐
                         │     • secured by CRON_SECRET               │   │  │
                         └──────────────────────────────────────────┘   │  │
                                                                          │  │
   ┌───────────────────────────── NETLIFY (unchanged) ──────────────────┘  │
   │  PWA (vanilla JS)                                                      │
   │   • live-poller.js → GET /api/live  (was: hit ESPN directly)          │
   │   • renders score/clock from normalized payload                       │
   │   • data/*.json still served statically for everything else          │
   └───────────────────────────────────────────────────────────────────────┘
                                                                          │
   ┌──────────────────────── GitHub repo (liddar12) ◀─────────────────────┘
   │  data/actual_results.json ← committed by /api/sync on FINAL
   │  → Netlify redeploy → durable record for scoring/leaderboards/history
   │  GitHub Actions: keeps DAILY model rebuild only (no live cron needed)
   └──────────────────────────────────────────────────────────────────────
```

### Path A — Real-time **read** (`/api/live`)  → satisfies G1, G2, G6
- A Vercel **Edge Function** that fetches ESPN, normalizes to our exact
  `actualResults` shape (reuses `app/live-scores.js` logic), and returns JSON
  with `Cache-Control: s-maxage=10, stale-while-revalidate=30` + CORS for the
  Netlify origin.
- The PWA's `live-poller.js` polls **this endpoint** instead of ESPN directly.
  Benefit over today's client-only polling: normalized server-side, no
  client/ESPN coupling, works on first paint, one shared 10 s edge cache for
  all users (ESPN sees ~6 req/min total, not per-user).
- **No cron, no storage, works on Hobby.** If Vercel is down, the client falls
  back to the static `data/actual_results.json` (G6).

### Path B — Durable **persistence** (`/api/sync` + Vercel Cron) → G3, G4
- **Vercel Cron** (reliable, exact schedule) hits `/api/sync` every 1–3 min,
  **gated to live match windows** (skip-cost ~0 when no match is on).
- `/api/sync` fetches ESPN; when a match's status/score **changes**, it updates
  the snapshot; when a match goes **FINAL and isn't yet in git**, it commits the
  canonical record to `data/actual_results.json` via the GitHub API → Netlify
  redeploy → durable record for **scoring, leaderboards, history**.
- This **replaces** the throttled `live_update` GitHub cron. GitHub Actions
  keeps only the daily model rebuild (Elo/DT/hybrid/Kalshi) — cadence it's fine
  for.

### Why two paths
Reads must be **fast and cheap** (no git, no deploy). Persistence must be
**reliable and durable** (git is the source of truth for scoring). Conflating
them is exactly what makes the current pipeline both slow *and* fragile.

## 4. Storage decision

| Option | Use | Verdict |
|---|---|---|
| **None (read-through)** | `/api/live` recomputes from ESPN per request, edge-cached 10 s | ✅ **Recommended** for Path A — simplest, no new resource |
| **Vercel KV / Edge Config** | Cron writes snapshot, API reads it | Optional later; only if ESPN rate-limits or we add derived state |
| **Git (existing)** | Canonical FINAL records | ✅ Keep — it's the scoring source of truth |

Recommendation: **no new storage to start.** Read-through + git covers G1–G6.

## 5. Plan & cost

| | Hobby (free) | **Pro (~$20/mo)** |
|---|---|---|
| `/api/live` read-through | ✅ works | ✅ works |
| Cron cadence | ~once/day only (unusable for live) | **exact, minute-level** ✅ |
| Function duration | 10 s (enough) | 60 s+ |
| Verdict | Path A only | **Path A + B (full solution)** |

- **Path A alone** (real-time reads) runs on **Hobby/free** and already gets us
  G1+G2 — the visible "scores update live" win.
- **Path B** (reliable persistence cron) needs **Pro** for minute-level crons.
  ~$20/mo buys G3+G4 and lets us retire the flaky GitHub live cron.

## 6. Security
- `/api/sync` requires `Authorization: Bearer $CRON_SECRET` (Vercel injects it
  for cron; rejects public calls).
- GitHub commit uses a fine-scoped **PAT** (contents:write on the one repo) in
  Vercel env vars — never in client code.
- `/api/live` is public read-only (it only exposes already-public scores), CORS
  limited to the Netlify origin.

## 7. Rollout (phased, each independently shippable & reversible)

1. **Phase 0 (done):** client ESPN polling + multi-cron results floor — today's
   band-aids stay as the fallback layer (G6).
2. **Phase 1 — `/api/live` read-through (Hobby).** Point `live-poller.js` at it
   behind a feature flag. Ship → verify ≤15 s live updates. *Biggest UX win,
   zero cost, fully reversible (flip flag back to ESPN-direct).*
3. **Phase 2 — `/api/sync` + Vercel Cron (Pro).** Stand up the persistence cron;
   run it in parallel with the GitHub live cron for one match day to confirm
   parity; then disable the GitHub `live_update` cron.
4. **Phase 3 — cleanup.** Remove the multi-cron results floor once Path B is
   proven; GitHub Actions = daily rebuild only.

## 8. What does NOT change
- Netlify hosting, the PWA, the static `data/*.json` for schedule/odds/models.
- The daily GitHub Actions model rebuild (Elo/DT/hybrid).
- Scoring logic, Supabase, auth, all client views.

## 9. Open decisions (for review)
- **D1 — How real-time?** ≤15 s (Path A) vs near-instant. Recommend ≤15 s.
- **D2 — Pro plan?** Needed for Path B's reliable cron. Recommend yes ($20/mo).
- **D3 — Scope now?** Path A only (free, fast win) vs A+B (full durable).
  Recommend **start with A**, add B once A is proven.
</content>
