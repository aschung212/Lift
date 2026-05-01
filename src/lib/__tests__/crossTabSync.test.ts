import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { broadcastStoreUpdate, onCrossTabUpdate, closeCrossTabSync } from '../crossTabSync'

/**
 * BroadcastChannel is not available in the jsdom test environment,
 * so we mock it to verify the wiring logic.
 */

// Track all created channels for inspection
let channels: MockBroadcastChannel[] = []

class MockBroadcastChannel {
  name: string
  onmessage: ((event: MessageEvent) => void) | null = null
  closed = false

  constructor(name: string) {
    this.name = name
    channels.push(this)
  }

  postMessage(data: unknown) {
    if (this.closed) throw new Error('Channel is closed')
    // Simulate broadcast to OTHER channels with the same name
    for (const ch of channels) {
      if (ch !== this && ch.name === this.name && !ch.closed && ch.onmessage) {
        ch.onmessage(new MessageEvent('message', { data }))
      }
    }
  }

  close() {
    this.closed = true
  }
}

describe('crossTabSync', () => {
  beforeEach(() => {
    channels = []
    // Install the mock
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
    // Reset the module state by closing any previous channel
    closeCrossTabSync()
  })

  afterEach(() => {
    closeCrossTabSync()
    vi.unstubAllGlobals()
  })

  it('broadcasts store updates via BroadcastChannel', () => {
    // Register a listener first to initialize the channel
    const cb = vi.fn()
    onCrossTabUpdate('workout', cb)

    // Broadcasting from the same module should not trigger our own listener
    // (tabId check prevents self-echo)
    broadcastStoreUpdate('workout')
    expect(cb).not.toHaveBeenCalled()
  })

  it('calls listeners when another tab broadcasts', () => {
    const workoutCb = vi.fn()
    const bwCb = vi.fn()
    onCrossTabUpdate('workout', workoutCb)
    onCrossTabUpdate('bodyweight', bwCb)

    // Simulate a message from another tab (different tabId)
    const listenerChannel = channels.find(ch => ch.onmessage)
    expect(listenerChannel).toBeDefined()
    listenerChannel!.onmessage!(new MessageEvent('message', {
      data: { type: 'store-update', store: 'workout', ts: Date.now(), tabId: 'other-tab-123' }
    }))

    expect(workoutCb).toHaveBeenCalledTimes(1)
    expect(bwCb).not.toHaveBeenCalled()
  })

  it('ignores messages with wrong type', () => {
    const cb = vi.fn()
    onCrossTabUpdate('workout', cb)

    const ch = channels.find(c => c.onmessage)!
    ch.onmessage!(new MessageEvent('message', {
      data: { type: 'unrelated', store: 'workout' }
    }))

    expect(cb).not.toHaveBeenCalled()
  })

  it('unsubscribes correctly', () => {
    const cb = vi.fn()
    const unsub = onCrossTabUpdate('workout', cb)
    unsub()

    const ch = channels.find(c => c.onmessage)!
    ch.onmessage!(new MessageEvent('message', {
      data: { type: 'store-update', store: 'workout', ts: Date.now(), tabId: 'other-tab' }
    }))

    expect(cb).not.toHaveBeenCalled()
  })

  it('closeCrossTabSync closes channel and clears listeners', () => {
    const cb = vi.fn()
    onCrossTabUpdate('workout', cb)

    const ch = channels.find(c => c.onmessage)!
    closeCrossTabSync()

    expect(ch.closed).toBe(true)

    // After closing, broadcasts should not throw
    expect(() => broadcastStoreUpdate('workout')).not.toThrow()
  })

  it('handles multiple listeners for the same store', () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    onCrossTabUpdate('preferences', cb1)
    onCrossTabUpdate('preferences', cb2)

    const ch = channels.find(c => c.onmessage)!
    ch.onmessage!(new MessageEvent('message', {
      data: { type: 'store-update', store: 'preferences', ts: Date.now(), tabId: 'other-tab' }
    }))

    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)
  })

  it('gracefully handles missing BroadcastChannel', () => {
    closeCrossTabSync()
    vi.stubGlobal('BroadcastChannel', undefined)

    // Should not throw when BroadcastChannel is unavailable
    expect(() => broadcastStoreUpdate('workout')).not.toThrow()
    expect(() => onCrossTabUpdate('workout', vi.fn())).not.toThrow()
  })
})
