/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { workboxOptions } from '../../../vite-plugin-pwa-config'

/**
 * Regression tests for PWA manifest configuration.
 *
 * Validates that the vite.config.js manifest includes required fields
 * for a richer PWA install experience (screenshots, categories) and
 * that referenced screenshot assets exist in public/.
 *
 * Manifest fields live inline in vite.config.js (asserted via source text);
 * the Workbox service-worker config lives in ../../../vite-plugin-pwa-config.ts
 * and is asserted against the exported object.
 */

const viteConfig = readFileSync(resolve(__dirname, '../../../vite.config.js'), 'utf-8')
const publicDir = resolve(__dirname, '../../../public')

describe('PWA manifest regression tests', () => {
  describe('manifest includes explicit id for stable install identity', () => {
    it("has id set to '/' so start_url changes never orphan existing installs", () => {
      expect(viteConfig).toContain("id: '/'")
    })
  })

  describe('manifest includes categories for app store classification', () => {
    it('has categories array with health/fitness/sports', () => {
      expect(viteConfig).toContain("categories: ['health', 'fitness', 'sports']")
    })
  })

  describe('manifest description aligns with meta description and leads with differentiators', () => {
    const indexHtml = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8')

    it('uses the unified discoverability-focused description', () => {
      expect(viteConfig).toContain(
        "description: 'Free, offline-capable PWA workout tracker. Log sets, track estimated 1RM progress, visualize training history, and hit new PRs.'"
      )
    })

    it('no longer uses the generic keyword-poor description', () => {
      expect(viteConfig).not.toContain(
        'Track your sets, monitor progress, and hit personal records.'
      )
    })

    it('includes the high-value discoverability keywords surfaced in install UI', () => {
      const manifestDescMatch = viteConfig.match(/description: '([^']+)'/)
      expect(manifestDescMatch).not.toBeNull()
      const manifestDesc = (manifestDescMatch as RegExpMatchArray)[1]
      expect(manifestDesc).toContain('Free')
      expect(manifestDesc).toContain('offline')
      expect(manifestDesc).toContain('1RM')
      expect(manifestDesc).toContain('PWA')
    })

    it('shares the same value props as the index.html meta description', () => {
      // Both descriptions must lead with the free/offline/PWA/1RM differentiators
      // so the install prompt and search snippet tell a consistent story.
      const metaMatch = indexHtml.match(/<meta name="description" content="([^"]+)"/)
      expect(metaMatch).not.toBeNull()
      const metaDesc = (metaMatch as RegExpMatchArray)[1]
      for (const keyword of ['free', 'PWA', '1RM', 'offline']) {
        expect(metaDesc.toLowerCase()).toContain(keyword.toLowerCase())
      }
    })
  })

  describe('manifest includes display_override for fallback chain', () => {
    it('has display_override array with standalone and minimal-ui', () => {
      expect(viteConfig).toContain("display_override: ['standalone', 'minimal-ui']")
    })
  })

  describe('manifest includes shortcuts for quick actions', () => {
    it('has shortcuts array defined', () => {
      expect(viteConfig).toContain('shortcuts: [')
    })

    it('has a workout shortcut with ?tab=workouts URL', () => {
      expect(viteConfig).toContain("url: '/?tab=workouts'")
    })

    it('has a calendar shortcut with ?tab=calendar URL', () => {
      expect(viteConfig).toContain("url: '/?tab=calendar'")
    })

    it('has a weight shortcut with ?tab=weight URL', () => {
      expect(viteConfig).toContain("url: '/?tab=weight'")
    })

    it('shortcuts reference existing icon files', () => {
      // All shortcuts use icon-192.png
      expect(existsSync(resolve(publicDir, 'icon-192.png'))).toBe(true)
    })
  })

  describe('workbox includes navigateFallback for offline navigation', () => {
    it('has navigateFallback set to index.html', () => {
      expect(workboxOptions.navigateFallback).toBe('index.html')
    })

    it('has navigateFallbackDenylist to exclude API routes', () => {
      expect(Array.isArray(workboxOptions.navigateFallbackDenylist)).toBe(true)
      expect(workboxOptions.navigateFallbackDenylist.length).toBeGreaterThan(0)
    })

    it('offline.html exists in public/', () => {
      expect(existsSync(resolve(publicDir, 'offline.html'))).toBe(true)
    })
  })

  describe('workbox enables navigation preload for faster navigations', () => {
    it('has navigationPreload: true in workbox config', () => {
      expect(workboxOptions.navigationPreload).toBe(true)
    })
  })

  describe('manifest includes launch_handler for single-window behavior', () => {
    it('has launch_handler with navigate-existing client_mode', () => {
      expect(viteConfig).toContain("client_mode: 'navigate-existing'")
    })
  })

  describe('manifest includes screenshots for richer install UI', () => {
    it('has narrow (mobile) screenshot entries', () => {
      expect(viteConfig).toContain("form_factor: 'narrow'")
    })

    it('mobile screenshot file exists in public/', () => {
      expect(existsSync(resolve(publicDir, 'screenshot-mobile.png'))).toBe(true)
    })

    it('detail screenshot file exists in public/', () => {
      expect(existsSync(resolve(publicDir, 'screenshot-detail.png'))).toBe(true)
    })

    it('calendar screenshot file exists in public/', () => {
      expect(existsSync(resolve(publicDir, 'screenshot-calendar.png'))).toBe(true)
    })
  })

  describe('workbox globIgnores excludes non-essential large assets from precache', () => {
    it('excludes screenshot PNGs from precache', () => {
      expect(workboxOptions.globIgnores).toContain('screenshot-*.png')
    })

    it('excludes og-image.png from precache', () => {
      expect(workboxOptions.globIgnores).toContain('og-image.png')
    })

    it('excludes icon-source.png from precache', () => {
      expect(workboxOptions.globIgnores).toContain('icon-source.png')
    })

    it('excludes og-preview.html from precache', () => {
      expect(workboxOptions.globIgnores).toContain('og-preview.html')
    })

    it('has globIgnores array in workbox config', () => {
      expect(Array.isArray(workboxOptions.globIgnores)).toBe(true)
    })
  })
})
