import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  initCrossTabSync,
  onCrossTabUpdate,
  broadcastStoreUpdate,
  closeCrossTabSync,
} from '../useCrossTabSync'

// Mock BroadcastChannel
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
    // Simulate delivery to other instances (not self)
    for (const instance of MockBroadcastChannel.instances) {
      if (instance !== this && instance.name === this.name && instance.onmessage && !instance.closed) {
        instance.onmessage(new MessageEvent('message', { data }))
      }
    }
  }

  close() {
    this.closed = true
    const idx = MockBroadcastChannel.instances.indexOf(this)
    if (idx !== -1) MockBroadcastChannel.instances.splice(idx, 1)
  }
}

describe('useCrossTabSync', () => {
  beforeEach(() => {
    MockBroadcastChannel.instances = []
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
    closeCrossTabSync()
  })

  afterEach(() => {
    closeCrossTabSync()
    vi.unstubAllGlobals()
  })

  it('initializes without error', () => {
    expect(() => initCrossTabSync()).not.toThrow()
  })

  it('does not throw if BroadcastChannel is undefined (SSR)', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    expect(() => initCrossTabSync()).not.toThrow()
  })

  it('only creates one channel on multiple init calls', () => {
    initCrossTabSync()
    initCrossTabSync()
    initCrossTabSync()
    // Only one instance for this tab
    expect(MockBroadcastChannel.instances.length).toBe(1)
  })

  it('does not call handler for own broadcasts (no self-messaging)', () => {
    initCrossTabSync()
    const handler = vi.fn()
    onCrossTabUpdate('workout', handler)

    broadcastStoreUpdate('workout')

    // The handler should NOT be called because the message came from the same tab
    // (same sender ID). In our mock, postMessage delivers to OTHER instances only.
    // Since there's only one instance, no delivery happens.
    expect(handler).not.toHaveBeenCalled()
  })

  it('calls handler when another tab broadcasts', () => {
    // Simulate tab 1
    initCrossTabSync()
    const handler = vi.fn()
    onCrossTabUpdate('workout', handler)

    // Simulate tab 2 broadcasting directly via a second channel instance
    const tab2Channel = new MockBroadcastChannel('lift-sync')
    tab2Channel.postMessage({ store: 'workout', senderId: 'other-tab-id', ts: Date.now() })

    expect(handler).toHaveBeenCalledTimes(1)

    tab2Channel.close()
  })

  it('routes messages to correct store handler', () => {
    initCrossTabSync()
    const workoutHandler = vi.fn()
    const bodyweightHandler = vi.fn()
    onCrossTabUpdate('workout', workoutHandler)
    onCrossTabUpdate('bodyweight', bodyweightHandler)

    const tab2Channel = new MockBroadcastChannel('lift-sync')
    tab2Channel.postMessage({ store: 'bodyweight', senderId: 'other-tab', ts: Date.now() })

    expect(workoutHandler).not.toHaveBeenCalled()
    expect(bodyweightHandler).toHaveBeenCalledTimes(1)

    tab2Channel.close()
  })

  it('ignores messages with no matching handler', () => {
    initCrossTabSync()
    const handler = vi.fn()
    onCrossTabUpdate('workout', handler)

    const tab2Channel = new MockBroadcastChannel('lift-sync')
    // progression has no registered handler
    tab2Channel.postMessage({ store: 'progression', senderId: 'other-tab', ts: Date.now() })

    expect(handler).not.toHaveBeenCalled()

    tab2Channel.close()
  })

  it('ignores malformed messages', () => {
    initCrossTabSync()
    const handler = vi.fn()
    onCrossTabUpdate('workout', handler)

    const tab2Channel = new MockBroadcastChannel('lift-sync')
    tab2Channel.postMessage(null)
    tab2Channel.postMessage({ random: 'data' })
    tab2Channel.postMessage(42)

    expect(handler).not.toHaveBeenCalled()

    tab2Channel.close()
  })

  it('closeCrossTabSync cleans up', () => {
    initCrossTabSync()
    onCrossTabUpdate('workout', vi.fn())

    closeCrossTabSync()

    // After close, broadcasting should not throw
    expect(() => broadcastStoreUpdate('workout')).not.toThrow()
  })

  it('broadcastStoreUpdate is a no-op before init', () => {
    // Channel not initialized — should not throw
    expect(() => broadcastStoreUpdate('workout')).not.toThrow()
  })
})
