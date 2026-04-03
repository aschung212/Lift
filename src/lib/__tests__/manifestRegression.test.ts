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
    it('has a narrow (mobile) screenshot entry', () => {
      expect(viteConfig).toContain("form_factor: 'narrow'")
    })

    it('has a wide (desktop) screenshot entry', () => {
      expect(viteConfig).toContain("form_factor: 'wide'")
    })

    it('mobile screenshot file exists in public/', () => {
      expect(existsSync(resolve(publicDir, 'screenshot-mobile.png'))).toBe(true)
    })

    it('desktop screenshot file exists in public/', () => {
      expect(existsSync(resolve(publicDir, 'screenshot-desktop.png'))).toBe(true)
    })
  })
})
