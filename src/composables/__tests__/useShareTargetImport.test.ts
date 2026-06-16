import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the shared importer so this suite focuses on the Share-Target plumbing
// (query-param detection, Cache API read/clear) without touching Pinia.
const importFromText = vi.fn()
vi.mock('../useCsvImport', () => ({
  useCsvImport: () => ({ importFromText }),
}))

import { useShareTargetImport } from '../useShareTargetImport'

const SHARE_INBOX_CACHE = 'lift-share-inbox'
const SHARE_INBOX_KEY = '/__shared-csv'

class FakeCache {
  store = new Map<string, Response>()
  async match(key: string): Promise<Response | undefined> {
    return this.store.get(key)
  }
  async put(key: string, res: Response): Promise<void> {
    this.store.set(key, res)
  }
  async delete(key: string): Promise<boolean> {
    return this.store.delete(key)
  }
}

let cacheMap: Map<string, FakeCache>

function setLocation(search: string): void {
  window.history.replaceState({}, '', '/' + search)
}

async function seedInbox(text: string): Promise<void> {
  const cache = cacheMap.get(SHARE_INBOX_CACHE) ?? new FakeCache()
  cacheMap.set(SHARE_INBOX_CACHE, cache)
  await cache.put(SHARE_INBOX_KEY, new Response(text, { headers: { 'Content-Type': 'text/csv' } }))
}

describe('useShareTargetImport', () => {
  beforeEach(() => {
    importFromText.mockReset()
    importFromText.mockReturnValue({ exercises: 2, sets: 5, format: 'strong' })
    setLocation('')
    cacheMap = new Map<string, FakeCache>()
    ;(globalThis as unknown as { caches: unknown }).caches = {
      open: vi.fn(async (name: string) => {
        if (!cacheMap.has(name)) cacheMap.set(name, new FakeCache())
        return cacheMap.get(name)!
      }),
    }
  })

  it('hasPendingShare detects the share-target query flag', () => {
    setLocation('?share-target=csv')
    expect(useShareTargetImport().hasPendingShare()).toBe(true)
  })

  it('hasPendingShare is false without the flag', () => {
    setLocation('?tab=calendar')
    expect(useShareTargetImport().hasPendingShare()).toBe(false)
  })

  it('returns null and does not import when there is no pending share', async () => {
    setLocation('')
    const summary = await useShareTargetImport().consumePendingShare()
    expect(summary).toBeNull()
    expect(importFromText).not.toHaveBeenCalled()
  })

  it('imports the cached CSV and tags the source as share_target', async () => {
    await seedInbox('Date,Exercise Name,Set Order,Weight,Reps\n2026-04-01,Bench,1,185,5')
    setLocation('?share-target=csv')

    const summary = await useShareTargetImport().consumePendingShare()

    expect(importFromText).toHaveBeenCalledTimes(1)
    expect(importFromText).toHaveBeenCalledWith(
      expect.stringContaining('Bench'),
      'share_target',
    )
    expect(summary).toEqual({ exercises: 2, sets: 5, format: 'strong' })
  })

  it('clears the cached inbox entry after consuming it', async () => {
    await seedInbox('some,csv')
    setLocation('?share-target=csv')

    await useShareTargetImport().consumePendingShare()

    const cache = cacheMap.get(SHARE_INBOX_CACHE)!
    expect(await cache.match(SHARE_INBOX_KEY)).toBeUndefined()
  })

  it('strips the share-target param so a reload cannot replay the import', async () => {
    await seedInbox('some,csv')
    setLocation('?share-target=csv')

    await useShareTargetImport().consumePendingShare()

    expect(window.location.search).toBe('')
  })

  it('preserves unrelated query params while stripping share-target', async () => {
    await seedInbox('some,csv')
    setLocation('?share-target=csv&tab=calendar')

    await useShareTargetImport().consumePendingShare()

    expect(window.location.search).toBe('?tab=calendar')
  })

  it('returns null when the flag is set but the inbox is empty', async () => {
    setLocation('?share-target=csv')
    const summary = await useShareTargetImport().consumePendingShare()
    expect(summary).toBeNull()
    expect(importFromText).not.toHaveBeenCalled()
  })

  it('ignores a blank/whitespace-only shared file', async () => {
    await seedInbox('   \n  ')
    setLocation('?share-target=csv')
    const summary = await useShareTargetImport().consumePendingShare()
    expect(summary).toBeNull()
    expect(importFromText).not.toHaveBeenCalled()
  })

  it('does not throw when the Cache API is unavailable', async () => {
    delete (globalThis as unknown as { caches?: unknown }).caches
    setLocation('?share-target=csv')
    await expect(useShareTargetImport().consumePendingShare()).resolves.toBeNull()
    // The param is still cleared so the app does not loop on it.
    expect(window.location.search).toBe('')
  })
})
