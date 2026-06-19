/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Regression tests for the offline-navigation CONTRACT (LIFT-703).
 *
 * Lift is a local-first SPA: Pinia + localStorage are the source of truth, so
 * the precached `index.html` shell boots and runs the full app with no network.
 * That shell — wired via Workbox `navigateFallback: 'index.html'` — IS the
 * offline experience.
 *
 * The repo still contains two orphaned fossils of an abandoned offline-page
 * attempt: `public/offline.html` (never served, because navigateFallback points
 * at index.html) and `public/sw-offline-handler.js` (a 0-byte file imported
 * nowhere). Their source deletion is pending (LIFT-703); until then they are
 * excluded from the Workbox precache so they ship no dead bytes to installs.
 *
 * These tests pin the ACTUAL behavior — which document the service worker serves
 * offline, and that the dead files stay out of the precache — rather than the
 * previous suite which only asserted that offline.html existed on disk (false
 * confidence in a feature that was never wired up).
 */

const viteConfigPath = resolve(__dirname, '../../../vite.config.js')
const viteConfig = readFileSync(viteConfigPath, 'utf-8')

describe('offline navigation contract', () => {
  it('serves the precached index.html shell as the navigation fallback', () => {
    // The local-first SPA shell is the real offline experience, not a static
    // "you're offline" dead-end page.
    expect(viteConfig).toContain("navigateFallback: 'index.html'")
  })

  it('keeps API routes out of the navigation fallback', () => {
    expect(viteConfig).toContain('navigateFallbackDenylist:')
  })

  it('excludes the orphaned offline.html from the precache manifest', () => {
    // offline.html is never served (navigateFallback is index.html); excluding
    // it keeps its dead bytes out of every install.
    expect(viteConfig).toContain("'offline.html'")
  })

  it('excludes the empty sw-offline-handler.js from the precache manifest', () => {
    expect(viteConfig).toContain("'sw-offline-handler.js'")
  })
})
