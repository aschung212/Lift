import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PUBLIC_ASSET_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico']

/**
 * Serve root-relative public assets as their URL string under test.
 *
 * `<img src="/icon-512.png">` in an SFC compiles to `import _imports_0 from
 * '/icon-512.png'`, and Vite resolves that public asset to the bare id
 * `/icon-512.png`. On Linux that doubles as an absolute filesystem path, so
 * vitest's module runner turns it into `file:///icon-512.png` and loads it. On
 * Windows the same URL has no drive letter, `createRequire` rejects it with
 * ERR_INVALID_ARG_VALUE, and every suite that mounts such a component fails at
 * import time with zero tests run.
 *
 * Resolving these ids here to a module exporting the URL string matches what
 * the browser actually sees (`/icon-512.png`) and behaves identically on both
 * platforms. The `existsSync` guard keeps the interception narrow: only paths
 * that really are files in `public/` are claimed.
 */
function publicAssetUrlPlugin() {
  const publicDir = fileURLToPath(new URL('./public/', import.meta.url))
  // Vite's convention for a virtual module id is a leading NUL byte.
  const VIRTUAL_PREFIX = String.fromCharCode(0) + 'public-asset'

  return {
    name: 'lift:test-public-asset-url',
    enforce: 'pre',
    resolveId(id) {
      if (id[0] !== '/') return null
      if (!PUBLIC_ASSET_EXTENSIONS.some((ext) => id.endsWith(ext))) return null
      if (!existsSync(publicDir + id.slice(1))) return null
      return VIRTUAL_PREFIX + id
    },
    load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return null
      return `export default ${JSON.stringify(id.slice(VIRTUAL_PREFIX.length))}`
    },
  }
}

export default defineConfig({
  plugins: [vue(), publicAssetUrlPlugin()],
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
