/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

/**
 * Regression tests for the offline fallback page.
 *
 * Validates that public/offline.html exists, contains required elements,
 * and follows the project's design standards (safe-area-insets, touch targets,
 * no hardcoded URLs, accessible markup).
 */

const offlinePath = resolve(__dirname, '../../../public/offline.html')
const offlineHtml = existsSync(offlinePath)
  ? readFileSync(offlinePath, 'utf-8')
  : ''

describe('offline fallback page', () => {
  it('offline.html exists in public/', () => {
    expect(existsSync(offlinePath)).toBe(true)
  })

  it('has a valid HTML document structure', () => {
    expect(offlineHtml).toContain('<!DOCTYPE html>')
    expect(offlineHtml).toContain('<html lang="en"')
    expect(offlineHtml).toContain('</html>')
  })

  it('includes viewport meta tag with viewport-fit=cover', () => {
    expect(offlineHtml).toContain('viewport-fit=cover')
  })

  it('uses safe-area-inset for notch/home indicator spacing', () => {
    expect(offlineHtml).toContain('safe-area-inset')
  })

  it('has a visible offline message', () => {
    expect(offlineHtml).toMatch(/you.re offline/i)
  })

  it('has a retry button', () => {
    expect(offlineHtml).toContain('retry')
    expect(offlineHtml).toContain('location.reload()')
  })

  it('reassures user about local data', () => {
    expect(offlineHtml).toMatch(/data.*saved.*locally|saved locally/i)
  })

  it('includes the Lift wordmark', () => {
    expect(offlineHtml).toContain('Lift')
  })

  it('has minimum 48px touch target for retry button', () => {
    expect(offlineHtml).toContain('min-height: 48px')
  })

  it('does not contain any external URLs (no fabricated domains)', () => {
    // The offline page must be fully self-contained with no external requests
    const externalUrls = offlineHtml.match(/https?:\/\/[^\s"'<>]+/g) || []
    expect(externalUrls).toEqual([])
  })

  it('supports light mode via prefers-color-scheme', () => {
    expect(offlineHtml).toContain('prefers-color-scheme: light')
  })
})
