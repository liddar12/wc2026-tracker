# Match Momentum (10s extremes) — R18.1 incident review + solution architecture

## Incident (July 10 quarter-finals)

During live matches the Match Momentum panel never accumulated its per-minute
pressure bars: users saw "Sampling live pressure…" or one/two near-zero bars
that kept resetting. The in-play win-probability bar itself was correct — only
the momentum visual was broken.

## Root cause (confirmed)

Two designs collided:

1. `app/main.js` handles `data:live-refresh` (fired ~every 30s by the live
   poller during a live match) by calling `setData(fresh)`, which re-renders
   the ENTIRE current view — `root.innerHTML` is rebuilt, scroll preserved,
   DOM not.
2. `app/live-momentum.js` (original R18) tied the sampler to its card:
   - the tracker (per-minute extremes Map + previous-sample ref) lived in a
     per-render closure — nothing persisted across renders;
   - `tick()` self-destructed when the card left the DOM
     (`!document.body.contains(card) → stop()`);
   - the ESPN event id was re-resolved on every render.

Every 30s the panel was therefore torn down and restarted from zero: new empty
tracker, first sample's pressure delta = 0 by definition, 2–3 ticks at most,
wiped again. The series could never grow. (The win-probability widget survived
because it persists its series in `window.__wc26WinProbSeries` — the exact
pattern the momentum tracker was missing.)

## Why tests were green

Nothing in the suite exercised a live match ACROSS a re-render cycle. The R18
tests lock the pure math (tracker extremes/dedupe, ESPN parsing, Poisson
inversion) — all of which were correct.

## Fix (R18.1) — singleton sampler detached from DOM lifecycle

`app/live-momentum.js` now keeps a module-level registry:

    samplers: Map<pairKey, { tracker, host, timer, startedAt, stopped, ready }>

- `momentumSection()` is attach-only: get-or-create the pair's sampler, point
  `sampler.host` at the freshly rendered card's host, and immediately repaint
  the FULL accumulated series (or the sampling note when empty).
- The 10s tick never checks card containment; it paints only when the current
  host is attached, and otherwise just keeps sampling. A re-render can no
  longer kill it.
- The ESPN event id is resolved once per match. A failed resolution retires
  the registry entry so the next re-render (~30s later) retries.
- Stop conditions: FINAL status or the 4h `LIVE_MAX_MS` failsafe. A finished
  sampler KEEPS its series, so the chart stays visible after full time (and
  when navigating away and back).
- Trade-off accepted: a sampler keeps polling (1 summary fetch/10s) while the
  user is on a different route until FINAL/failsafe — bounded, and it makes
  return-to-match instant.

Locked by `tests/feature/r18b-momentum-persistence.test.mjs` (singleton reuse
across re-renders, single event-id resolution, instant repaint, FINAL keeps
series, failed-resolution retry, zero-tick rendering).

## UX changes shipped with the fix

- Side colors now follow the app-wide A/B convention — team A `--primary`,
  team B `--accent` — matching the win-probability, xG and match-stats bars
  beside the panel (was blue `--accent` / red `--danger`, unlike everything
  else on the page).
- Visible dashed CENTER AXIS the bars grow away from.
- Team legend row ("▲ France … Morocco ▼") in the side colors.
- Bars compress (flex-shrink to a 1px floor) so a full 90'+ match fits the
  card on a phone; horizontal scroll only past the floor.
- No-signal minutes (|pressure| < 0.01 — including the first sample after a
  sampler start, which has no previous snapshot to delta against) render as a
  neutral tick on the axis instead of a colored blip.
- The host paints immediately on mount — the blank-area state between card
  creation and the first sample is gone.
