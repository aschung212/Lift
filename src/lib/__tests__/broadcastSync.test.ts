import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  broadcastStoreUpdate,
  broadcastSyncStatus,
  broadcastSWUpdate,
  onBroadcast,
  closeBroadcastChannel,
  _tabId,
  type BroadcastMessage,
} from '../broadcastSync'

// Track all BroadcastChannel instances so we can simulate cross-tab messaging
let channels: Array<{ name: string; onmessage: ((e: MessageEvent) => void) | null; postMessage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = []

class MockBroadcastChannel {
  name: string
  onmessage: ((e: MessageEvent) => void) | null = null
  postMessage = vi.fn((data: BroadcastMessage) => {
    // Simulate: message goes to all OTHER channels with the same name
    for (const ch of channels) {
      if (ch !== this && ch.name === this.name && ch.onmessage) {
        ch.onmessage(new MessageEvent('message', { data }))
      }
    }
  })
  close = vi.fn()

  constructor(name: string) {
    this.name = name
    channels.push(this)
  }
}

describe('broadcastSync', () => {
  beforeEach(() => {
    channels = []
    closeBroadcastChannel()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).BroadcastChannel = MockBroadcastChannel
  })

  afterEach(() => {
    closeBroadcastChannel()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).BroadcastChannel
  })

  it('broadcasts store-update messages', () => {
    broadcastStoreUpdate('workout')

    expect(channels).toHaveLength(1)
    expect(channels[0].name).toBe('lift-sync')
    expect(channels[0].postMessage).toHaveBeenCalledWith({
      type: 'store-update',
      store: 'workout',
      tabId: _tabId,
    })
  })

  it('broadcasts sync-status messages', () => {
    broadcastSyncStatus('syncing')

    expect(channels[0].postMessage).toHaveBeenCalledWith({
      type: 'sync-status',
      status: 'syncing',
      tabId: _tabId,
    })
  })

  it('broadcasts sw-update messages', () => {
    broadcastSWUpdate()

    expect(channels[0].postMessage).toHaveBeenCalledWith({
      type: 'sw-update',
      tabId: _tabId,
    })
  })

  it('calls registered store-update handler on incoming messages from other tabs', () => {
    const handler = vi.fn()
    onBroadcast({ onStoreUpdate: handler })

    // Simulate another tab sending a message
    const otherTabMsg: BroadcastMessage = {
      type: 'store-update',
      store: 'bodyweight',
      tabId: 'other-tab-id',
    }
    const ch = channels[0]
    ch.onmessage?.(new MessageEvent('message', { data: otherTabMsg }))

    expect(handler).toHaveBeenCalledWith('bodyweight')
  })

  it('calls registered sync-status handler on incoming messages from other tabs', () => {
    const handler = vi.fn()
    onBroadcast({ onSyncStatus: handler })

    const otherTabMsg: BroadcastMessage = {
      type: 'sync-status',
      status: 'error',
      tabId: 'other-tab-id',
    }
    channels[0].onmessage?.(new MessageEvent('message', { data: otherTabMsg }))

    expect(handler).toHaveBeenCalledWith('error')
  })

  it('calls registered sw-update handler on incoming messages from other tabs', () => {
    const handler = vi.fn()
    onBroadcast({ onSWUpdate: handler })

    const otherTabMsg: BroadcastMessage = {
      type: 'sw-update',
      tabId: 'other-tab-id',
    }
    channels[0].onmessage?.(new MessageEvent('message', { data: otherTabMsg }))

    expect(handler).toHaveBeenCalledOnce()
  })

  it('ignores messages from the same tab (no echo)', () => {
    const handler = vi.fn()
    onBroadcast({ onStoreUpdate: handler })

    // Message with OUR tab ID — should be ignored
    const selfMsg: BroadcastMessage = {
      type: 'store-update',
      store: 'workout',
      tabId: _tabId,
    }
    channels[0].onmessage?.(new MessageEvent('message', { data: selfMsg }))

    expect(handler).not.toHaveBeenCalled()
  })

  it('ignores null/undefined message data', () => {
    const handler = vi.fn()
    onBroadcast({ onStoreUpdate: handler })

    channels[0].onmessage?.(new MessageEvent('message', { data: null }))
    channels[0].onmessage?.(new MessageEvent('message', { data: undefined }))

    expect(handler).not.toHaveBeenCalled()
  })

  it('reuses the same channel across multiple broadcast calls', () => {
    broadcastStoreUpdate('workout')
    broadcastStoreUpdate('bodyweight')
    broadcastSyncStatus('synced')

    expect(channels).toHaveLength(1)
  })

  it('closeBroadcastChannel closes and resets the channel', () => {
    broadcastStoreUpdate('workout')
    expect(channels).toHaveLength(1)

    const ch = channels[0]
    closeBroadcastChannel()

    expect(ch.close).toHaveBeenCalledOnce()

    // After closing, a new broadcast creates a fresh channel
    broadcastStoreUpdate('workout')
    expect(channels).toHaveLength(2)
  })

  it('no-ops gracefully when BroadcastChannel is unavailable', () => {
    closeBroadcastChannel()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).BroadcastChannel

    // Should not throw
    expect(() => broadcastStoreUpdate('workout')).not.toThrow()
    expect(() => broadcastSyncStatus('offline')).not.toThrow()
    expect(() => broadcastSWUpdate()).not.toThrow()
    expect(() => onBroadcast({ onStoreUpdate: vi.fn() })).not.toThrow()
  })
})
