/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { RUNTIME_CACHING, SUPABASE_ORIGIN_PATTERN } from '../swRuntimeCaching'
import { resolveWorkboxRoute, answersFromCache, type RouteRule } from '../../__tests__/serviceWorkerModel'

/**
 * Regression tests for the service worker's runtime routes (LIFT-1524).
 *
 * This file used to slice vite.config.js as TEXT and assert that a
 * StaleWhileRevalidate `supabase-sets` cache, NetworkFirst `supabase-exercises`
 * / `supabase-bodyweight` / `supabase-progression` caches and a `supabase-api`
 * catch-all all existed, in that order. Every one of those caches answered a
 * store's read with a past state of the server, which the stores cannot tell
 * from the present one, so the file pinned the defect as the feature. It now
 * resolves real request URLs against the array the build ships, the way Workbox
 * resolves them (see `serviceWorkerModel.ts`).
 */

const viteConfig = readFileSync(resolve(__dirname, '../../../vite.config.js'), 'utf-8')

const PROJECT = 'https://project.supabase.co'
const USER = '00000000-0000-4000-8000-000000000001'

/** Requests the app actually sends to the Supabase project, by the client that sends them. */
const SUPABASE_REQUESTS = [
  `${PROJECT}/rest/v1/sets?select=*&user_id=eq.${USER}&deleted_at=is.null&order=created_at.asc,id.asc&offset=0&limit=1000`,
  `${PROJECT}/rest/v1/exercises?select=*&user_id=eq.${USER}&deleted_at=is.null&order=created_at.asc,id.asc&offset=1000&limit=1000`,
  `${PROJECT}/rest/v1/bodyweight_entries?select=*&user_id=eq.${USER}&deleted_at=is.null&order=created_at.asc,id.asc&offset=0&limit=1000`,
  `${PROJECT}/rest/v1/user_preferences?select=preferences&user_id=eq.${USER}`,
  `${PROJECT}/rest/v1/user_progression?select=*&user_id=eq.${USER}`,
  `${PROJECT}/auth/v1/user`,
]

describe('Workbox runtime routes', () => {
  describe('the Supabase project is never answered from Cache Storage (LIFT-1524)', () => {
    it.each(SUPABASE_REQUESTS)('%s goes to the network', (url) => {
      expect(resolveWorkboxRoute(RUNTIME_CACHING, url)?.handler).toBe('NetworkOnly')
    })

    it('claims the whole Supabase origin in the FIRST route, so no later rule can capture it', () => {
      expect(RUNTIME_CACHING[0]).toEqual({ urlPattern: SUPABASE_ORIGIN_PATTERN, handler: 'NetworkOnly' })
    })

    it('no route that can answer from a cache matches any Supabase request, whatever its position', () => {
      const caching = RUNTIME_CACHING.filter(answersFromCache)
      for (const url of SUPABASE_REQUESTS) expect(resolveWorkboxRoute(caching, url), url).toBeUndefined()
    })

    it('the origin pattern does not reach past the Supabase host into another origin', () => {
      expect(SUPABASE_ORIGIN_PATTERN.test(`${PROJECT}/rest/v1/sets`)).toBe(true)
      expect(SUPABASE_ORIGIN_PATTERN.test('https://example.com/project.supabase.co/rest/v1/sets')).toBe(false)
    })
  })

  describe('vite.config.js ships exactly this table', () => {
    it('hands RUNTIME_CACHING to generateSW', () => {
      expect(viteConfig).toContain("import { RUNTIME_CACHING } from './src/lib/swRuntimeCaching'")
      expect(viteConfig).toContain('runtimeCaching: RUNTIME_CACHING')
    })

    it('defines no route of its own', () => {
      // A route declared inline would ship without ever reaching the tests above.
      expect(viteConfig).not.toMatch(/urlPattern\s*:/)
      expect(viteConfig).not.toMatch(/\bhandler\s*:\s*['"]/)
    })
  })

  describe('the route model these tests resolve with (serviceWorkerModel.ts)', () => {
    const rule = (urlPattern: RegExp, handler: string, method?: string): RouteRule => ({ urlPattern, handler, method })

    it('takes the first matching rule, as workbox-routing does', () => {
      const first = rule(/^https:\/\/project\.supabase\.co\//, 'NetworkOnly')
      const second = rule(/^https:\/\/project\.supabase\.co\/rest\//, 'NetworkFirst')
      expect(resolveWorkboxRoute([first, second], `${PROJECT}/rest/v1/sets`)).toBe(first)
      expect(resolveWorkboxRoute([second, first], `${PROJECT}/rest/v1/sets`)).toBe(second)
    })

    it('only offers a rule the method it was registered for (GET by default)', () => {
      const any = rule(/^https:\/\/project\.supabase\.co\//, 'NetworkFirst')
      expect(resolveWorkboxRoute([any], `${PROJECT}/rest/v1/sets`, 'POST')).toBeUndefined()
      expect(resolveWorkboxRoute([any], `${PROJECT}/rest/v1/sets`, 'HEAD')).toBeUndefined()
    })

    it('matches a cross-origin URL only when the pattern matches at index 0', () => {
      // Workbox ignores a mid-URL match on another origin, so an unanchored
      // pattern silently never sees a Supabase request at all.
      const unanchored = rule(/supabase\.co\/rest\//, 'NetworkFirst')
      expect(resolveWorkboxRoute([unanchored], `${PROJECT}/rest/v1/sets`)).toBeUndefined()
    })

    it('throws on a pattern it cannot evaluate instead of reporting no match', () => {
      expect(() => resolveWorkboxRoute([{ urlPattern: 'supabase', handler: 'NetworkFirst' }], `${PROJECT}/rest/v1/sets`))
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
