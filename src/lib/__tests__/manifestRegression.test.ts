/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

/**
 * Regression tests for PWA manifest configuration.
 *
 * Validates that the vite.config.js manifest includes required fields
 * for a richer PWA install experience (screenshots, categories) and
 * that referenced screenshot assets exist in public/.
 */

const viteConfig = readFileSync(resolve(__dirname, '../../../vite.config.js'), 'utf-8')
const publicDir = resolve(__dirname, '../../../public')

describe('PWA manifest regression tests', () => {
  describe('manifest includes categories for app store classification', () => {
    it('has categories array with health/fitness/sports', () => {
      expect(viteConfig).toContain("categories: ['health', 'fitness', 'sports']")
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
})
