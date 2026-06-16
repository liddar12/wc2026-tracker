# wc26-live — real-time live-score read API (Vercel Edge)

Phase 1 of [`../docs/REALTIME_ARCHITECTURE.md`](../docs/REALTIME_ARCHITECTURE.md).

A single Edge Function (`api/live.js`) that read-throughs ESPN's public
scoreboard, normalizes it to the `board` shape the PWA's `mergeLiveScores()`
consumes, and serves it **edge-cached (10s)** with CORS limited to prod. This
removes the 15–25 min Netlify-deploy latency from live scores without touching
hosting, data, or scoring.

## Deploy (one-time)
1. Import this repo into Vercel as a **new project** (team `liddar-terminal`).
2. Set **Root Directory = `live-api`** so Netlify (repo root) and this project
   stay fully independent.
3. Framework preset: **Other**. No env vars, no secrets (public read-only).
4. Deploy → note the URL, e.g. `https://wc26-live.vercel.app`.

## Endpoint
`GET /api/live` →
```json
{ "board": [ { "teams": { "France": 3, "Senegal": 1 }, "status": "STATUS_FULL_TIME", "minute": "" } ],
  "generated_at": "2026-06-16T21:50:00.000Z", "source": "espn" }
```

## Cutover (separate, reversible step)
Set `window.__WC26_LIVE_API_URL = 'https://wc26-live.vercel.app/api/live'` in the
PWA shell. The client then reads this endpoint and **falls back to direct ESPN
on any error**. Unset to revert instantly.

## Not in Phase 1
The `/api/sync` persistence cron (Vercel Pro) — added later once this is proven.
