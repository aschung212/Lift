import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope } from 'vue'

describe('useWakeLock', () => {
  let mockSentinel: { release: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn> }
  let requestMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockSentinel = {
      release: vi.fn(),
      addEventListener: vi.fn(),
    }
    requestMock = vi.fn().mockResolvedValue(mockSentinel)
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: requestMock },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  async function loadUseWakeLock() {
    // Re-import to reset module-level state
    const mod = await import('../useWakeLock')
    return mod.useWakeLock
  }

  it('acquire requests a screen wake lock', async () => {
    const useWakeLock = await loadUseWakeLock()
    const scope = effectScope()
    await scope.run(async () => {
      const { acquire } = useWakeLock()
      await acquire()
      expect(requestMock).toHaveBeenCalledWith('screen')
    })
    scope.stop()
  })

  it('release calls sentinel.release()', async () => {
    const useWakeLock = await loadUseWakeLock()
    const scope = effectScope()
    await scope.run(async () => {
      const { acquire, release } = useWakeLock()
      await acquire()
      release()
      expect(mockSentinel.release).toHaveBeenCalled()
    })
    scope.stop()
  })

  it('does not request twice when already acquired', async () => {
    const useWakeLock = await loadUseWakeLock()
    const scope = effectScope()
    await scope.run(async () => {
      const { acquire } = useWakeLock()
      await acquire()
      await acquire()
      // Only one actual request — the second is a no-op
      expect(requestMock).toHaveBeenCalledTimes(1)
    })
    scope.stop()
  })

  it('re-acquires on second acquire after release', async () => {
    const useWakeLock = await loadUseWakeLock()
    const scope = effectScope()
    await scope.run(async () => {
      const { acquire, release } = useWakeLock()
      await acquire()

      // Simulate the sentinel release callback
      const releaseHandler = mockSentinel.addEventListener.mock.calls.find(
        (c: unknown[]) => c[0] === 'release'
      )?.[1] as (() => void) | undefined
      release()
      releaseHandler?.()

      await acquire()
      expect(requestMock).toHaveBeenCalledTimes(2)
    })
    scope.stop()
  })

  it('gracefully handles request rejection', async () => {
    requestMock.mockRejectedValueOnce(new DOMException('Not allowed'))
    const useWakeLock = await loadUseWakeLock()
    const scope = effectScope()
    await scope.run(async () => {
      const { acquire } = useWakeLock()
      // Should not throw
      await expect(acquire()).resolves.toBeUndefined()
    })
    scope.stop()
  })
})
