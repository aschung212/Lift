/// <reference types="node" />
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { generateSW } from 'workbox-build'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { workboxOptions } from '../../../vite-plugin-pwa-config'

/**
 * Behavioral build-output test for the service worker.
 *
 * `workboxCacheRegression.test.ts` asserts the *shape* of the config object;
 * this test asserts the config actually produces a working service worker. It
 * runs the same `workbox-build` `generateSW` step VitePWA runs at build time —
 * feeding it the real, shared `workboxOptions` — and inspects the generated
 * `sw.js` source. This catches failures the config-shape tests can't:
 *   - a Workbox version bump that changes/breaks code generation,
 *   - a config field that is silently dropped or renamed by Workbox,
 *   - a navigation fallback that never registers a NavigationRoute,
 *   - a runtime cache whose route is never actually registered.
 *
 * We assert on substrings that survive minification (string-literal cache names
 * and the un-mangled Workbox API property names), so the test is robust to
 * production vs development output and to formatting changes.
 */

let sw = ''

beforeAll(async () => {
  // A minimal glob directory: generateSW precaches whatever it globs here.
  // index.html must exist so `navigateFallback: 'index.html'` resolves to a
  // real precache entry (Workbox otherwise warns/omits the fallback).
  const dir = mkdtempSync(join(tmpdir(), 'lift-sw-'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Lift</title>')
  const swDest = join(dir, 'sw.js')

  try {
    await generateSW({
      ...workboxOptions,
      globDirectory: dir,
      swDest,
      // Mirror the real production build so we verify the artifact that ships,
      // not a dev-mode variant.
      mode: 'production',
    })
    sw = readFileSync(swDest, 'utf-8')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 60000)

describe('generated service worker (workbox-build output)', () => {
  it('emits a non-empty service worker', () => {
    expect(sw.length).toBeGreaterThan(0)
  })

  describe('runtime cache routes are registered', () => {
    it('registers routes for every configured cache', () => {
      for (const name of [
        'supabase-sets',
        'supabase-exercises',
        'supabase-bodyweight',
        'supabase-progression',
        'supabase-api',
        'supabase-auth',
      ]) {
        expect(sw).toContain(name)
      }
    })

    it('uses StaleWhileRevalidate for the sets cache', () => {
      expect(sw).toContain('StaleWhileRevalidate')
    })

    it('uses NetworkFirst for the exercises/api caches', () => {
      expect(sw).toContain('NetworkFirst')
    })

    it('keeps auth as NetworkOnly (tokens never cached)', () => {
      expect(sw).toContain('NetworkOnly')
    })

    it('actually calls registerRoute to wire the caches up', () => {
      expect(sw).toContain('registerRoute')
    })
  })

  describe('navigation fallback', () => {
    it('registers a NavigationRoute bound to index.html', () => {
      expect(sw).toContain('NavigationRoute')
      expect(sw).toContain('createHandlerBoundToURL')
      expect(sw).toContain('index.html')
    })

    it('carries the /api denylist so it does not intercept those paths', () => {
      expect(sw).toContain('/^\\/api\\//')
    })
  })

  describe('precache', () => {
    it('precaches index.html so the SPA shell loads offline', () => {
      expect(sw).toContain('precacheAndRoute')
      expect(sw).toContain('index.html')
    })
  })
})
