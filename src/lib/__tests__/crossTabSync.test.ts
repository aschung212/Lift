import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  initCrossTabSync,
  broadcastStoreUpdate,
  broadcastAuthChange,
  broadcastSwUpdate,
  destroyCrossTabSync,
} from '../crossTabSync'

// --- BroadcastChannel mock ---

let channels: MockBroadcastChannel[] = []

class MockBroadcastChannel {
  name: string
  onmessage: ((event: { data: unknown }) => void) | null = null
  onmessageerror: (() => void) | null = null
  closed = false

  constructor(name: string) {
    this.name = name
    channels.push(this)
  }

  postMessage(data: unknown): void {
    if (this.closed) throw new DOMException('Channel is closed')
    // Deliver to all OTHER channels with the same name
    for (const ch of channels) {
      if (ch !== this && ch.name === this.name && !ch.closed && ch.onmessage) {
        ch.onmessage({ data: structuredClone(data) })
      }
    }
  }

  close(): void {
    this.closed = true
    channels = channels.filter(c => c !== this)
  }
}

// Install the mock globally
vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)

describe('crossTabSync', () => {
  let reloadHandler: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    channels = []
    reloadHandler = vi.fn()
  })

  afterEach(() => {
    destroyCrossTabSync()
    vi.useRealTimers()
  })

  it('calls reload handler when another tab broadcasts a store update', () => {
    initCrossTabSync(reloadHandler)

    // Simulate a second tab broadcasting
    const tab2 = new MockBroadcastChannel('lift-sync')
    tab2.postMessage({ type: 'store-update', store: 'workout', senderId: 'tab-2' })

    // Debounce hasn't fired yet
    expect(reloadHandler).not.toHaveBeenCalled()

    vi.advanceTimersByTime(150) // past RELOAD_DEBOUNCE_MS (100)
    expect(reloadHandler).toHaveBeenCalledWith('workout')

    tab2.close()
  })

  it('debounces rapid store updates from the same store', () => {
    initCrossTabSync(reloadHandler)

    const tab2 = new MockBroadcastChannel('lift-sync')
    tab2.postMessage({ type: 'store-update', store: 'workout', senderId: 'tab-2' })
    tab2.postMessage({ type: 'store-update', store: 'workout', senderId: 'tab-2' })
    tab2.postMessage({ type: 'store-update', store: 'workout', senderId: 'tab-2' })

    vi.advanceTimersByTime(150)
    // Only one call despite 3 messages
    expect(reloadHandler).toHaveBeenCalledTimes(1)

    tab2.close()
  })

  it('does not debounce different stores', () => {
    initCrossTabSync(reloadHandler)

    const tab2 = new MockBroadcastChannel('lift-sync')
    tab2.postMessage({ type: 'store-update', store: 'workout', senderId: 'tab-2' })
    tab2.postMessage({ type: 'store-update', store: 'bodyweight', senderId: 'tab-2' })

    vi.advanceTimersByTime(150)
    expect(reloadHandler).toHaveBeenCalledTimes(2)
    expect(reloadHandler).toHaveBeenCalledWith('workout')
    expect(reloadHandler).toHaveBeenCalledWith('bodyweight')

    tab2.close()
  })

  it('ignores its own messages (no echo)', () => {
    initCrossTabSync(reloadHandler)

    // broadcastStoreUpdate posts with the internal senderId
    broadcastStoreUpdate('workout')

    vi.advanceTimersByTime(150)
    // Should NOT have triggered the handler (same tab)
    expect(reloadHandler).not.toHaveBeenCalled()
  })

  it('dispatches custom event on sw-update broadcast', () => {
    initCrossTabSync(reloadHandler)

    const swHandler = vi.fn()
    window.addEventListener('lift-sw-update-broadcast', swHandler)

    const tab2 = new MockBroadcastChannel('lift-sync')
    tab2.postMessage({ type: 'sw-update', senderId: 'tab-2' })

    expect(swHandler).toHaveBeenCalled()

    window.removeEventListener('lift-sw-update-broadcast', swHandler)
    tab2.close()
  })

  it('reloads page on auth-change broadcast', () => {
    const reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true,
    })

    initCrossTabSync(reloadHandler)

    const tab2 = new MockBroadcastChannel('lift-sync')
    tab2.postMessage({ type: 'auth-change', senderId: 'tab-2' })

    expect(reloadMock).toHaveBeenCalled()

    tab2.close()
  })

  it('gracefully handles missing BroadcastChannel', () => {
    const original = globalThis.BroadcastChannel
    // @ts-expect-error — simulating missing API
    delete globalThis.BroadcastChannel

    // Should not throw
    expect(() => initCrossTabSync(reloadHandler)).not.toThrow()
    // Should not throw even when trying to broadcast
    expect(() => broadcastStoreUpdate('workout')).not.toThrow()

    globalThis.BroadcastChannel = original
  })

  it('cleans up on destroyCrossTabSync', () => {
    initCrossTabSync(reloadHandler)
    destroyCrossTabSync()

    // After destroy, a second tab's messages should not trigger the handler
    const tab2 = new MockBroadcastChannel('lift-sync')
    tab2.postMessage({ type: 'store-update', store: 'workout', senderId: 'tab-2' })

    vi.advanceTimersByTime(150)
    expect(reloadHandler).not.toHaveBeenCalled()

    tab2.close()
  })

  it('broadcastAuthChange sends auth-change type', () => {
    initCrossTabSync(reloadHandler)

    // Create a spy channel to capture messages
    const tab2 = new MockBroadcastChannel('lift-sync')
    const messages: unknown[] = []
    tab2.onmessage = (e) => messages.push(e.data)

    broadcastAuthChange()

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ type: 'auth-change' })

    tab2.close()
  })

  it('broadcastSwUpdate sends sw-update type', () => {
    initCrossTabSync(reloadHandler)

    const tab2 = new MockBroadcastChannel('lift-sync')
    const messages: unknown[] = []
    tab2.onmessage = (e) => messages.push(e.data)

    broadcastSwUpdate()

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ type: 'sw-update' })

    tab2.close()
  })

  it('ignores malformed messages gracefully', () => {
    initCrossTabSync(reloadHandler)

    const tab2 = new MockBroadcastChannel('lift-sync')
    // These should not throw
    tab2.postMessage(null)
    tab2.postMessage('not-an-object')
    tab2.postMessage({ noType: true, senderId: 'tab-2' })
    tab2.postMessage({ type: 'store-update', senderId: 'tab-2' }) // missing store

    vi.advanceTimersByTime(150)
    expect(reloadHandler).not.toHaveBeenCalled()

    tab2.close()
  })
})
