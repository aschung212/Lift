import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { broadcastStoreUpdate, onCrossTabUpdate, closeSyncChannel } from '../crossTabSync'

// Mock BroadcastChannel for JSDOM (which doesn't implement it)
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = []
  name: string
  onmessage: ((event: MessageEvent) => void) | null = null
  private listeners: Array<(event: MessageEvent) => void> = []
  closed = false

  constructor(name: string) {
    this.name = name
    MockBroadcastChannel.instances.push(this)
  }

  postMessage(data: unknown) {
    if (this.closed) throw new DOMException('Channel is closed')
    // Deliver to all OTHER instances with the same name (simulates cross-tab)
    for (const instance of MockBroadcastChannel.instances) {
      if (instance !== this && instance.name === this.name && !instance.closed) {
        const event = new MessageEvent('message', { data })
        for (const listener of instance.listeners) {
          listener(event)
        }
        if (instance.onmessage) instance.onmessage(event)
      }
    }
  }

  addEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.push(listener)
  }

  removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners = this.listeners.filter(l => l !== listener)
  }

  close() {
    this.closed = true
  }
}

describe('crossTabSync', () => {
  beforeEach(() => {
    MockBroadcastChannel.instances = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).BroadcastChannel = MockBroadcastChannel
    // Reset the module's internal channel by closing it
    closeSyncChannel()
  })

  afterEach(() => {
    closeSyncChannel()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).BroadcastChannel
  })

  it('broadcasts store updates to other tabs', () => {
    // Tab A: the broadcaster (created internally by broadcastStoreUpdate)
    const callback = vi.fn()

    // Tab B: the listener — creates its own channel via onCrossTabUpdate
    // But both use the same module, so they share the same internal channel.
    // To simulate cross-tab, we need a separate channel instance.
    const tabBChannel = new MockBroadcastChannel('lift-sync')
    tabBChannel.addEventListener('message', (event: MessageEvent) => {
      const data = event.data
      if (data?.type === 'store-update') {
        callback(data.store)
      }
    })

    broadcastStoreUpdate('workout')

    expect(callback).toHaveBeenCalledWith('workout')
  })

  it('ignores messages from the same tab', () => {
    const callback = vi.fn()
    onCrossTabUpdate(callback)

    // Broadcasting from the same module instance should NOT trigger the callback
    // because both use the same TAB_ID
    broadcastStoreUpdate('bodyweight')

    expect(callback).not.toHaveBeenCalled()
  })

  it('onCrossTabUpdate returns an unsubscribe function', () => {
    const callback = vi.fn()
    const unsub = onCrossTabUpdate(callback)

    // Create a "Tab A" channel to simulate cross-tab broadcast
    const tabAChannel = new MockBroadcastChannel('lift-sync')
    tabAChannel.postMessage({ type: 'store-update', store: 'preferences', tabId: 'other-tab' })

    expect(callback).toHaveBeenCalledTimes(1)

    unsub()

    tabAChannel.postMessage({ type: 'store-update', store: 'preferences', tabId: 'other-tab' })
    expect(callback).toHaveBeenCalledTimes(1) // no additional call
  })

  it('ignores malformed messages', () => {
    const callback = vi.fn()
    onCrossTabUpdate(callback)

    const otherChannel = new MockBroadcastChannel('lift-sync')
    otherChannel.postMessage({ type: 'unknown', data: 'garbage' })
    otherChannel.postMessage(null)
    otherChannel.postMessage('not an object')

    expect(callback).not.toHaveBeenCalled()
  })

  it('closeSyncChannel closes the channel gracefully', () => {
    // Trigger channel creation
    broadcastStoreUpdate('workout')
    expect(MockBroadcastChannel.instances.length).toBeGreaterThan(0)

    closeSyncChannel()

    const internalChannel = MockBroadcastChannel.instances.find(
      ch => ch.name === 'lift-sync' && ch.closed
    )
    expect(internalChannel).toBeDefined()
  })

  it('handles BroadcastChannel unavailability gracefully', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).BroadcastChannel
    closeSyncChannel() // reset internal state

    // Should not throw
    expect(() => broadcastStoreUpdate('workout')).not.toThrow()

    const callback = vi.fn()
    const unsub = onCrossTabUpdate(callback)
    expect(typeof unsub).toBe('function')
    unsub() // should not throw
  })
})
