import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Must mock before import so the module-level state resets properly.
// The composable uses a module-level sentinel, so we re-import per test
// via dynamic import + vi.resetModules().

function createMockSentinel() {
  const listeners: Record<string, (() => void)[]> = {}
  return {
    released: false,
    addEventListener(event: string, fn: () => void) {
      listeners[event] = listeners[event] || []
      listeners[event].push(fn)
    },
    release() {
      this.released = true
      // Fire 'release' listeners
      ;(listeners['release'] || []).forEach(fn => fn())
      return Promise.resolve()
    },
    _listeners: listeners,
  }
}

describe('useWakeLock', () => {
  let mockSentinel: ReturnType<typeof createMockSentinel>
  let requestMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    mockSentinel = createMockSentinel()
    requestMock = vi.fn().mockResolvedValue(mockSentinel)

    // Install the Wake Lock API on navigator
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: requestMock },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns expected API shape', async () => {
    const { useWakeLock } = await import('../useWakeLock')
    const wl = useWakeLock()
    expect(typeof wl.acquire).toBe('function')
    expect(typeof wl.release).toBe('function')
    expect(wl.isSupported).toBe(true)
    expect(wl.active.value).toBe(false)
  })

  it('acquire requests a screen wake lock', async () => {
    const { useWakeLock } = await import('../useWakeLock')
    const wl = useWakeLock()
    await wl.acquire()
    expect(requestMock).toHaveBeenCalledWith('screen')
    expect(wl.active.value).toBe(true)
  })

  it('does not re-acquire if already held', async () => {
    const { useWakeLock } = await import('../useWakeLock')
    const wl = useWakeLock()
    await wl.acquire()
    await wl.acquire()
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('release releases the sentinel', async () => {
    const { useWakeLock } = await import('../useWakeLock')
    const wl = useWakeLock()
    await wl.acquire()
    expect(wl.active.value).toBe(true)
    await wl.release()
    expect(mockSentinel.released).toBe(true)
    expect(wl.active.value).toBe(false)
  })

  it('release is safe to call when no lock is held', async () => {
    const { useWakeLock } = await import('../useWakeLock')
    const wl = useWakeLock()
    // Should not throw
    await expect(wl.release()).resolves.toBeUndefined()
  })

  it('sets active to false when the browser releases the lock (e.g. tab hidden)', async () => {
    const { useWakeLock } = await import('../useWakeLock')
    const wl = useWakeLock()
    await wl.acquire()
    expect(wl.active.value).toBe(true)
    // Simulate browser releasing the lock (e.g. page hidden)
    mockSentinel.release()
    expect(wl.active.value).toBe(false)
  })

  it('handles request failure gracefully', async () => {
    requestMock.mockRejectedValueOnce(new DOMException('Not allowed'))
    const { useWakeLock } = await import('../useWakeLock')
    const wl = useWakeLock()
    await expect(wl.acquire()).resolves.toBeUndefined()
    expect(wl.active.value).toBe(false)
  })
})

describe('useWakeLock without API support', () => {
  beforeEach(() => {
    vi.resetModules()
    // Remove the Wake Lock API — must delete before re-importing the module
    // so the module-level isSupported() call evaluates correctly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).wakeLock
  })

  it('reports isSupported as false', async () => {
    const { useWakeLock } = await import('../useWakeLock')
    const wl = useWakeLock()
    expect(wl.isSupported).toBe(false)
  })

  it('acquire is a no-op when unsupported', async () => {
    const { useWakeLock } = await import('../useWakeLock')
    const wl = useWakeLock()
    await expect(wl.acquire()).resolves.toBeUndefined()
    expect(wl.active.value).toBe(false)
  })
})
