/// <reference types="node" />
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { SUPABASE_RUNTIME_CACHES, purgeSupabaseRuntimeCaches } from '../swCaches'

/**
 * Regression tests for the Supabase runtime cache cleanup (LIFT-704).
 *
 * The list of cache names lives in `swCaches.ts` but must stay in lockstep with
 * the `cacheName` values declared in `vite.config.js` runtimeCaching. If the two
 * drift, sign-out/account-deletion would leave personal data at rest in Cache
 * Storage. These tests pin the single source of truth and the purge behavior.
 */

const viteConfig = readFileSync(resolve(__dirname, '../../../vite.config.js'), 'utf-8')

describe('Supabase runtime cache name sync', () => {
  it('every purged cache name is actually defined in vite.config.js', () => {
    for (const name of SUPABASE_RUNTIME_CACHES) {
      expect(viteConfig).toContain(`cacheName: '${name}'`)
    }
  })

  it('does not include supabase-auth (NetworkOnly, never stores a response)', () => {
    expect(SUPABASE_RUNTIME_CACHES as readonly string[]).not.toContain('supabase-auth')
  })

  it('covers every personal-data supabase cache declared in the config', () => {
    // Find each `cacheName: 'supabase-*'` in the config and ensure the purge
    // list accounts for it (except the auth cache, which holds nothing).
    const declared = [...viteConfig.matchAll(/cacheName: '(supabase-[\w-]+)'/g)].map((m) => m[1])
    const expected = declared.filter((name) => name !== 'supabase-auth')
    expect([...SUPABASE_RUNTIME_CACHES].sort()).toEqual([...new Set(expected)].sort())
  })
})

describe('purgeSupabaseRuntimeCaches', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('deletes only the supabase runtime caches, leaving unrelated caches intact', async () => {
    const deleted: string[] = []
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue([
        'supabase-sets',
        'supabase-exercises',
        'supabase-bodyweight',
        'supabase-progression',
        'supabase-api',
        'workbox-precache-v2-https://example.com/',
        'unrelated-cache',
      ]),
      delete: vi.fn((name: string) => {
        deleted.push(name)
        return Promise.resolve(true)
      }),
    })

    await purgeSupabaseRuntimeCaches()

    expect(deleted.sort()).toEqual([...SUPABASE_RUNTIME_CACHES].sort())
    expect(deleted).not.toContain('workbox-precache-v2-https://example.com/')
    expect(deleted).not.toContain('unrelated-cache')
  })

  it('is a no-op when the Cache Storage API is unavailable (WKWebView/SSR/test)', async () => {
    vi.stubGlobal('caches', undefined)
    await expect(purgeSupabaseRuntimeCaches()).resolves.toBeUndefined()
  })

  it('swallows errors so it never blocks sign-out', async () => {
    vi.stubGlobal('caches', {
      keys: vi.fn().mockRejectedValue(new Error('SecurityError: storage disabled')),
      delete: vi.fn(),
    })
    await expect(purgeSupabaseRuntimeCaches()).resolves.toBeUndefined()
  })
})
