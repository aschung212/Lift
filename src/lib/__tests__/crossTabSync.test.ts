import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  broadcastStoreUpdate,
  broadcastSWUpdate,
  onStoreUpdate,
  onSWUpdate,
  closeCrossTabSync,
} from '../crossTabSync'

// BroadcastChannel mock — simulates cross-tab messaging
let channels: MockBroadcastChannel[] = []

class MockBroadcastChannel {
  name: string
  onmessage: ((event: MessageEvent) => void) | null = null
  closed = false

  constructor(name: string) {
    this.name = name
    channels.push(this)
  }

  postMessage(data: unknown): void {
    if (this.closed) throw new Error('Channel is closed')
    // Deliver to other channels with the same name (simulating cross-tab)
    for (const ch of channels) {
      if (ch !== this && ch.name === this.name && !ch.closed && ch.onmessage) {
        ch.onmessage(new MessageEvent('message', { data }))
      }
    }
  }

  close(): void {
    this.closed = true
    const idx = channels.indexOf(this)
    if (idx !== -1) channels.splice(idx, 1)
  }
}

describe('crossTabSync', () => {
  beforeEach(() => {
    channels = []
    // Install mock BroadcastChannel globally
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
    // Clean up any prior state
    closeCrossTabSync()
  })

  afterEach(() => {
    closeCrossTabSync()
    vi.unstubAllGlobals()
  })

  it('delivers store-update messages to registered handlers', () => {
    const handler = vi.fn()
    onStoreUpdate(handler)

    // Simulate another tab broadcasting (create a second channel)
    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({ type: 'store-update', store: 'workout', timestamp: 1 })

    expect(handler).toHaveBeenCalledWith('workout')
  })

  it('delivers sw-update messages to registered handlers', () => {
    const handler = vi.fn()
    onSWUpdate(handler)

    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({ type: 'sw-update', timestamp: 1 })

    expect(handler).toHaveBeenCalledOnce()
  })

  it('suppresses self-echo for broadcastStoreUpdate', () => {
    const handler = vi.fn()
    onStoreUpdate(handler)

    // broadcastStoreUpdate sends a message on the module's own channel
    broadcastStoreUpdate('workout')

    // The handler should NOT be called because the message came from the same tab
    expect(handler).not.toHaveBeenCalled()
  })

  it('unsubscribes handlers correctly', () => {
    const handler = vi.fn()
    const unsub = onStoreUpdate(handler)
    unsub()

    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({ type: 'store-update', store: 'workout', timestamp: 1 })

    expect(handler).not.toHaveBeenCalled()
  })

  it('handles multiple stores independently', () => {
    const handler = vi.fn()
    onStoreUpdate(handler)

    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({ type: 'store-update', store: 'bodyweight', timestamp: 2 })
    otherTab.postMessage({ type: 'store-update', store: 'preferences', timestamp: 3 })

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenCalledWith('bodyweight')
    expect(handler).toHaveBeenCalledWith('preferences')
  })

  it('ignores malformed messages', () => {
    const handler = vi.fn()
    onStoreUpdate(handler)

    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage(null)
    otherTab.postMessage('not an object')
    otherTab.postMessage({ noType: true })
    otherTab.postMessage({ type: 'unknown-type', store: 'workout', timestamp: 1 })

    expect(handler).not.toHaveBeenCalled()
  })

  it('closeCrossTabSync cleans up all handlers', () => {
    const storeHandler = vi.fn()
    const swHandler = vi.fn()
    onStoreUpdate(storeHandler)
    onSWUpdate(swHandler)

    closeCrossTabSync()

    // After close, creating a new channel and posting should not call handlers
    // (handlers were cleared, and the module channel was closed)
    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({ type: 'store-update', store: 'workout', timestamp: 1 })
    otherTab.postMessage({ type: 'sw-update', timestamp: 1 })

    expect(storeHandler).not.toHaveBeenCalled()
    expect(swHandler).not.toHaveBeenCalled()
  })

  it('broadcastSWUpdate sends to other tabs', () => {
    const handler = vi.fn()
    onSWUpdate(handler)

    // Create another tab's channel before broadcasting
    const otherTab = new MockBroadcastChannel('lift-sync')
    const otherHandler = vi.fn()
    otherTab.onmessage = (e: MessageEvent) => {
      if (e.data?.type === 'sw-update') otherHandler()
    }

    broadcastSWUpdate()

    // otherTab should receive the message
    expect(otherHandler).toHaveBeenCalledOnce()
    // Our own handler should also NOT be called (self-echo not applicable for sw-update, but
    // the mock delivers to other channels only, so our handler won't fire via cross-tab)
    // However, the module's own channel WILL receive from otherTab's postMessage...
    // In real BroadcastChannel, postMessage does NOT deliver to the same port.
    // Our mock correctly simulates this by skipping `this` in postMessage.
  })

  it('gracefully handles missing BroadcastChannel', () => {
    closeCrossTabSync()
    vi.stubGlobal('BroadcastChannel', undefined)

    // Should not throw
    broadcastStoreUpdate('workout')
    broadcastSWUpdate()

    const handler = vi.fn()
    const unsub = onStoreUpdate(handler)
    expect(typeof unsub).toBe('function')
    unsub()
  })
})

describe('crossTabSync structural enforcement', () => {
  function getStoreFiles(): { path: string; name: string }[] {
    const storesDir = join(__dirname, '../../stores')
    return readdirSync(storesDir)
      .filter(f => f.endsWith('.ts') && !f.includes('__tests__'))
      .map(f => ({ path: join(storesDir, f), name: f }))
  }

  it('every store with _persist() calls broadcastStoreUpdate', () => {
    const violations: string[] = []

    for (const { path, name } of getStoreFiles()) {
      const content = readFileSync(path, 'utf-8')
      if (!content.includes('_persist()')) continue
      if (!content.includes('broadcastStoreUpdate')) {
        violations.push(name)
      }
    }

    expect(violations).toEqual([])
  })

  it('every store with _persist() has a _reloadFromStorage() method', () => {
    const violations: string[] = []

    for (const { path, name } of getStoreFiles()) {
      const content = readFileSync(path, 'utf-8')
      if (!content.includes('_persist()')) continue
      if (!content.includes('_reloadFromStorage')) {
        violations.push(name)
      }
    }

    expect(violations).toEqual([])
  })
})
