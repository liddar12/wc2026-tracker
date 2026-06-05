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
  timeout: 15_000,
  use: {
    baseURL: 'http://localhost:8088',
    viewport: { width: 390, height: 844 },
    trace: 'on-first-retry',
  },
  webServer: {
    // Run from repo root, not tests/. Without --directory, python serves
    // the cwd which Playwright sets to the config file's directory.
    command: 'python3 -m http.server 8088 --directory ..',
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
