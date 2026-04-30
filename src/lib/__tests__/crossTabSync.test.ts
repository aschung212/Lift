import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  initCrossTabSync,
  broadcastStoreUpdate,
  destroyCrossTabSync,
  _getTabId,
} from '../crossTabSync'

// Mock BroadcastChannel for JSDOM (which doesn't support it natively)
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = []
  name: string
  onmessage: ((event: MessageEvent) => void) | null = null
  closed = false

  constructor(name: string) {
    this.name = name
    MockBroadcastChannel.instances.push(this)
  }

  postMessage(data: unknown) {
    // Deliver to all OTHER instances on the same channel (mirrors real API)
    for (const instance of MockBroadcastChannel.instances) {
      if (instance !== this && instance.name === this.name && !instance.closed && instance.onmessage) {
        instance.onmessage(new MessageEvent('message', { data }))
      }
    }
  }

  close() {
    this.closed = true
    MockBroadcastChannel.instances = MockBroadcastChannel.instances.filter(i => i !== this)
  }

  static reset() {
    MockBroadcastChannel.instances = []
  }
}

beforeEach(() => {
  MockBroadcastChannel.reset()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).BroadcastChannel = MockBroadcastChannel
})

afterEach(() => {
  destroyCrossTabSync()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).BroadcastChannel
})

describe('crossTabSync', () => {
  it('generates a unique tab ID on init', () => {
    const handler = vi.fn()
    initCrossTabSync(handler)
    const tabId = _getTabId()
    expect(tabId).toBeTruthy()
    expect(tabId.length).toBeGreaterThan(5)
  })

  it('does not initialize twice', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    initCrossTabSync(handler1)
    initCrossTabSync(handler2)
    expect(MockBroadcastChannel.instances.length).toBe(1)
  })

  it('broadcasts store key on broadcastStoreUpdate', () => {
    const handler = vi.fn()
    initCrossTabSync(handler)

    // Set up a second "tab" to receive the message
    const receiver = new MockBroadcastChannel('lift-sync')
    const received: unknown[] = []
    receiver.onmessage = (e: MessageEvent) => received.push(e.data)

    broadcastStoreUpdate('workout-exercises')

    expect(received.length).toBe(1)
    expect(received[0]).toEqual(
      expect.objectContaining({ storeKey: 'workout-exercises' }),
    )

    receiver.close()
  })

  it('ignores messages from own tab', async () => {
    const handler = vi.fn()
    initCrossTabSync(handler)

    // Broadcast from own tab — handler should NOT fire
    broadcastStoreUpdate('workout-exercises')

    // Wait for debounce
    await vi.waitFor(() => {
      // Handler should not have been called
    }, { timeout: 200 })

    expect(handler).not.toHaveBeenCalled()
  })

  it('calls handler when another tab broadcasts', async () => {
    vi.useFakeTimers()

    const handler = vi.fn()
    initCrossTabSync(handler)

    // Simulate another tab
    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({ tabId: 'other-tab-123', storeKey: 'bodyweight-entries' })

    // Advance past debounce
    vi.advanceTimersByTime(150)

    expect(handler).toHaveBeenCalledWith('bodyweight-entries')
    expect(handler).toHaveBeenCalledTimes(1)

    otherTab.close()
    vi.useRealTimers()
  })

  it('debounces rapid messages for the same store key', async () => {
    vi.useFakeTimers()

    const handler = vi.fn()
    initCrossTabSync(handler)

    const otherTab = new MockBroadcastChannel('lift-sync')

    // Fire 5 rapid messages for same store
    for (let i = 0; i < 5; i++) {
      otherTab.postMessage({ tabId: 'other-tab', storeKey: 'workout-exercises' })
    }

    vi.advanceTimersByTime(150)

    // Should only call handler once due to debounce
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('workout-exercises')

    otherTab.close()
    vi.useRealTimers()
  })

  it('handles multiple store keys independently', async () => {
    vi.useFakeTimers()

    const handler = vi.fn()
    initCrossTabSync(handler)

    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({ tabId: 'other-tab', storeKey: 'workout-exercises' })
    otherTab.postMessage({ tabId: 'other-tab', storeKey: 'user-preferences' })

    vi.advanceTimersByTime(150)

    // Both store keys should fire
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenCalledWith('workout-exercises')
    expect(handler).toHaveBeenCalledWith('user-preferences')

    otherTab.close()
    vi.useRealTimers()
  })

  it('does not call handler after destroy', async () => {
    vi.useFakeTimers()

    const handler = vi.fn()
    initCrossTabSync(handler)
    destroyCrossTabSync()

    // Simulate a message arriving after teardown
    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({ tabId: 'other-tab', storeKey: 'workout-exercises' })

    vi.advanceTimersByTime(150)

    expect(handler).not.toHaveBeenCalled()

    otherTab.close()
    vi.useRealTimers()
  })

  it('is a no-op when BroadcastChannel is unavailable', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).BroadcastChannel

    const handler = vi.fn()
    initCrossTabSync(handler)

    // Should not throw and tab ID should remain empty
    expect(_getTabId()).toBe('')

    // broadcastStoreUpdate should also be a no-op
    broadcastStoreUpdate('workout-exercises')
  })

  it('can reinitialize after destroy', () => {
    const handler1 = vi.fn()
    initCrossTabSync(handler1)
    destroyCrossTabSync()

    const handler2 = vi.fn()
    initCrossTabSync(handler2)
    expect(_getTabId()).toBeTruthy()
    expect(MockBroadcastChannel.instances.length).toBe(1)
  })
})
