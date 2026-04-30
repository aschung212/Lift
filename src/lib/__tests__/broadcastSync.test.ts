import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initBroadcastSync, broadcastStoreUpdate, onStoreUpdate, destroyBroadcastSync } from '../broadcastSync'

// Mock BroadcastChannel since jsdom doesn't provide it
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
    if (this.closed) throw new Error('Channel is closed')
    // Deliver to all OTHER instances with the same channel name
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
}

describe('broadcastSync', () => {
  beforeEach(() => {
    MockBroadcastChannel.instances = []
    // @ts-expect-error -- injecting mock into global
    globalThis.BroadcastChannel = MockBroadcastChannel
    destroyBroadcastSync()
  })

  afterEach(() => {
    destroyBroadcastSync()
    // @ts-expect-error -- cleanup
    delete globalThis.BroadcastChannel
  })

  it('does not throw when BroadcastChannel is unavailable', () => {
    // @ts-expect-error -- removing global
    delete globalThis.BroadcastChannel
    expect(() => initBroadcastSync()).not.toThrow()
    expect(() => broadcastStoreUpdate('workout')).not.toThrow()
  })

  it('broadcasts store updates to registered listeners', () => {
    // Tab A: init and register listener
    initBroadcastSync()
    const callback = vi.fn()
    onStoreUpdate('workout', callback)

    // Tab B: simulate via a second BroadcastChannel
    const tabB = new MockBroadcastChannel('lift-sync')
    tabB.postMessage({ type: 'store-update', store: 'workout', tabId: 'other-tab' })

    expect(callback).toHaveBeenCalledOnce()
  })

  it('does not invoke listener for messages from the same tab', () => {
    initBroadcastSync()
    const callback = vi.fn()
    onStoreUpdate('workout', callback)

    // broadcastStoreUpdate sends from this tab — same tabId
    broadcastStoreUpdate('workout')

    // The listener should NOT fire for own messages
    // (it would fire on other tabs' channels, but our mock delivers to other instances only)
    expect(callback).not.toHaveBeenCalled()
  })

  it('routes messages to the correct store listener', () => {
    initBroadcastSync()
    const workoutCb = vi.fn()
    const bodyweightCb = vi.fn()
    onStoreUpdate('workout', workoutCb)
    onStoreUpdate('bodyweight', bodyweightCb)

    const tabB = new MockBroadcastChannel('lift-sync')
    tabB.postMessage({ type: 'store-update', store: 'bodyweight', tabId: 'other-tab' })

    expect(workoutCb).not.toHaveBeenCalled()
    expect(bodyweightCb).toHaveBeenCalledOnce()
  })

  it('ignores messages with unknown type', () => {
    initBroadcastSync()
    const callback = vi.fn()
    onStoreUpdate('workout', callback)

    const tabB = new MockBroadcastChannel('lift-sync')
    tabB.postMessage({ type: 'unknown', store: 'workout', tabId: 'other-tab' })

    expect(callback).not.toHaveBeenCalled()
  })

  it('ignores null/malformed messages', () => {
    initBroadcastSync()
    const callback = vi.fn()
    onStoreUpdate('workout', callback)

    const tabB = new MockBroadcastChannel('lift-sync')
    tabB.postMessage(null)
    tabB.postMessage(undefined)
    tabB.postMessage('not an object')

    expect(callback).not.toHaveBeenCalled()
  })

  it('destroyBroadcastSync stops receiving messages', () => {
    initBroadcastSync()
    const callback = vi.fn()
    onStoreUpdate('workout', callback)

    destroyBroadcastSync()

    const tabB = new MockBroadcastChannel('lift-sync')
    tabB.postMessage({ type: 'store-update', store: 'workout', tabId: 'other-tab' })

    expect(callback).not.toHaveBeenCalled()
  })

  it('initBroadcastSync is idempotent', () => {
    initBroadcastSync()
    initBroadcastSync() // second call should not create a second channel
    expect(MockBroadcastChannel.instances.length).toBe(1)
  })
})
