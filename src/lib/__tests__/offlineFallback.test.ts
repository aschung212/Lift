/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

/**
 * Regression tests for the offline fallback page and service worker config.
 *
 * Validates that:
 * - public/offline.html exists and is self-contained (no external deps)
 * - The service worker source uses injectManifest with a catch handler
 * - The VitePWA config includes offline.html in includeAssets
 */

const publicDir = resolve(__dirname, '../../../public')
const offlinePath = resolve(publicDir, 'offline.html')
const swPath = resolve(__dirname, '../../sw.ts')
const viteConfigPath = resolve(__dirname, '../../../vite.config.js')

describe('Offline fallback page', () => {
  it('offline.html exists in public/', () => {
    expect(existsSync(offlinePath)).toBe(true)
  })

  it('is self-contained with no external stylesheet links', () => {
    const html = readFileSync(offlinePath, 'utf-8')
    // No external CSS — all styles must be inline
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["']/)
  })

  it('is self-contained with no external script tags', () => {
    const html = readFileSync(offlinePath, 'utf-8')
    // No external scripts — inline only (onclick is fine)
    expect(html).not.toMatch(/<script[^>]+src=/)
  })

  it('has a retry button that reloads the page', () => {
    const html = readFileSync(offlinePath, 'utf-8')
    expect(html).toContain('window.location.reload()')
  })

  it('includes the Lift branding', () => {
    const html = readFileSync(offlinePath, 'utf-8')
    expect(html).toContain('Lift')
    expect(html).toContain('offline')
  })

  it('uses safe-area-insets for iOS compatibility', () => {
    const html = readFileSync(offlinePath, 'utf-8')
    expect(html).toContain('safe-area-inset')
  })

  it('has a proper viewport meta tag', () => {
    const html = readFileSync(offlinePath, 'utf-8')
    expect(html).toContain('viewport-fit=cover')
  })

  it('does not reference the deployment domain (no URLs to fabricate)', () => {
    const html = readFileSync(offlinePath, 'utf-8')
    // Self-contained page should not reference any external domains
    expect(html).not.toContain('vercel.app')
    expect(html).not.toContain('supabase')
    expect(html).not.toContain('http')
  })
})

describe('Service worker offline fallback integration', () => {
  const swSource = readFileSync(swPath, 'utf-8')
  const viteConfig = readFileSync(viteConfigPath, 'utf-8')

  it('SW uses injectManifest strategy', () => {
    expect(viteConfig).toContain("strategies: 'injectManifest'")
  })

  it('SW source uses setCatchHandler for offline fallback', () => {
    expect(swSource).toContain('setCatchHandler')
  })

  it('SW catch handler serves offline.html for document requests via matchPrecache', () => {
    expect(swSource).toContain("request.destination === 'document'")
    expect(swSource).toContain("matchPrecache('/offline.html')")
  })

  it('SW includes NavigationRoute for SPA routing', () => {
    expect(swSource).toContain('NavigationRoute')
    expect(swSource).toContain("createHandlerBoundToURL('/index.html')")
  })

  it('offline.html is listed in VitePWA includeAssets', () => {
    expect(viteConfig).toContain('offline.html')
  })

  it('SW includes precacheAndRoute for asset caching', () => {
    expect(swSource).toContain('precacheAndRoute')
    expect(swSource).toContain('self.__WB_MANIFEST')
  })

  it('SW includes Supabase runtime caching routes', () => {
    expect(swSource).toContain('supabase-api')
    expect(swSource).toContain('supabase-auth')
    expect(swSource).toContain('NetworkFirst')
    expect(swSource).toContain('NetworkOnly')
  })
})
