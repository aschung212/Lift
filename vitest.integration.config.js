import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

/**
 * Vitest config for Supabase integration tests (LIFT-651).
 *
 * Usage:
 *   SUPABASE_INT_URL=http://127.0.0.1:54321 \
 *   SUPABASE_INT_SERVICE_ROLE_KEY=<key> \
 *   npx vitest run --config vitest.integration.config.js
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    globals: true,
    include: ['src/stores/__tests__/supabaseIntegration.test.ts'],
    testTimeout: 15_000,
  },
})
