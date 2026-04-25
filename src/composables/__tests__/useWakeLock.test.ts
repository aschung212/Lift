import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'

// Re-import fresh module state for each test
let useWakeLock: typeof import('../useWakeLock').useWakeLock
let isWakeLockSupported: typeof import('../useWakeLock').isWakeLockSupported

// Mock WakeLockSentinel
function createMockSentinel() {
  const listeners: Record<string, Array<() => void>> = {}
  return {
    released: false,
    addEventListener: vi.fn((event: string, cb: () => void) => {
      listeners[event] = listeners[event] || []
      listeners[event].push(cb)
    }),
    release: vi.fn(async function (this: { released: boolean }) {
      this.released = true
      listeners['release']?.forEach(cb => cb())
    }),
    _listeners: listeners,
  }
}

describe('isWakeLockSupported', () => {
  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../useWakeLock')
    isWakeLockSupported = mod.isWakeLockSupported
  })

  afterEach(() => {
    // @ts-expect-error — cleanup
    delete navigator.wakeLock
  })

  it('returns true when navigator.wakeLock exists', () => {
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: vi.fn() },
      configurable: true,
    })
    expect(isWakeLockSupported()).toBe(true)
  })

  it('returns false when navigator.wakeLock is absent', () => {
    expect(isWakeLockSupported()).toBe(false)
  })
})

describe('useWakeLock', () => {
  let mockSentinel: ReturnType<typeof createMockSentinel>

  beforeEach(async () => {
    vi.resetModules()
    mockSentinel = createMockSentinel()
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: vi.fn().mockResolvedValue(mockSentinel) },
      configurable: true,
    })
    const mod = await import('../useWakeLock')
    useWakeLock = mod.useWakeLock
  })

  afterEach(() => {
    // @ts-expect-error — cleanup
    delete navigator.wakeLock
  })

  it('acquires wake lock when shouldLock becomes true', async () => {
    const shouldLock = ref(false)
    const enabled = ref(true)
    useWakeLock(shouldLock, enabled)

    shouldLock.value = true
    await nextTick()
    await vi.waitFor(() => {
      expect(navigator.wakeLock.request).toHaveBeenCalledWith('screen')
    })
  })

  it('does not acquire when enabled is false', async () => {
    const shouldLock = ref(true)
    const enabled = ref(false)
    useWakeLock(shouldLock, enabled)
    await nextTick()
    await new Promise(r => setTimeout(r, 10))

    expect(navigator.wakeLock.request).not.toHaveBeenCalled()
  })

  it('releases wake lock when shouldLock becomes false', async () => {
    const shouldLock = ref(true)
    const enabled = ref(true)
    useWakeLock(shouldLock, enabled)
    await nextTick()
    await vi.waitFor(() => {
      expect(navigator.wakeLock.request).toHaveBeenCalled()
    })

    shouldLock.value = false
    await nextTick()
    await vi.waitFor(() => {
      expect(mockSentinel.release).toHaveBeenCalled()
    })
  })

  it('releases wake lock when enabled becomes false', async () => {
    const shouldLock = ref(true)
    const enabled = ref(true)
    useWakeLock(shouldLock, enabled)
    await nextTick()
    await vi.waitFor(() => {
      expect(navigator.wakeLock.request).toHaveBeenCalled()
    })

    enabled.value = false
    await nextTick()
    await vi.waitFor(() => {
      expect(mockSentinel.release).toHaveBeenCalled()
    })
  })

  it('exposes wakeLockActive as reactive state', async () => {
    const shouldLock = ref(true)
    const enabled = ref(true)
    const { wakeLockActive } = useWakeLock(shouldLock, enabled)
    await nextTick()
    await vi.waitFor(() => {
      expect(wakeLockActive.value).toBe(true)
    })
  })

  it('handles request failure gracefully', async () => {
    ;(navigator.wakeLock.request as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Not allowed'))
    const shouldLock = ref(true)
    const enabled = ref(true)
    const { wakeLockActive } = useWakeLock(shouldLock, enabled)
    await nextTick()
    await new Promise(r => setTimeout(r, 20))
    expect(wakeLockActive.value).toBe(false)
  })
})
