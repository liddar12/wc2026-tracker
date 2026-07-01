import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  // R14: the qa-*.spec.mjs files are ad-hoc audit scripts (they write findings
  // to a hardcoded local jobs path and target the live/preview site), NOT the
  // maintained regression suite. Exclude them from glob runs / CI; run them
  // explicitly by filename when doing an audit.
  testIgnore: ['**/qa-*.spec.mjs'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  // Critical-path loading (app/data-loader.js) paints from the CRITICAL feeds,
  // then streams ~19 DEFERRED feeds in the background per page. Under the
  // single-threaded `python -m http.server` used here with workers:1, one test's
  // in-flight background fetches back the server up enough to delay the NEXT
  // test's goto — occasionally past the old 15s budget. Production serves these
  // in parallel (Netlify/HTTP2), so this headroom is a test-server artifact, not
  // an app slowdown. A genuine assertion failure still fails immediately; only a
  // true hang uses the full budget.
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:8088',
    viewport: { width: 390, height: 844 },
    trace: 'on-first-retry',
  },
  webServer: {
    // Serve the repo root (cwd is the config dir, tests/, so directory='..').
    // MUST be threaded: critical-path loading fires ~19 parallel background
    // fetches per page, and the stock single-threaded `python -m http.server`
    // serialized them — its backlog compounded across the serial suite until
    // later tests' goto exceeded the budget. ThreadingHTTPServer serves the
    // parallel fetches concurrently, matching how production (Netlify/HTTP2)
    // behaves, so page loads stay fast and the suite is stable.
    command: `python3 -c "from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler; from functools import partial; ThreadingHTTPServer(('', 8088), partial(SimpleHTTPRequestHandler, directory='..')).serve_forever()"`,
    url: 'http://localhost:8088',
    reuseExistingServer: true,
    timeout: 15_000,
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
