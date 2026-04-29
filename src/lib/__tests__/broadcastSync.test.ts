import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Track all MessageChannel instances so tests can simulate cross-tab messaging
let channels: FakeBroadcastChannel[] = []

class FakeBroadcastChannel {
  name: string
  onmessage: ((event: MessageEvent) => void) | null = null
  closed = false

  constructor(name: string) {
    this.name = name
    channels.push(this)
  }

  postMessage(data: unknown): void {
    if (this.closed) return
    // Deliver to all OTHER channels with the same name (simulates cross-tab)
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

// Install fake BroadcastChannel globally
vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)

describe('broadcastSync', () => {
  let mod: typeof import('../broadcastSync')

  beforeEach(async () => {
    channels = []
    // Re-import fresh module for each test (resets internal _channel)
    vi.resetModules()
    mod = await import('../broadcastSync')
  })

  afterEach(() => {
    mod.closeBroadcastChannel()
    channels = []
  })

  it('broadcastStoreUpdate sends a store-update message', () => {
    const received: unknown[] = []
    mod.onBroadcast((msg) => received.push(msg))

    // Need a second channel to receive (same tab's channel doesn't echo)
    const listener = new FakeBroadcastChannel('lift-sync')
    listener.onmessage = (e) => received.push(e.data)

    mod.broadcastStoreUpdate('workout')

    expect(received.length).toBe(1)
    expect(received[0]).toMatchObject({
      type: 'store-update',
      source: 'workout',
    })

    listener.close()
  })

  it('broadcastThemeUpdate sends a theme-update message', () => {
    const received: unknown[] = []
    const listener = new FakeBroadcastChannel('lift-sync')
    listener.onmessage = (e) => received.push(e.data)

    mod.broadcastThemeUpdate('theme')

    expect(received.length).toBe(1)
    expect(received[0]).toMatchObject({
      type: 'theme-update',
      source: 'theme',
    })

    listener.close()
  })

  it('broadcastSignOut sends an auth-signout message', () => {
    const received: unknown[] = []
    const listener = new FakeBroadcastChannel('lift-sync')
    listener.onmessage = (e) => received.push(e.data)

    mod.broadcastSignOut()

    expect(received.length).toBe(1)
    expect(received[0]).toMatchObject({
      type: 'auth-signout',
      source: 'auth',
    })

    listener.close()
  })

  it('onBroadcast receives messages from other tabs', () => {
    const received: unknown[] = []
    mod.onBroadcast((msg) => received.push(msg))

    // Simulate a message from another tab
    const otherTab = new FakeBroadcastChannel('lift-sync')
    otherTab.postMessage({ type: 'store-update', source: 'bodyweight', ts: 123 })

    expect(received.length).toBe(1)
    expect(received[0]).toMatchObject({ type: 'store-update', source: 'bodyweight' })

    otherTab.close()
  })

  it('onBroadcast returns an unsubscribe function', () => {
    const received: unknown[] = []
    const unsub = mod.onBroadcast((msg) => received.push(msg))

    const otherTab = new FakeBroadcastChannel('lift-sync')
    otherTab.postMessage({ type: 'store-update', source: 'workout', ts: 1 })
    expect(received.length).toBe(1)

    unsub()
    otherTab.postMessage({ type: 'store-update', source: 'workout', ts: 2 })
    expect(received.length).toBe(1) // no new messages after unsub

    otherTab.close()
  })

  it('closeBroadcastChannel cleans up', () => {
    mod.onBroadcast(() => {})
    mod.closeBroadcastChannel()

    // After close, broadcasting should not throw
    expect(() => mod.broadcastStoreUpdate('workout')).not.toThrow()
  })

  it('messages include a timestamp', () => {
    const received: Array<{ ts: number }> = []
    const listener = new FakeBroadcastChannel('lift-sync')
    listener.onmessage = (e) => received.push(e.data)

    const before = Date.now()
    mod.broadcastStoreUpdate('preferences')
    const after = Date.now()

    expect(received[0].ts).toBeGreaterThanOrEqual(before)
    expect(received[0].ts).toBeLessThanOrEqual(after)

    listener.close()
  })

  it('does not echo messages back to the sending tab', () => {
    const received: unknown[] = []
    mod.onBroadcast((msg) => received.push(msg))

    // The module's own channel should NOT receive its own postMessage
    // (the FakeBroadcastChannel simulates this correctly — only other channels receive)
    mod.broadcastStoreUpdate('workout')

    expect(received.length).toBe(0)
  })
})
