/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Regression tests for LIFT-855: XP and theme-unlock progress bars must expose
 * their value to screen readers via role="progressbar" + aria-value* attributes.
 *
 * These are source-level assertions (like metaRegression/cssRegression) because
 * the XP toast lives in App.vue (impractical to mount) and the markup is what
 * regresses — a future edit dropping the role/value attributes would silently
 * make the bars opaque to assistive tech again.
 */

const appSrc = readFileSync(resolve(__dirname, '../../App.vue'), 'utf-8')
const settingsSrc = readFileSync(resolve(__dirname, '../SettingsSheet.vue'), 'utf-8')
const starterSrc = readFileSync(resolve(__dirname, '../StarterPickerFlow.vue'), 'utf-8')

/** Extract the opening tag (`<div ... >`) of the element carrying `className`. */
function openingTagFor(source: string, className: string): string {
  const classIdx = source.indexOf(`class="${className}"`)
  expect(classIdx, `class="${className}" should exist in source`).toBeGreaterThan(-1)
  const tagStart = source.lastIndexOf('<', classIdx)
  const tagEnd = source.indexOf('>', classIdx)
  return source.slice(tagStart, tagEnd + 1)
}

describe('Progress bar accessibility (LIFT-855)', () => {
  describe('XP toast progress bar (App.vue)', () => {
    const tag = openingTagFor(appSrc, 'xpToastProgress')

    it('declares role="progressbar"', () => {
      expect(tag).toContain('role="progressbar"')
    })

    it('has an aria-label', () => {
      expect(tag).toMatch(/aria-label="[^"]+"/)
    })

    it('pins aria-valuemin=0 and aria-valuemax=100', () => {
      expect(tag).toContain('aria-valuemin="0"')
      expect(tag).toContain('aria-valuemax="100"')
    })

    it('binds aria-valuenow to the live progress percent', () => {
      expect(tag).toContain(':aria-valuenow="xpToast.progressPercent"')
    })

    it('exposes a human-readable aria-valuetext with the XP totals', () => {
      expect(tag).toMatch(/:aria-valuetext=/)
      expect(tag).toContain('xpToast.totalXP')
      expect(tag).toContain('xpToast.nextThresholdXP')
    })
  })

  describe('Theme-unlock progress bar (SettingsSheet.vue)', () => {
    const tag = openingTagFor(settingsSrc, 'badgeProgressBar')

    it('declares role="progressbar"', () => {
      expect(tag).toContain('role="progressbar"')
    })

    it('has an aria-label', () => {
      expect(tag).toMatch(/aria-label="[^"]+"/)
    })

    it('pins aria-valuemin=0 and aria-valuemax=100', () => {
      expect(tag).toContain('aria-valuemin="0"')
      expect(tag).toContain('aria-valuemax="100"')
    })

    it('binds aria-valuenow to the store progress percent', () => {
      expect(tag).toContain(':aria-valuenow="progressionStore.progressPercent"')
    })

    it('exposes a human-readable aria-valuetext with XP to next unlock', () => {
      expect(tag).toMatch(/:aria-valuetext=/)
      expect(tag).toContain('progressionStore.xpToNextUnlock')
    })
  })

  describe('Decorative starter-preview bar stays hidden', () => {
    it('spfProgressTrack remains aria-hidden (purely decorative, no value)', () => {
      const tag = openingTagFor(starterSrc, 'spfPreview')
      expect(tag).toContain('aria-hidden="true"')
    })
  })
})
