import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// Set up a synchronous BroadcastChannel mock before importing the module.
// jsdom's BroadcastChannel delivers messages asynchronously (or not at all
// between instances), so we need a mock that delivers synchronously for tests.
const channelsByName = new Map<string, Set<MockBroadcastChannel>>()

class MockBroadcastChannel {
  name: string
  onmessage: ((ev: MessageEvent) => void) | null = null
  private _closed = false

  constructor(name: string) {
    this.name = name
    if (!channelsByName.has(name)) channelsByName.set(name, new Set())
    channelsByName.get(name)!.add(this)
  }

  postMessage(data: unknown) {
    if (this._closed) throw new Error('Channel is closed')
    const peers = channelsByName.get(this.name) || new Set()
    for (const peer of peers) {
      if (peer !== this && peer.onmessage) {
        peer.onmessage(new MessageEvent('message', { data }))
      }
    }
  }

  close() {
    this._closed = true
    channelsByName.get(this.name)?.delete(this)
  }
}

// Override the global before the module is imported
vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)

// Now import the module — it will use our mock
import {
  broadcastStoreUpdate,
  broadcastSWUpdate,
  onStoreUpdate,
  onSWUpdate,
  closeBroadcastChannel,
} from '../broadcastSync'

describe('broadcastSync', () => {
  beforeEach(() => {
    closeBroadcastChannel()
    channelsByName.clear()
  })

  afterEach(() => {
    closeBroadcastChannel()
    channelsByName.clear()
  })

  it('calls store update handler when a store change is broadcast from another channel', () => {
    const handler = vi.fn()
    onStoreUpdate(handler)

    // Simulate another tab broadcasting
    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({ type: 'store-update', store: 'workout', tabId: 'other-tab-123' })
    otherTab.close()

    expect(handler).toHaveBeenCalledWith('workout')
  })

  it('calls SW update handler when a SW update is broadcast from another channel', () => {
    const handler = vi.fn()
    onSWUpdate(handler)

    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({ type: 'sw-update', tabId: 'other-tab-456' })
    otherTab.close()

    expect(handler).toHaveBeenCalledWith()
  })

  it('ignores messages from the same tab (self-broadcasts)', () => {
    const handler = vi.fn()
    onStoreUpdate(handler)

    // broadcastStoreUpdate uses the module's own TAB_ID.
    // The module's channel receives the message but filters by tabId.
    broadcastStoreUpdate('workout')

    // No handler call because the tabId matches (self-broadcast).
    // With our mock, the message goes to peer channels but the module's
    // own channel is the one posting — so it doesn't receive its own message.
    expect(handler).not.toHaveBeenCalled()
  })

  it('unsubscribe function removes the handler', () => {
    const handler = vi.fn()
    const unsub = onStoreUpdate(handler)

    unsub()

    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({ type: 'store-update', store: 'bodyweight', tabId: 'other-tab-789' })
    otherTab.close()

    expect(handler).not.toHaveBeenCalled()
  })

  it('supports multiple handlers', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    onStoreUpdate(handler1)
    onStoreUpdate(handler2)

    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({ type: 'store-update', store: 'preferences', tabId: 'other-tab' })
    otherTab.close()

    expect(handler1).toHaveBeenCalledWith('preferences')
    expect(handler2).toHaveBeenCalledWith('preferences')
  })

  it('ignores messages with no store field for store-update type', () => {
    const handler = vi.fn()
    onStoreUpdate(handler)

    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({ type: 'store-update', tabId: 'other-tab' })
    otherTab.close()

    expect(handler).not.toHaveBeenCalled()
  })

  it('closeBroadcastChannel clears all handlers', () => {
    const handler = vi.fn()
    onStoreUpdate(handler)

    closeBroadcastChannel()

    // After closing, registering a new handler and broadcasting should still work
    const handler2 = vi.fn()
    onStoreUpdate(handler2)

    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({ type: 'store-update', store: 'workout', tabId: 'other-tab' })
    otherTab.close()

    expect(handler).not.toHaveBeenCalled()
    expect(handler2).toHaveBeenCalledWith('workout')
  })

  it('broadcastStoreUpdate does not throw when channel is available', () => {
    expect(() => broadcastStoreUpdate('workout')).not.toThrow()
    expect(() => broadcastStoreUpdate('bodyweight')).not.toThrow()
    expect(() => broadcastStoreUpdate('preferences')).not.toThrow()
    expect(() => broadcastStoreUpdate('progression')).not.toThrow()
  })

  it('broadcastSWUpdate does not throw when channel is available', () => {
    expect(() => broadcastSWUpdate()).not.toThrow()
  })
})

describe('broadcastSync structural safety', () => {
  function getStoreFiles(): { name: string; content: string }[] {
    const storesDir = join(__dirname, '../../stores')
    return readdirSync(storesDir)
      .filter(f => f.endsWith('.ts') && !f.includes('__tests__'))
      .map(f => ({ name: f, content: readFileSync(join(storesDir, f), 'utf-8') }))
  }

  it('every store with _persist() imports and calls broadcastStoreUpdate', () => {
    const violations: string[] = []

    for (const { name, content } of getStoreFiles()) {
      if (!content.includes('_persist()')) continue

      if (!content.includes("import { broadcastStoreUpdate }") &&
          !content.includes("import { broadcastStoreUpdate,")) {
        violations.push(`${name} has _persist() but does not import broadcastStoreUpdate`)
        continue
      }

      if (!content.includes("broadcastStoreUpdate('")) {
        violations.push(`${name} imports broadcastStoreUpdate but never calls it in _persist()`)
      }
    }

    expect(
      violations,
      'All stores with _persist() must broadcast changes for cross-tab sync:\n' + violations.join('\n')
    ).toHaveLength(0)
  })

  it('every store with _persist() has a _reloadFromStorage() action', () => {
    const violations: string[] = []

    for (const { name, content } of getStoreFiles()) {
      if (!content.includes('_persist()')) continue

      if (!content.includes('_reloadFromStorage()')) {
        violations.push(`${name} has _persist() but no _reloadFromStorage() action for cross-tab sync`)
      }
    }

    expect(
      violations,
      'All stores with _persist() must have _reloadFromStorage() for cross-tab sync:\n' + violations.join('\n')
    ).toHaveLength(0)
  })

  it('App.vue registers a cross-tab sync listener', () => {
    const appContent = readFileSync(join(__dirname, '../../App.vue'), 'utf-8')
    expect(appContent).toContain('onStoreUpdate')
    expect(appContent).toContain('_reloadFromStorage')
  })
})
