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
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Lift — Workout Tracker',
        short_name: 'Lift',
        description: 'Track your sets, monitor progress, and hit personal records.',
        theme_color: '#0f0f0f',
        background_color: '#0f0f0f',
        display: 'standalone',
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
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // Sets collection grows as new sets are logged — StaleWhileRevalidate
            // serves cached response instantly for offline/fast load while updating
            // the cache in the background so new sets from other devices appear next load
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/sets\b/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'supabase-sets',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Exercises change infrequently (renames, tag edits) — NetworkFirst with generous capacity
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/exercises\b/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-exercises',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 12, // 12 hours
              },
              networkTimeoutSeconds: 3,
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Bodyweight entries — moderate churn, NetworkFirst
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/bodyweight_entries\b/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-bodyweight',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 12, // 12 hours
              },
              networkTimeoutSeconds: 3,
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Progression/XP data — small payload, short TTL
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/(user_progression|xp_events|progression_snapshots)\b/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-progression',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 6, // 6 hours
              },
              networkTimeoutSeconds: 3,
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Catch-all for any other Supabase REST endpoints
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              },
              networkTimeoutSeconds: 3,
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/auth\/v1\/.*/i,
            handler: 'NetworkOnly',
            options: {
              cacheName: 'supabase-auth',
            },
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
