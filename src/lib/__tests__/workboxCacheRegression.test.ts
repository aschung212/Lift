/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { RUNTIME_CACHING } from '../swRuntimeCaching'
import { resolveWorkboxRoute, type RouteRule } from '../../__tests__/serviceWorkerModel'

/**
 * Regression tests for the service worker's runtime routes.
 *
 * These EVALUATE the route table — the array `vite.config.js` hands to
 * `generateSW` — by resolving real request URLs the way workbox-routing does
 * (first match wins). They used to assert on the text of vite.config.js, which
 * could say a cache existed but not which requests it answered: the old
 * "has a catch-all supabase-api cache for unknown endpoints" test pinned, as a
 * feature, the route that served a stale `user_preferences` row as the
 * account's current settings (LIFT-1510).
 */

const viteConfig = readFileSync(resolve(__dirname, '../../../vite.config.js'), 'utf-8')

const SUPABASE = 'https://abcdefghijklmnopqrst.supabase.co'
const read = (table: string) => `${SUPABASE}/rest/v1/${table}?select=*&user_id=eq.00000000-0000-4000-8000-000000000000`
const route = (url: string, method = 'GET') => resolveWorkboxRoute(RUNTIME_CACHING, url, method)

describe('Workbox runtime routes', () => {
  describe('the collections that keep a cache', () => {
    it('serves sets StaleWhileRevalidate from a 500-entry cache (100+ exercises × pages)', () => {
      expect(route(read('sets'))).toMatchObject({
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'supabase-sets', expiration: { maxEntries: 500 } },
      })
    })

    it('serves exercises NetworkFirst from a 200-entry cache', () => {
      expect(route(read('exercises'))).toMatchObject({
        handler: 'NetworkFirst',
        options: { cacheName: 'supabase-exercises', expiration: { maxEntries: 200 } },
      })
    })

    it('serves bodyweight entries NetworkFirst from their own cache', () => {
      expect(route(read('bodyweight_entries'))).toMatchObject({
        handler: 'NetworkFirst',
        options: { cacheName: 'supabase-bodyweight' },
      })
    })
  })

  describe('everything else goes to the network, and only the network (LIFT-1510)', () => {
    it.each(['user_preferences', 'user_progression'])('never answers a %s read from a cache', (table) => {
      expect(route(read(table))?.handler).toBe('NetworkOnly')
    })

    it('gives a table no rule names the network too, so caching one is always a decision', () => {
      // The catch-all is how user_preferences came to be cached: nobody chose it.
      expect(route(read('a_table_added_next_year'))?.handler).toBe('NetworkOnly')
    })

    it('never caches a write: upserts and updates match no route at all', () => {
      for (const table of ['sets', 'exercises', 'user_preferences']) {
        expect(route(`${SUPABASE}/rest/v1/${table}?on_conflict=user_id`, 'POST')).toBeUndefined()
        expect(route(`${SUPABASE}/rest/v1/${table}?id=eq.x`, 'PATCH')).toBeUndefined()
      }
    })

    it('keeps auth NetworkOnly (never cache tokens)', () => {
      expect(route(`${SUPABASE}/auth/v1/token?grant_type=refresh_token`, 'GET')?.handler).toBe('NetworkOnly')
    })

    it('sets networkTimeoutSeconds only on NetworkFirst, the one handler workbox-build 7 accepts it on', () => {
      // Its types allow it on NetworkOnly too, but generateSW throws
      // `invalid-network-timeout-seconds` at build time. Bounding the new
      // NetworkOnly reads that way is not available; LIFT-1516 is the fix.
      for (const rule of RUNTIME_CACHING.filter(r => r.handler !== 'NetworkFirst')) {
        expect(rule.options?.networkTimeoutSeconds).toBeUndefined()
      }
    })
  })

  describe('vite.config.js ships this table', () => {
    it('passes RUNTIME_CACHING to generateSW', () => {
      expect(viteConfig).toMatch(/import \{ RUNTIME_CACHING \} from '\.\/src\/lib\/swRuntimeCaching'/)
      expect(viteConfig).toMatch(/runtimeCaching:\s*RUNTIME_CACHING\b/)
    })

    it('defines no route inline, where none of these tests would see it', () => {
      expect(viteConfig).not.toMatch(/urlPattern\s*:/)
    })
  })

  describe('the route model reads Workbox the way Workbox does (self-test)', () => {
    const rules: RouteRule[] = [
      { urlPattern: /\/rest\/v1\/sets\b/, handler: 'CacheFirst' },
      { urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/sets\b/, handler: 'StaleWhileRevalidate' },
      { urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/, handler: 'NetworkFirst' },
      { urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/, handler: 'NetworkOnly', method: 'POST' },
    ]

    it('ignores a cross-origin RegExp that matches past index 0, then takes the first full match', () => {
      expect(resolveWorkboxRoute(rules, read('sets'))?.handler).toBe('StaleWhileRevalidate')
    })

    it('matches a rule against its own method only', () => {
      expect(resolveWorkboxRoute(rules, read('exercises'), 'POST')?.handler).toBe('NetworkOnly')
      expect(resolveWorkboxRoute(rules, read('exercises'), 'PATCH')).toBeUndefined()
    })

    it('refuses to guess about a urlPattern it cannot evaluate', () => {
      expect(() => resolveWorkboxRoute([{ urlPattern: () => true, handler: 'NetworkOnly' }], read('sets')))
        .toThrow(/only RegExp routes are modelled/)
    })
  })

  describe('rest-timer notification action handler (LIFT-751)', () => {
    it('injects the custom notificationclick handler into the generated SW', () => {
      // Without this importScripts entry, the notification action buttons render
      // but clicking them does nothing (generateSW has no notification handling).
      expect(viteConfig).toContain("importScripts: ['sw-notification-handler.js']")
    })

    it('ships the handler script that routes the rest-again action', () => {
      const handler = readFileSync(
        resolve(__dirname, '../../../public/sw-notification-handler.js'),
        'utf-8',
      )
      expect(handler).toContain('notificationclick')
      expect(handler).toContain('rest-again')
      expect(handler).toContain('lift-rest-timer')
    })
  })
})
