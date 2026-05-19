import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'

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
    await flushPromises()

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
    await flushPromises()
    expect(wakeLockActive.value).toBe(false)
  })

  it('releases the just-acquired sentinel if shouldLock toggles off mid-request', async () => {
    // Hold the request open so we can flip shouldLock before it resolves.
    let resolveRequest!: (s: ReturnType<typeof createMockSentinel>) => void
    const lateSentinel = createMockSentinel()
    ;(navigator.wakeLock.request as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise(r => {
          resolveRequest = r
        }),
    )

    const shouldLock = ref(false)
    const enabled = ref(true)
    const { wakeLockActive } = useWakeLock(shouldLock, enabled)

    // 1. Toggle on — request is now pending.
    shouldLock.value = true
    await nextTick()
    expect(navigator.wakeLock.request).toHaveBeenCalledTimes(1)

    // 2. Toggle off before the request resolves. Pre-fix, releaseLock
    //    would no-op because sentinel is still null, leaving the
    //    in-flight request unsupervised.
    shouldLock.value = false
    await nextTick()

    // 3. Resolve the request. The cancellation signal threaded through
    //    acquireLock should release the sentinel rather than orphan it.
    resolveRequest(lateSentinel)

    await vi.waitFor(() => {
      expect(lateSentinel.release).toHaveBeenCalled()
    })
    expect(wakeLockActive.value).toBe(false)
  })

  it('does not issue a concurrent request on rapid true→false→true toggle', async () => {
    // First request stays pending across the whole toggle dance; the
    // second request resolves immediately so we can observe both.
    let resolveFirst!: (s: ReturnType<typeof createMockSentinel>) => void
    const firstSentinel = createMockSentinel()
    const secondSentinel = createMockSentinel()
    ;(navigator.wakeLock.request as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(
        () =>
          new Promise(r => {
            resolveFirst = r
          }),
      )
      .mockResolvedValueOnce(secondSentinel)

    const shouldLock = ref(false)
    const enabled = ref(true)
    useWakeLock(shouldLock, enabled)

    shouldLock.value = true
    await nextTick()
    shouldLock.value = false
    await nextTick()
    shouldLock.value = true
    await nextTick()

    // Only the first request has been issued; the third toggle waits for
    // the in-flight acquire to settle rather than firing a duplicate.
    expect(navigator.wakeLock.request).toHaveBeenCalledTimes(1)

    resolveFirst(firstSentinel)

    // The first sentinel is released (orphan prevention), then the
    // second request fires for the still-active toggle.
    await vi.waitFor(() => {
      expect(firstSentinel.release).toHaveBeenCalled()
      expect(navigator.wakeLock.request).toHaveBeenCalledTimes(2)
    })
    expect(secondSentinel.release).not.toHaveBeenCalled()
  })
})
