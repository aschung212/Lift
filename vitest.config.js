import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // vite-plugin-pwa injects `virtual:pwa-register` only during a real build.
      // Alias it to a test stub so composables that register the SW are testable.
      'virtual:pwa-register': fileURLToPath(
        new URL('./src/__tests__/stubs/pwaRegister.ts', import.meta.url)
      ),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
    // `**/*.browser.test.ts` runs only under vitest.browser.config.js (real
    // Chromium via Playwright) — exclude it here so it never executes under
    // happy-dom, which stubs the layout geometry those tests exist to verify.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', '.claude/**', '**/node_modules/**', '**/supabaseIntegration.test.ts', '**/*.browser.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/**/__tests__/**', 'src/**/*.typecheck.ts', 'src/main.ts', 'src/App.vue'],
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
