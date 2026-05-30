import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import vue from '@vitejs/plugin-vue'

// Browser-mode config for layout/gesture-sensitive composables.
//
// happy-dom (used by the default vitest.config.js) stubs layout primitives
// like getBoundingClientRect, offsetHeight, scrollTop, and visualViewport to
// zeros/undefined. Tests for gesture and focus composables therefore have to
// monkey-patch geometry by hand, which validates wiring but not real behavior.
//
// This config runs ONLY the *.browser.test.ts files in a real Chromium via the
// Playwright provider, so those tests exercise true layout, real focus order,
// and an actual visualViewport. It is intentionally separate from the default
// suite: the fast happy-dom tests still run on every `npm test` and feed the
// coverage ratchet, while these slower, browser-dependent tests run via
// `npm run test:browser` and their own CI job.
export default defineConfig({
  plugins: [vue()],
  // The browser already runs modern Chromium, so there is no reason to
  // down-level dependencies. Leaving the default target makes esbuild try to
  // transpile @babel/parser (a transitive dep of @vue/compiler-sfc) to es2020
  // and fail; 'esnext' skips those transforms entirely.
  esbuild: { target: 'esnext' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  test: {
    globals: true,
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      // CI runs `npx playwright install chromium`, which provisions the
      // chrome-headless-shell binary the default launch uses. Local devs who
      // have not downloaded that binary can point at an installed browser via
      // VITEST_BROWSER_CHANNEL=chrome (or =chromium) instead.
      provider: playwright(
        process.env.VITEST_BROWSER_CHANNEL
          ? { launchOptions: { channel: process.env.VITEST_BROWSER_CHANNEL } }
          : {}
      ),
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
  },
})
