import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  initCrossTabSync,
  broadcastStoreUpdate,
  broadcastSwUpdate,
  onStoreUpdate,
  onSwUpdate,
  destroyCrossTabSync,
} from '../crossTabSync'
import type { CrossTabMessage } from '../crossTabSync'

// Mock BroadcastChannel for jsdom environment
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = []
  name: string
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(name: string) {
    this.name = name
    MockBroadcastChannel.instances.push(this)
  }

  postMessage(data: CrossTabMessage): void {
    // Deliver to all OTHER instances on the same channel (simulates cross-tab)
    for (const ch of MockBroadcastChannel.instances) {
      if (ch !== this && ch.name === this.name && ch.onmessage) {
        ch.onmessage(new MessageEvent('message', { data }))
      }
    }
  }

  close(): void {
    const idx = MockBroadcastChannel.instances.indexOf(this)
    if (idx !== -1) MockBroadcastChannel.instances.splice(idx, 1)
  }
}

describe('crossTabSync', () => {
  beforeEach(() => {
    MockBroadcastChannel.instances = []
    // @ts-expect-error -- mock for test environment
    globalThis.BroadcastChannel = MockBroadcastChannel
    destroyCrossTabSync()
  })

  afterEach(() => {
    destroyCrossTabSync()
    // @ts-expect-error -- cleanup mock
    delete globalThis.BroadcastChannel
  })

  it('initCrossTabSync returns true when BroadcastChannel is available', () => {
    expect(initCrossTabSync()).toBe(true)
  })

  it('initCrossTabSync returns false when BroadcastChannel is not available', () => {
    // @ts-expect-error -- simulate missing API
    delete globalThis.BroadcastChannel
    expect(initCrossTabSync()).toBe(false)
  })

  it('initCrossTabSync is idempotent', () => {
    initCrossTabSync()
    initCrossTabSync()
    // Only one channel should be created
    expect(MockBroadcastChannel.instances).toHaveLength(1)
  })

  it('broadcastStoreUpdate is a no-op before init', () => {
    // Should not throw
    broadcastStoreUpdate('workout-exercises')
  })

  it('store update from another tab triggers registered callback', () => {
    initCrossTabSync()

    const callback = vi.fn()
    onStoreUpdate('workout-exercises', callback)

    // Simulate another tab by creating a second channel and posting
    const otherTab = new MockBroadcastChannel('lift-sync')
    const msg: CrossTabMessage = {
      type: 'store-update',
      store: 'workout-exercises',
      source: 'other-tab-id',
      timestamp: Date.now(),
    }
    otherTab.postMessage(msg)

    expect(callback).toHaveBeenCalledTimes(1)
    otherTab.close()
  })

  it('does not trigger callback for unregistered store', () => {
    initCrossTabSync()

    const callback = vi.fn()
    onStoreUpdate('workout-exercises', callback)

    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({
      type: 'store-update',
      store: 'bodyweight-entries',
      source: 'other-tab-id',
      timestamp: Date.now(),
    })

    expect(callback).not.toHaveBeenCalled()
    otherTab.close()
  })

  it('SW update from another tab triggers registered callback', () => {
    initCrossTabSync()

    const callback = vi.fn()
    onSwUpdate(callback)

    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({
      type: 'sw-update',
      source: 'other-tab-id',
      timestamp: Date.now(),
    })

    expect(callback).toHaveBeenCalledTimes(1)
    otherTab.close()
  })

  it('self-broadcasts are ignored (same TAB_ID)', () => {
    initCrossTabSync()

    const callback = vi.fn()
    onStoreUpdate('workout-exercises', callback)

    // broadcastStoreUpdate posts from the SAME tab, so our own listener
    // should NOT fire (source === TAB_ID check)
    broadcastStoreUpdate('workout-exercises')

    expect(callback).not.toHaveBeenCalled()
  })

  it('destroyCrossTabSync cleans up channel and listeners', () => {
    initCrossTabSync()
    onStoreUpdate('workout-exercises', vi.fn())
    destroyCrossTabSync()

    // After destroy, broadcastStoreUpdate should be a no-op
    broadcastStoreUpdate('workout-exercises')

    // Re-init should work
    expect(initCrossTabSync()).toBe(true)
  })

  it('broadcastSwUpdate sends correct message type', () => {
    initCrossTabSync()

    const callback = vi.fn()
    onSwUpdate(callback)

    // Create another tab to receive
    const otherTab = new MockBroadcastChannel('lift-sync')
    const receivedMessages: CrossTabMessage[] = []
    otherTab.onmessage = (e: MessageEvent) => {
      receivedMessages.push(e.data)
    }

    broadcastSwUpdate()

    expect(receivedMessages).toHaveLength(1)
    expect(receivedMessages[0].type).toBe('sw-update')
    otherTab.close()
  })
})
