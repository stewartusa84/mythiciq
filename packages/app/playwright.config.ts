import { defineConfig, devices } from '@playwright/test';

// E2E suite for the MVP analyzer. Runs against a PRODUCTION build served by `vite preview` (closest to
// what ships), so it catches build/worker/wasm issues a dev server can hide. The AWS pipeline runs this
// in its pre-deploy Verify stage; run locally with `pnpm --filter @wow/app e2e` while iterating.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Each parse spins a worker + wasm; keep a couple of workers to avoid hammering a laptop.
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // The `e2e` script builds the app first; this just serves the built dist. reuseExistingServer lets you
  // keep a `pnpm preview` running while iterating on specs.
  webServer: {
    command: 'pnpm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
