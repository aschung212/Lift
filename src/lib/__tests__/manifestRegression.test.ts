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

  describe('service worker uses prompt mode (not silent auto-update)', () => {
    it('registerType is prompt, not autoUpdate', () => {
      expect(viteConfig).toContain("registerType: 'prompt'")
      expect(viteConfig).not.toContain("registerType: 'autoUpdate'")
    })

    it('does not use skipWaiting (user controls update timing)', () => {
      expect(viteConfig).not.toMatch(/skipWaiting:\s*true/)
    })
  })
})
