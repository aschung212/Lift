/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Regression tests for Workbox runtime cache configuration.
 *
 * Pins the local-first offline-read contract (LIFT-705): the Pinia + localStorage
 * store is the SINGLE source of truth for offline reads. Authenticated Supabase
 * REST GETs are therefore NOT cached by the service worker — caching them would
 * create a second offline-read layer that duplicates the store with different
 * freshness/eviction rules and can hand a stale snapshot into the store's
 * last-write-wins merge.
 *
 * These tests fail if a future change reintroduces a read-through cache
 * (StaleWhileRevalidate / NetworkFirst / CacheFirst) over authenticated Supabase
 * REST endpoints, silently resurrecting the dual-source-of-truth problem.
 */

const viteConfig = readFileSync(resolve(__dirname, '../../../vite.config.js'), 'utf-8')

// Extract just the runtimeCaching array so assertions can't be fooled by the
// surrounding manifest/comments.
function runtimeCachingBlock(): string {
  const start = viteConfig.indexOf('runtimeCaching:')
  expect(start).toBeGreaterThan(-1)
  // Grab a generous slice — the block is the last config inside workbox.
  return viteConfig.slice(start, viteConfig.indexOf('}),', start))
}

describe('Workbox runtime cache configuration', () => {
  describe('authenticated Supabase REST is the store, not the SW cache (LIFT-705)', () => {
    it('matches all Supabase REST endpoints', () => {
      expect(viteConfig).toMatch(/supabase\\\.co\\\/rest\\\/v1/)
    })

    it('serves Supabase REST with NetworkOnly (no read-through cache)', () => {
      const block = runtimeCachingBlock()
      const restIdx = block.indexOf('rest\\/v1')
      expect(restIdx).toBeGreaterThan(-1)
      // The handler for the REST rule must be NetworkOnly.
      const restRule = block.slice(restIdx, restIdx + 120)
      expect(restRule).toContain("handler: 'NetworkOnly'")
    })

    it('does NOT use any read-through caching strategy for REST data', () => {
      const block = runtimeCachingBlock()
      expect(block).not.toContain("handler: 'StaleWhileRevalidate'")
      expect(block).not.toContain("handler: 'NetworkFirst'")
      expect(block).not.toContain("handler: 'CacheFirst'")
    })

    it('defines no Supabase REST runtime caches to reconcile or purge', () => {
      const block = runtimeCachingBlock()
      // The old endpoint-specific caches duplicated the local-first store.
      expect(block).not.toContain("cacheName: 'supabase-sets'")
      expect(block).not.toContain("cacheName: 'supabase-exercises'")
      expect(block).not.toContain("cacheName: 'supabase-bodyweight'")
      expect(block).not.toContain("cacheName: 'supabase-progression'")
      expect(block).not.toContain("cacheName: 'supabase-api'")
    })

    it('does not retain opaque (status 0) responses for CORS requests', () => {
      const block = runtimeCachingBlock()
      // Supabase REST responses are CORS, never opaque — status 0 only widened
      // what got stored. With NetworkOnly there is no cacheableResponse at all.
      expect(block).not.toContain('statuses: [0, 200]')
    })
  })

  describe('auth tokens are never cached', () => {
    it('serves Supabase auth with NetworkOnly', () => {
      const block = runtimeCachingBlock()
      const authIdx = block.indexOf('auth\\/v1')
      expect(authIdx).toBeGreaterThan(-1)
      const authRule = block.slice(authIdx, authIdx + 120)
      expect(authRule).toContain("handler: 'NetworkOnly'")
    })
  })
})
