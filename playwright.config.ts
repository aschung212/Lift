import { defineConfig } from '@playwright/test'

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  // Visual-regression snapshots live under e2e/visual and run via their own
  // config (playwright.visual.config.ts) — excluded here so the functional e2e
  // gate never runs pixel diffs (LIFT-664).
  testIgnore: '**/visual/**',
  timeout: 30000,
  retries: isCI ? 2 : 1,
  use: {
    baseURL: isCI ? 'http://localhost:4173' : 'http://localhost:5173',
    headless: true,
    viewport: { width: 390, height: 844 }, // iPhone 14 Pro
    actionTimeout: 10000,
  },
  webServer: {
    command: isCI ? 'npm run preview' : 'npm run dev',
    url: isCI ? 'http://localhost:4173' : 'http://localhost:5173',
    reuseExistingServer: !isCI,
    timeout: isCI ? 30000 : 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
