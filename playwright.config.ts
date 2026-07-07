import { defineConfig, devices } from '@playwright/test'

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: isCI ? 2 : 1,
  use: {
    baseURL: isCI ? 'http://localhost:4173' : 'http://localhost:5173',
    headless: true,
    actionTimeout: 10000,
  },
  webServer: {
    command: isCI ? 'npm run preview' : 'npm run dev',
    url: isCI ? 'http://localhost:4173' : 'http://localhost:5173',
    reuseExistingServer: !isCI,
    timeout: isCI ? 30000 : 15000,
  },
  projects: [
    // WebKit is the primary target: Lift is an iOS-first PWA shipping in
    // WKWebView via Capacitor, and Safari-only behaviors (container scroll-lock,
    // backdrop-filter glass, viewport keyboard, safe-area insets) don't repro on
    // Blink. The iPhone 14 Pro descriptor supplies an accurate mobile-Safari
    // UA + touch/mobile emulation instead of a bare 390x844 viewport.
    {
      name: 'webkit',
      use: { ...devices['iPhone 14 Pro'] },
    },
    // Chromium is kept for broad cross-engine coverage, at the original
    // iPhone-14-Pro viewport so its existing behavior is unchanged.
    {
      name: 'chromium',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 } },
    },
  ],
})
