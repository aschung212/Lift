import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  initCrossTabSync,
  broadcastStoreChange,
  registerStoreReloader,
  closeCrossTabSync,
  _resetCrossTabSync,
  _getTabId,
} from '../crossTabSync'

// Mock logger to prevent console noise
vi.mock('../logger', () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
}))

// BroadcastChannel mock
let mockChannels: MockBroadcastChannel[] = []

class MockBroadcastChannel {
  name: string
  onmessage: ((ev: MessageEvent) => void) | null = null
  closed = false
  private static _channels: MockBroadcastChannel[] = mockChannels

  constructor(name: string) {
    this.name = name
    MockBroadcastChannel._channels.push(this)
    mockChannels.push(this)
  }

  postMessage(data: unknown): void {
    if (this.closed) throw new Error('Channel is closed')
    // Deliver to all OTHER channels with the same name (simulates cross-tab)
    for (const ch of MockBroadcastChannel._channels) {
      if (ch !== this && ch.name === this.name && !ch.closed && ch.onmessage) {
        ch.onmessage(new MessageEvent('message', { data }))
      }
    }
  }

  close(): void {
    this.closed = true
    const idx = MockBroadcastChannel._channels.indexOf(this)
    if (idx !== -1) MockBroadcastChannel._channels.splice(idx, 1)
    const mIdx = mockChannels.indexOf(this)
    if (mIdx !== -1) mockChannels.splice(mIdx, 1)
  }
}

describe('crossTabSync', () => {
  beforeEach(() => {
    _resetCrossTabSync()
    mockChannels = []
    MockBroadcastChannel.prototype.constructor = MockBroadcastChannel
    // @ts-expect-error - assigning mock to global
    globalThis.BroadcastChannel = MockBroadcastChannel
  })

  afterEach(() => {
    _resetCrossTabSync()
    mockChannels = []
  })

  it('initializes without error', () => {
    expect(() => initCrossTabSync()).not.toThrow()
  })

  it('does not double-initialize', () => {
    initCrossTabSync()
    initCrossTabSync()
    // Only one channel should be created (the module's internal one)
    // mockChannels may have one from init
    expect(mockChannels.length).toBe(1)
  })

  it('generates a unique tab ID', () => {
    const id = _getTabId()
    expect(id).toBeTruthy()
    expect(typeof id).toBe('string')
  })

  it('broadcasts store changes to other tabs', () => {
    // Simulate two tabs: init creates the "receiving" channel
    initCrossTabSync()

    // Create a second channel to simulate another tab
    const otherTabChannel = new MockBroadcastChannel('lift-sync')
    const received: unknown[] = []
    otherTabChannel.onmessage = (ev: MessageEvent) => received.push(ev.data)

    broadcastStoreChange('workout')

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(
      expect.objectContaining({ type: 'store-changed', store: 'workout' }),
    )

    otherTabChannel.close()
  })

  it('does not broadcast when channel is not initialized', () => {
    // Don't call initCrossTabSync
    expect(() => broadcastStoreChange('workout')).not.toThrow()
  })

  it('calls registered reload handler on incoming message', () => {
    initCrossTabSync()
    const handler = vi.fn()
    registerStoreReloader('workout', handler)

    // Simulate a message from another tab
    const internalChannel = mockChannels[0]
    internalChannel.onmessage!(
      new MessageEvent('message', {
        data: { type: 'store-changed', store: 'workout', tabId: 'other-tab-123' },
      }),
    )

    expect(handler).toHaveBeenCalledOnce()
  })

  it('ignores messages from own tab', () => {
    initCrossTabSync()
    const handler = vi.fn()
    registerStoreReloader('workout', handler)

    const tabId = _getTabId()
    const internalChannel = mockChannels[0]
    internalChannel.onmessage!(
      new MessageEvent('message', {
        data: { type: 'store-changed', store: 'workout', tabId },
      }),
    )

    expect(handler).not.toHaveBeenCalled()
  })

  it('ignores messages with unknown type', () => {
    initCrossTabSync()
    const handler = vi.fn()
    registerStoreReloader('workout', handler)

    const internalChannel = mockChannels[0]
    internalChannel.onmessage!(
      new MessageEvent('message', {
        data: { type: 'unknown-type', store: 'workout', tabId: 'other' },
      }),
    )

    expect(handler).not.toHaveBeenCalled()
  })

  it('ignores messages for stores without a registered handler', () => {
    initCrossTabSync()
    // Register only workout handler
    const handler = vi.fn()
    registerStoreReloader('workout', handler)

    const internalChannel = mockChannels[0]
    // Send a bodyweight message — no handler registered
    internalChannel.onmessage!(
      new MessageEvent('message', {
        data: { type: 'store-changed', store: 'bodyweight', tabId: 'other-tab' },
      }),
    )

    expect(handler).not.toHaveBeenCalled()
  })

  it('prevents echo broadcasts during reload', () => {
    initCrossTabSync()

    // Create a second channel to catch broadcasts
    const otherTabChannel = new MockBroadcastChannel('lift-sync')
    const received: unknown[] = []
    otherTabChannel.onmessage = (ev: MessageEvent) => received.push(ev.data)

    // Register a handler that calls broadcastStoreChange (simulating _persist)
    registerStoreReloader('workout', () => {
      broadcastStoreChange('workout') // Should be suppressed
    })

    // Trigger reload from "another tab"
    const internalChannel = mockChannels[0]
    internalChannel.onmessage!(
      new MessageEvent('message', {
        data: { type: 'store-changed', store: 'workout', tabId: 'other-tab' },
      }),
    )

    // The broadcastStoreChange inside the handler should have been suppressed
    expect(received).toHaveLength(0)

    otherTabChannel.close()
  })

  it('closeCrossTabSync clears everything', () => {
    initCrossTabSync()
    const handler = vi.fn()
    registerStoreReloader('workout', handler)

    closeCrossTabSync()

    // After close, broadcasting should be a no-op
    expect(() => broadcastStoreChange('workout')).not.toThrow()
  })

  it('handles null/malformed messages gracefully', () => {
    initCrossTabSync()
    const handler = vi.fn()
    registerStoreReloader('workout', handler)

    const internalChannel = mockChannels[0]

    // null data
    internalChannel.onmessage!(new MessageEvent('message', { data: null }))
    // undefined data
    internalChannel.onmessage!(new MessageEvent('message', { data: undefined }))
    // wrong shape
    internalChannel.onmessage!(new MessageEvent('message', { data: 'not an object' }))

    expect(handler).not.toHaveBeenCalled()
  })
})
