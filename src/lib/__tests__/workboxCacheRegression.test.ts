import { describe, it, expect } from 'vitest'
import {
  runtimeCaching,
  workboxOptions,
} from '../../../vite-plugin-pwa-config'

/**
 * Regression tests for Workbox runtime cache configuration.
 *
 * These assert against the exported config *object* (the single source of truth
 * that `vite.config.js` and the SW build both consume), not a string-slice of
 * the config file. They are the cheap first line: they prove the config is
 * shaped correctly. `swBuildOutput.test.ts` complements them by proving that
 * this config actually produces a working service worker.
 *
 * Purpose: prevent regression to a single catch-all cache that would evict
 * entries for power users with large datasets, and keep the endpoint-specific
 * strategies/capacities/ordering intact.
 */

/** Find the rule whose cacheName matches. */
const ruleFor = (cacheName: string) =>
  runtimeCaching.find((r) => r.options?.cacheName === cacheName)

describe('Workbox runtime cache configuration', () => {
  describe('endpoint-specific caches exist', () => {
    it('has a dedicated sets cache with StaleWhileRevalidate strategy', () => {
      const rule = ruleFor('supabase-sets')
      expect(rule).toBeDefined()
      // StaleWhileRevalidate: fast offline load + background refresh for new sets
      expect(rule?.handler).toBe('StaleWhileRevalidate')
    })

    it('has a dedicated exercises cache with NetworkFirst strategy', () => {
      const rule = ruleFor('supabase-exercises')
      expect(rule).toBeDefined()
      expect(rule?.handler).toBe('NetworkFirst')
    })

    it('has a dedicated bodyweight cache', () => {
      expect(ruleFor('supabase-bodyweight')).toBeDefined()
    })

    it('has a dedicated progression cache', () => {
      expect(ruleFor('supabase-progression')).toBeDefined()
    })

    it('has a catch-all supabase-api cache for unknown endpoints', () => {
      expect(ruleFor('supabase-api')).toBeDefined()
    })

    it('keeps auth as NetworkOnly (never cache tokens)', () => {
      const rule = ruleFor('supabase-auth')
      expect(rule).toBeDefined()
      expect(rule?.handler).toBe('NetworkOnly')
    })
  })

  describe('cache capacities are tuned for power users', () => {
    it('sets cache allows 500 entries (100+ exercises × multiple pages)', () => {
      expect(ruleFor('supabase-sets')?.options?.expiration?.maxEntries).toBe(500)
    })

    it('exercises cache allows 200 entries', () => {
      expect(ruleFor('supabase-exercises')?.options?.expiration?.maxEntries).toBe(
        200
      )
    })
  })

  describe('cache ordering is specific-first', () => {
    it('specific endpoint caches appear before the catch-all', () => {
      const names = runtimeCaching.map((r) => r.options?.cacheName)
      const setsPos = names.indexOf('supabase-sets')
      const exercisesPos = names.indexOf('supabase-exercises')
      const catchAllPos = names.indexOf('supabase-api')
      // Specific caches must come before catch-all so Workbox matches them first
      expect(setsPos).toBeGreaterThanOrEqual(0)
      expect(exercisesPos).toBeGreaterThanOrEqual(0)
      expect(setsPos).toBeLessThan(catchAllPos)
      expect(exercisesPos).toBeLessThan(catchAllPos)
    })
  })

  describe('navigation fallback', () => {
    it('serves index.html for navigations (SPA fallback)', () => {
      expect(workboxOptions.navigateFallback).toBe('index.html')
    })
  })
})
