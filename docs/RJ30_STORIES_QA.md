# RJ30 — Stories, Tasks, Edge Cases & QA Scripts (index)

Detailed, codebase-grounded plans (user stories + Given/When/Then ACs + tasks + edge cases + concrete
`node:test`/Playwright QA scripts + iOS notes) live in the per-group files below. Built for the full
12-item RJ30 set, iOS-first, zero additional cost.

| Group | File | Items |
|---|---|---|
| A | [RJ30-A-odds-scorers.md](rj30/RJ30-A-odds-scorers.md) | RJ30-1 Polymarket per-match odds · RJ30-2 live scorers card |
| B | [RJ30-B-push.md](rj30/RJ30-B-push.md) | RJ30-3 goal + kickoff push (SW + VAPID + Supabase + Netlify fn) |
| C | [RJ30-C-weather-form.md](rj30/RJ30-C-weather-form.md) | RJ30-4 weather (Open-Meteo) · RJ30-8 results-derived form |
| D | [RJ30-D-winprob-standings.md](rj30/RJ30-D-winprob-standings.md) | RJ30-5 live win-prob timeline · RJ30-6 standings + scenarios |
| E | [RJ30-E-squads-bugs.md](rj30/RJ30-E-squads-bugs.md) | RJ30-7 squad refresh · RJ30-9 deferred bug bundle (a–e) |
| F | [RJ30-F-refs-accuracy-obs.md](rj30/RJ30-F-refs-accuracy-obs.md) | RJ30-10 referees · RJ30-11 accuracy dashboard · RJ30-12 observability |

## Key grounding findings (scope-reducing)
- **RJ30-2**: `golden-boot.js#liveGoalsByPlayer` already counts goals from `match_events`; the real gap is only the dark per-team **scorers card** → smaller than expected.
- **RJ30-9a**: `live-api/api/live.js` cache header is already correct (`s-maxage=10`, test-locked); only the **comment** is wrong → comment-only fix.
- **RJ30-9d**: winner-highlight logic is already unit-locked; real fix = the **card eyebrow drops the shootout `(x–y)` suffix** + add a browser DOM assertion.
- **RJ30-4**: weather inputs are complete; failure = a **timezone keying bug** + per-date HTTP throttling → batch one date-range call per venue, key by `kickoff_local_venue`.

## Recommendations being ADOPTED (override any if you disagree)
- Polymarket odds → **new `data/polymarket_odds.json`** (`source:"polymarket"`), added to the no-cache force-fetch list; generic "prediction markets" attribution. Delete dark `scrape_scorers.py`.
- `scorers.json` shape unchanged `{Team:[{name,goals,club}]}`.
- Form: **revive the composite `form` weight with a small floor (`max(w,0.01)`)**; unwire (don't delete) `scrape_form.py`; weather batched per-venue.
- Push: goal-diff state in a **Supabase table**; **vendor the `web-push` npm lib** in the Netlify fn; quiet-hours suppress **goals only** (kickoffs always send); multi-team column now, UI later.
- Win-prob: **detail page first**, card micro-bar fast-follow; "scores may be delayed" note off existing `data:scores-delayed`.
- Standings: **new `standings-view.js`** (keep group-view intact); 8 columns with `tabular-nums`.
- RJ30-9a header stays `s-maxage=10`; en-dash `pens (3–2)`; Python `--self-test` for the merge helper.

## Decisions ESCALATED to you (asked in chat)
1. **Push goal latency** — direct-ESPN real-time vs pipeline-bound (delayed).
2. **Supabase prod migration** timing/approach (per the never-apply-without-OK rule).
3. **RJ30-10 referee scope** — directory-only vs attempt per-match assignments.
