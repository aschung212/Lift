import { defineConfig, devices } from '@playwright/test'
import { stubEnabled, stubOrigin, stubPort } from './e2e/support/supabaseStub'

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
  webServer: [
    // Fake Supabase (LIFT-1008). Started FIRST so the app never races a write
    // against a socket that isn't listening yet. Present only when the build
    // under test was given a loopback VITE_SUPABASE_URL — see
    // e2e/support/supabaseStub.ts for why that is the gate.
    ...(stubEnabled
      ? [{
          command: 'node e2e/support/supabase-stub.mjs',
          url: `${stubOrigin}/__health`,
          reuseExistingServer: !isCI,
          timeout: 15000,
          env: { E2E_SUPABASE_STUB_PORT: stubPort },
        }]
      : []),
    {
      command: isCI ? 'npm run preview' : 'npm run dev',
      url: isCI ? 'http://localhost:4173' : 'http://localhost:5173',
      reuseExistingServer: !isCI,
      timeout: isCI ? 30000 : 15000,
    },
  ],
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
