import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Store the BroadcastChannel mock instances so we can simulate cross-tab messages
let channelInstances: MockBroadcastChannel[] = []

class MockBroadcastChannel {
  name: string
  onmessage: ((ev: MessageEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  closed = false

  constructor(name: string) {
    this.name = name
    channelInstances.push(this)
  }

  postMessage(data: unknown) {
    if (this.closed) throw new DOMException('Channel is closed')
    // Deliver to all OTHER instances with the same channel name
    for (const ch of channelInstances) {
      if (ch !== this && ch.name === this.name && !ch.closed && ch.onmessage) {
        ch.onmessage(new MessageEvent('message', { data }))
      }
    }
  }

  close() {
    this.closed = true
    channelInstances = channelInstances.filter(c => c !== this)
  }
}

// Install mock before any imports
vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)

// Mock logger to prevent console noise
vi.mock('../logger', () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
}))

describe('crossTabSync', () => {
  beforeEach(() => {
    channelInstances = []
    // Reset module state between tests
    vi.resetModules()
  })

  afterEach(() => {
    for (const ch of [...channelInstances]) ch.close()
    channelInstances = []
  })

  it('broadcastChange sends a message with store name and senderId', async () => {
    const { broadcastChange, _getTabId } = await import('../crossTabSync')

    // Create a listener channel to capture the message
    const listener = new MockBroadcastChannel('lift-sync')
    const received: unknown[] = []
    listener.onmessage = (ev) => received.push(ev.data)

    broadcastChange('workout')

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      store: 'workout',
      senderId: _getTabId(),
    })
    expect((received[0] as { timestamp: string }).timestamp).toBeTruthy()

    listener.close()
  })

  it('onCrossTabChange fires handler when another tab broadcasts', async () => {
    const { onCrossTabChange, _getTabId } = await import('../crossTabSync')

    const handler = vi.fn()
    onCrossTabChange('bodyweight', handler)

    // Simulate a message from a different tab
    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({
      store: 'bodyweight',
      timestamp: new Date().toISOString(),
      senderId: 'other-tab-id',
    })

    expect(handler).toHaveBeenCalledOnce()

    otherTab.close()
  })

  it('ignores messages from the same tab (self-broadcast)', async () => {
    const { broadcastChange, onCrossTabChange } = await import('../crossTabSync')

    const handler = vi.fn()
    onCrossTabChange('workout', handler)

    // Broadcasting from this tab should NOT trigger our own handler
    broadcastChange('workout')

    expect(handler).not.toHaveBeenCalled()
  })

  it('ignores messages for unregistered stores', async () => {
    const { onCrossTabChange } = await import('../crossTabSync')

    const workoutHandler = vi.fn()
    onCrossTabChange('workout', workoutHandler)

    // Send a message for a different store
    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({
      store: 'preferences',
      timestamp: new Date().toISOString(),
      senderId: 'other-tab',
    })

    expect(workoutHandler).not.toHaveBeenCalled()

    otherTab.close()
  })

  it('closeCrossTabSync cleans up channel and listeners', async () => {
    const { broadcastChange, onCrossTabChange, closeCrossTabSync } = await import('../crossTabSync')

    const handler = vi.fn()
    onCrossTabChange('workout', handler)

    // Trigger a broadcast to initialize the channel
    broadcastChange('workout')

    closeCrossTabSync()

    // After close, messages should not be delivered
    const otherTab = new MockBroadcastChannel('lift-sync')
    otherTab.postMessage({
      store: 'workout',
      timestamp: new Date().toISOString(),
      senderId: 'other-tab',
    })

    expect(handler).not.toHaveBeenCalled()

    otherTab.close()
  })

  it('degrades silently when BroadcastChannel is unavailable', async () => {
    // Remove BroadcastChannel
    vi.stubGlobal('BroadcastChannel', undefined)

    const { broadcastChange, onCrossTabChange } = await import('../crossTabSync')

    const handler = vi.fn()
    // Should not throw
    onCrossTabChange('workout', handler)
    broadcastChange('workout')

    expect(handler).not.toHaveBeenCalled()

    // Restore
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
  })

  it('multiple stores can have independent handlers', async () => {
    const { onCrossTabChange } = await import('../crossTabSync')

    const workoutHandler = vi.fn()
    const prefsHandler = vi.fn()
    onCrossTabChange('workout', workoutHandler)
    onCrossTabChange('preferences', prefsHandler)

    const otherTab = new MockBroadcastChannel('lift-sync')

    otherTab.postMessage({
      store: 'workout',
      timestamp: new Date().toISOString(),
      senderId: 'other-tab',
    })

    expect(workoutHandler).toHaveBeenCalledOnce()
    expect(prefsHandler).not.toHaveBeenCalled()

    otherTab.postMessage({
      store: 'preferences',
      timestamp: new Date().toISOString(),
      senderId: 'other-tab',
    })

    expect(prefsHandler).toHaveBeenCalledOnce()

    otherTab.close()
  })
})
