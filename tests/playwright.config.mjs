import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
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
