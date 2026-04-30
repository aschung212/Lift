import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { notifyPeers, onPeerUpdate, closeBroadcastSync } from '../broadcastSync'

// Mock BroadcastChannel in jsdom (not natively available)
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
    if (this.closed) throw new Error('Channel closed')
    // Deliver to all OTHER instances with the same name
    for (const ch of MockBroadcastChannel.instances) {
      if (ch !== this && ch.name === this.name && !ch.closed && ch.onmessage) {
        ch.onmessage(new MessageEvent('message', { data }))
      }
    }
  }

  close() {
    this.closed = true
    MockBroadcastChannel.instances = MockBroadcastChannel.instances.filter(c => c !== this)
  }
}

beforeEach(() => {
  MockBroadcastChannel.instances = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).BroadcastChannel = MockBroadcastChannel
})

afterEach(() => {
  closeBroadcastSync()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).BroadcastChannel
})

describe('broadcastSync', () => {
  it('notifyPeers is a no-op when BroadcastChannel is unavailable', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).BroadcastChannel
    // Should not throw
    expect(() => notifyPeers('workout')).not.toThrow()
  })

  it('delivers messages to registered listeners', () => {
    const handler = vi.fn()
    onPeerUpdate('workout', handler)

    // Simulate a second tab sending a message
    // The module creates its own channel internally; we simulate a peer
    // by creating another MockBroadcastChannel and posting to it
    const peerChannel = new MockBroadcastChannel('lift-sync')
    peerChannel.postMessage({ store: 'workout', ts: Date.now(), sender: 'other-tab' })

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('ignores messages from the same tab (self-sent)', () => {
    const handler = vi.fn()
    onPeerUpdate('workout', handler)

    // notifyPeers sends with the module's own TAB_ID — the handler should NOT fire
    notifyPeers('workout')

    expect(handler).not.toHaveBeenCalled()
  })

  it('routes messages to the correct store handler', () => {
    const workoutHandler = vi.fn()
    const bodyweightHandler = vi.fn()
    onPeerUpdate('workout', workoutHandler)
    onPeerUpdate('bodyweight', bodyweightHandler)

    const peer = new MockBroadcastChannel('lift-sync')
    peer.postMessage({ store: 'bodyweight', ts: Date.now(), sender: 'other-tab' })

    expect(workoutHandler).not.toHaveBeenCalled()
    expect(bodyweightHandler).toHaveBeenCalledTimes(1)
  })

  it('closeBroadcastSync stops all listeners', () => {
    const handler = vi.fn()
    onPeerUpdate('workout', handler)
    closeBroadcastSync()

    const peer = new MockBroadcastChannel('lift-sync')
    peer.postMessage({ store: 'workout', ts: Date.now(), sender: 'other-tab' })

    expect(handler).not.toHaveBeenCalled()
  })
})
