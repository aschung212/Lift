import { defineConfig } from '@playwright/test'

/**
 * Dedicated Playwright config for visual-regression snapshots (LIFT-664).
 *
 * Kept separate from `playwright.config.ts` (which drives the gating e2e job)
 * so pixel diffs — inherently OS/browser-sensitive and slower — never flake the
 * functional e2e gate. The main config `testIgnore`s `e2e/visual/**`, and this
 * config only runs it. Run via `npm run test:visual` / `test:visual:update`.
 *
 * Baselines are platform-suffixed (`-linux` / `-darwin`), so the Linux baselines
 * CI diffs against are generated in the pinned Playwright container, not on a mac.
 */

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './e2e/visual',
  timeout: 30000,
  // A pixel diff either matches or it doesn't — retrying can't rescue a real
  // regression and only hides flakiness, so no retries here.
  retries: 0,
  // Snapshots must be byte-stable; parallel workers contending for CPU can shift
  // sub-pixel anti-aliasing. One worker keeps rendering deterministic.
  workers: 1,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: isCI ? 'http://localhost:4173' : 'http://localhost:5173',
    headless: true,
    viewport: { width: 390, height: 844 }, // iPhone 14 Pro
    actionTimeout: 10000,
  },
  expect: {
    toHaveScreenshot: {
      // Freeze CSS animations/transitions and hide the text caret so a blinking
      // cursor or mid-flight gradient can't produce a false diff.
      animations: 'disabled',
      caret: 'hide',
      // Small tolerance absorbs unavoidable font anti-aliasing jitter while
      // still catching real visual breakage (a wrong gradient, inverted glass,
      // a layout shift moves far more than this fraction of pixels).
      maxDiffPixelRatio: 0.01,
    },
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
