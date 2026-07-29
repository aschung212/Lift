/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Regression tests for Workbox runtime cache configuration.
 *
 * Validates that endpoint-specific caches are defined with appropriate
 * strategies and capacities. Prevents regression to a single catch-all
 * cache that would evict entries for power users with large datasets.
 */

const viteConfig = readFileSync(resolve(__dirname, '../../../vite.config.js'), 'utf-8')

describe('Workbox runtime cache configuration', () => {
  describe('endpoint-specific caches exist', () => {
    it('has a dedicated sets cache with StaleWhileRevalidate strategy', () => {
      expect(viteConfig).toContain("cacheName: 'supabase-sets'")
      // StaleWhileRevalidate: fast offline load + background refresh for new sets
      const setsSection = viteConfig.slice(
        viteConfig.indexOf("cacheName: 'supabase-sets'") - 200,
        viteConfig.indexOf("cacheName: 'supabase-sets'") + 100
      )
      expect(setsSection).toContain("handler: 'StaleWhileRevalidate'")
    })

    it('has a dedicated exercises cache with NetworkFirst strategy', () => {
      expect(viteConfig).toContain("cacheName: 'supabase-exercises'")
      const exercisesSection = viteConfig.slice(
        viteConfig.indexOf("cacheName: 'supabase-exercises'") - 200,
        viteConfig.indexOf("cacheName: 'supabase-exercises'") + 100
      )
      expect(exercisesSection).toContain("handler: 'NetworkFirst'")
    })

    it('has a dedicated bodyweight cache', () => {
      expect(viteConfig).toContain("cacheName: 'supabase-bodyweight'")
    })

    it('has a dedicated progression cache', () => {
      expect(viteConfig).toContain("cacheName: 'supabase-progression'")
    })

    it('has a catch-all supabase-api cache for unknown endpoints', () => {
      expect(viteConfig).toContain("cacheName: 'supabase-api'")
    })

    it('keeps auth as NetworkOnly (never cache tokens)', () => {
      expect(viteConfig).toContain("cacheName: 'supabase-auth'")
      const authSection = viteConfig.slice(
        viteConfig.indexOf("cacheName: 'supabase-auth'") - 200,
        viteConfig.indexOf("cacheName: 'supabase-auth'") + 100
      )
      expect(authSection).toContain("handler: 'NetworkOnly'")
    })
  })

  describe('cache capacities are tuned for power users', () => {
    it('sets cache allows 500 entries (100+ exercises × multiple pages)', () => {
      const setsSection = viteConfig.slice(
        viteConfig.indexOf("cacheName: 'supabase-sets'"),
        viteConfig.indexOf("cacheName: 'supabase-sets'") + 300
      )
      expect(setsSection).toContain('maxEntries: 500')
    })

    it('exercises cache allows 200 entries', () => {
      const exercisesSection = viteConfig.slice(
        viteConfig.indexOf("cacheName: 'supabase-exercises'"),
        viteConfig.indexOf("cacheName: 'supabase-exercises'") + 300
      )
      expect(exercisesSection).toContain('maxEntries: 200')
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

  describe('cache ordering is specific-first', () => {
    it('specific endpoint caches appear before the catch-all', () => {
      const setsPos = viteConfig.indexOf("cacheName: 'supabase-sets'")
      const exercisesPos = viteConfig.indexOf("cacheName: 'supabase-exercises'")
      const catchAllPos = viteConfig.indexOf("cacheName: 'supabase-api'")
      // Specific caches must come before catch-all so Workbox matches them first
      expect(setsPos).toBeLessThan(catchAllPos)
      expect(exercisesPos).toBeLessThan(catchAllPos)
    })
  })
})
