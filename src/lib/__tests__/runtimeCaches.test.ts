import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  clearRuntimeCaches,
  RUNTIME_CACHE_PREFIX,
  RUNTIME_CACHE_NAMES,
} from '../runtimeCaches'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('clearRuntimeCaches', () => {
  it('deletes every supabase-* cache and leaves foreign caches untouched', async () => {
    const present = [
      'supabase-sets',
      'supabase-exercises',
      'workbox-precache-v2',
      'some-other-cache',
    ]
    const deleted: string[] = []
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue(present),
      delete: vi.fn((name: string) => {
        deleted.push(name)
        return Promise.resolve(true)
      }),
    })

    await clearRuntimeCaches()

    expect(deleted).toEqual(['supabase-sets', 'supabase-exercises'])
  })

  it('purges a newly-added supabase-* cache via the prefix (drift-proof)', async () => {
    const deleted: string[] = []
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue(['supabase-brand-new-cache']),
      delete: vi.fn((name: string) => {
        deleted.push(name)
        return Promise.resolve(true)
      }),
    })

    await clearRuntimeCaches()

    expect(deleted).toEqual(['supabase-brand-new-cache'])
  })

  it('no-ops safely when Cache Storage is unavailable (native/SSR)', async () => {
    vi.stubGlobal('caches', undefined)
    await expect(clearRuntimeCaches()).resolves.toBeUndefined()
  })

  it('never throws when caches.keys() rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('caches', {
      keys: vi.fn().mockRejectedValue(new Error('CacheStorage failure')),
      delete: vi.fn(),
    })

    await expect(clearRuntimeCaches()).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('every known runtime cache name matches the deletion prefix', () => {
    for (const name of RUNTIME_CACHE_NAMES) {
      expect(name.startsWith(RUNTIME_CACHE_PREFIX)).toBe(true)
    }
  })
})
