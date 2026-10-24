import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the production build served under the same sub-path as GitHub
 * Pages (/latentscope/), so they also verify base-path handling, hash routing and worker URLs.
 * Run `npm run build` first (CI does), then `npm run test:e2e`.
 */
const PORT = 4173;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/latentscope/`,
    trace: 'retain-on-failure',
    // Software WebGL so the point-cloud renderer works on headless CI machines without a GPU.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /responsive\.spec\.ts/,
    },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/latentscope/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
