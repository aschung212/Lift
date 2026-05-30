import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
    // *.browser.test.ts run in real Chromium via vitest.browser.config.js — they
    // rely on genuine layout (offsetHeight, scrollTop, visualViewport) that
    // happy-dom stubs to 0/undefined, so they must NOT run in this suite.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', '.claude/**', '**/node_modules/**', '**/supabaseIntegration.test.ts', '**/*.browser.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/**/__tests__/**', 'src/main.ts', 'src/App.vue'],
      // Static floor — the ratchet in .coverage-baseline.json enforces
      // the actual high-water mark via scripts/check-coverage-ratchet.js.
      // These are kept as a safety net in case the ratchet script is bypassed.
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 55,
        lines: 60,
      },
    },
  },
})
