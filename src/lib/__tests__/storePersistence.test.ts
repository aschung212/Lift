import { describe, it, expect, vi, beforeEach } from 'vitest'
import { persistStoreData, loadStoreData } from '../storePersistence'
import { getLocalStorageMock } from '../../__tests__/helpers'

vi.mock('../durableStorage', () => ({ backupToIDB: vi.fn() }))
vi.mock('../crossTabSync', () => ({ broadcastStoreUpdate: vi.fn() }))
vi.mock('../logger', () => ({ logError: vi.fn(), logWarn: vi.fn() }))

const localStorageMock = getLocalStorageMock()

describe('persistStoreData', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('writes the payload to localStorage under the given key', () => {
    persistStoreData('bodyweight', 'bodyweight-entries', '[{"id":"1"}]')
    expect(localStorageMock.getItem('bodyweight-entries')).toBe('[{"id":"1"}]')
  })

  it('mirrors the payload to the IndexedDB backup', async () => {
    const { backupToIDB } = await import('../durableStorage')
    persistStoreData('workout', 'workout-exercises', '[]')
    expect(backupToIDB).toHaveBeenCalledWith('workout-exercises', '[]')
  })

  it('broadcasts a cross-tab update for the store', async () => {
    const { broadcastStoreUpdate } = await import('../crossTabSync')
    persistStoreData('preferences', 'user-preferences', '{}')
    expect(broadcastStoreUpdate).toHaveBeenCalledWith('preferences')
  })

  it('logs (does not throw) when localStorage rejects the write, and still backs up + broadcasts', async () => {
    const { logError } = await import('../logger')
    const { backupToIDB } = await import('../durableStorage')
    const { broadcastStoreUpdate } = await import('../crossTabSync')
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })

    expect(() => persistStoreData('progression', 'user-progression', 'x'.repeat(10))).not.toThrow()

    expect(logError).toHaveBeenCalledWith(
      expect.any(DOMException),
      expect.objectContaining({ source: 'progression._persist', size: 10 }),
    )
    // A transient localStorage failure must not silence the durable backup or other tabs.
    expect(backupToIDB).toHaveBeenCalledWith('user-progression', 'x'.repeat(10))
    expect(broadcastStoreUpdate).toHaveBeenCalledWith('progression')
  })
})

describe('loadStoreData', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('returns a freshly-invoked fallback when the key is absent (no warning)', async () => {
    const { logWarn } = await import('../logger')
    const result = loadStoreData('bodyweight', 'missing', () => [] as number[])
    expect(result).toEqual([])
    expect(logWarn).not.toHaveBeenCalled()
  })

  it('returns distinct fallback instances per call (safe to mutate)', () => {
    const a = loadStoreData('bodyweight', 'missing', () => [] as number[])
    const b = loadStoreData('bodyweight', 'missing', () => [] as number[])
    expect(a).not.toBe(b)
  })

  it('parses and returns valid stored data', () => {
    localStorageMock.setItem('bodyweight-entries', '[{"id":"1","weight":80}]')
    const result = loadStoreData<{ id: string; weight: number }[]>(
      'bodyweight',
      'bodyweight-entries',
      () => [],
      Array.isArray,
    )
    expect(result).toEqual([{ id: '1', weight: 80 }])
  })

  it('warns and falls back when the payload is unparseable', async () => {
    const { logWarn } = await import('../logger')
    localStorageMock.setItem('workout-exercises', 'not-json{')
    const result = loadStoreData<number[]>('workout', 'workout-exercises', () => [], Array.isArray)
    expect(result).toEqual([])
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('Corrupt workout data'),
      expect.objectContaining({ error: expect.any(String) }),
    )
  })

  it('warns and falls back when the parsed shape fails validation', async () => {
    const { logWarn } = await import('../logger')
    localStorageMock.setItem('workout-exercises', '{"not":"an array"}')
    const result = loadStoreData<number[]>('workout', 'workout-exercises', () => [], Array.isArray)
    expect(result).toEqual([])
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('Corrupt workout data'),
      expect.objectContaining({ reason: 'failed validation' }),
    )
  })

  it('returns parsed data as-is when no validator is supplied', () => {
    localStorageMock.setItem('user-progression', '{"totalXP":42}')
    const result = loadStoreData<{ totalXP: number }>(
      'progression',
      'user-progression',
      () => ({ totalXP: 0 }),
    )
    expect(result).toEqual({ totalXP: 42 })
  })
})
