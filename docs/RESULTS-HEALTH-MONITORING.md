# Results-feed health monitoring (runbook)

Goal: get paged if `data/actual_results.json` goes **stale or empty during the
tournament** (which would silently freeze every leaderboard). Per the build-cycle
decision, alerting is delivered by an **external uptime monitor** pointed at the
existing health endpoint — **no app code change**.

## The endpoint
```
GET https://worldcup2026.j5lagenticstrategy.com/.netlify/functions/results-health
```
Returns JSON and an HTTP status that encodes health:

| Condition | HTTP | Body |
|---|---|---|
| Healthy (or pre-tournament) | **200** | `{"ok":true, "phase":"…", "ageHours":…, "stale":false, "emptyDuringLive":false, …}` |
| Degraded (stale/empty feed while a phase is live) | **503** | `{"ok":false, "reasons":[…], …}` |

It also runs itself `@hourly` (Netlify scheduled function) and logs degraded
states to the function log. The monitor below is the part that actually *pages
you*.

## Set up the monitor (~3 min, free tier)
**UptimeRobot** (or BetterStack/Pingdom — same idea):
1. Create a new monitor → type **HTTP(s)**.
2. URL: the endpoint above.
3. Monitoring interval: **5 minutes**.
4. Alert condition: trigger when **HTTP status ≠ 200** (the function returns
   503 when degraded). Optionally also add a **keyword** check: alert if the
   response body does **not** contain `"ok":true`.
5. Alert contacts: your email / SMS / push.
6. (Optional) maintenance window: ignore alerts before 2026-06-11 (pre-tournament
   the endpoint is healthy/200 anyway, so this isn't required).

## What to do when it fires
A 503 means the results feed is stale or the current phase has no results yet
populated. Check, in order:
1. The data pipeline / scraper that writes `data/actual_results.json` (it's a
   static asset refreshed out-of-band; `last_updated` should be recent during a
   live phase).
2. `GET …/data/actual_results.json` — is the current round's object empty?
3. The function log (Netlify → Functions → results-health) for the exact
   `reasons`.

## If you later want in-app push instead
Wiring a Slack/Discord webhook (or email via Resend) into `results-health.mjs`
is a small follow-up: POST the report to `WC26_ALERT_WEBHOOK` when `!ok`. Left
out for now per the zero-code decision.
