import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright e2e config.
 *
 * IMPORTANT: stop `npm run dev` before running `npm run test:e2e` — the
 * test webServer spawns its own backend with an isolated DB so we never
 * pollute the real dev data. `reuseExistingServer: false` enforces this.
 *
 * Each run gets a unique data dir (`./tests/e2e/__data__/run-<ts>`) so we
 * don't need to delete a previous run's locked SQLite files before
 * starting — webServer simply creates a fresh dir, bootstraps admin from
 * env, and goes. Old run dirs are cleaned by globalSetup (best-effort —
 * a locked one is skipped, not fatal).
 */
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const RUN_DATA_DIR = `./tests/e2e/__data__/run-${RUN_ID}`

export default defineConfig({
  testDir:   './tests/e2e',
  outputDir: './tests/e2e/__results__',
  snapshotDir: './tests/e2e/__snapshots__',

  // Shared isolated DB → can't run tests in parallel without races.
  // Smoke suite is small enough that serial is fine.
  fullyParallel: false,
  workers: 1,
  retries: 0,

  globalSetup: './tests/e2e/_helpers/globalSetup.ts',

  use: {
    baseURL: 'http://localhost:6200',
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
  },

  webServer: {
    command: 'npm run dev',
    url:     'http://localhost:6200',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VIDEO_ENGINE_DATA_DIR:    RUN_DATA_DIR,
      ADMIN_BOOTSTRAP_EMAIL:    'admin@e2e.test',
      ADMIN_BOOTSTRAP_PASSWORD: 'admin-e2e-pw-12345',
      NODE_ENV:                 'development',
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
