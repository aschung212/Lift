import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { readFileSync } from 'fs'
import themeStripPlugin from './vite-plugin-theme-split'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: !!process.env.SENTRY_AUTH_TOKEN,
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-vendor': ['vue', 'pinia'],
          'supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
  server: {
    host: true,
  },
  plugins: [
    vue(),
    themeStripPlugin(),
    VitePWA({
      // Disable the service worker entirely for the native Capacitor build (#532).
      // WKWebView serves the web assets bundled in the .ipa and refreshes them via
      // `cap sync`, so a Workbox SW is redundant and can cause reload loops / stale
      // caches. `npm run cap:build` sets CAPACITOR_BUILD=true.
      disable: process.env.CAPACITOR_BUILD === 'true',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Lift — Workout Tracker',
        short_name: 'Lift',
        description: 'Track your sets, monitor progress, and hit personal records.',
        theme_color: '#0f0f0f',
        background_color: '#0f0f0f',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        start_url: '/',
        categories: ['health', 'fitness', 'sports'],
        shortcuts: [
          {
            name: 'Log Workout',
            short_name: 'Workouts',
            description: 'Jump to your workout tracker',
            url: '/?tab=workouts',
            icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'View Calendar',
            short_name: 'Calendar',
            description: 'See your training calendar',
            url: '/?tab=calendar',
            icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Track Weight',
            short_name: 'Weight',
            description: 'Log a bodyweight entry',
            url: '/?tab=weight',
            icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
        launch_handler: {
          client_mode: 'navigate-existing',
        },
        screenshots: [
          {
            src: 'screenshot-mobile.png',
            sizes: '921x2000',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Log sets with PR targets and personal bests',
          },
          {
            src: 'screenshot-detail.png',
            sizes: '921x2000',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Track estimated 1RM progress over time',
          },
          {
            src: 'screenshot-calendar.png',
            sizes: '921x2000',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Calendar view with workout summaries and PRs',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: [
          'screenshot-*.png',
          'og-image.png',
          'icon-source.png',
          'og-preview.html',
        ],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        navigationPreload: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // Authenticated Supabase REST GETs are intentionally NOT cached by the
            // service worker (LIFT-705). Lift is local-first (see CLAUDE.md): the
            // Pinia + localStorage store is the SINGLE source of truth for offline
            // reads. The store hydrates synchronously from localStorage on launch,
            // and `_fetchFromSupabase()` (src/stores/workout.ts) merges network data
            // with last-write-wins when online, falling back to local data when the
            // network is unavailable.
            //
            // A Workbox cache over these same endpoints would create a SECOND
            // offline-read layer that mirrors data already durably held in the store
            // but with different freshness windows and eviction rules — two sources
            // of truth that can diverge. The old StaleWhileRevalidate `sets` cache
            // could also hand the app a stale snapshot that races the store's merge.
            // NetworkOnly keeps reads always-fresh when online and store-backed when
            // offline, with no duplicate cache to reconcile or purge on sign-out.
            //
            // This contract is pinned by workboxCacheRegression.test.ts.
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            // Auth tokens must never be cached.
            urlPattern: /^https:\/\/.*\.supabase\.co\/auth\/v1\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
    // Upload source maps to Sentry on production builds
    // Requires SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT env vars
    process.env.SENTRY_AUTH_TOKEN
      ? sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
          sourcemaps: {
            filesToDeleteAfterUpload: ['./dist/**/*.map'],
          },
        })
      : null,
  ].filter(Boolean),
})
