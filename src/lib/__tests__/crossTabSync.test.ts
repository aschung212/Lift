import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// jsdom doesn't provide BroadcastChannel, so we mock it globally.

type MessageHandler = (event: MessageEvent) => void

interface MockChannel {
  name: string
  postMessage: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  _handlers: Set<MessageHandler>
}

let mockChannels: MockChannel[]

class MockBroadcastChannel {
  name: string
  postMessage = vi.fn()
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  close = vi.fn()
  _handlers = new Set<MessageHandler>()

  constructor(name: string) {
    this.name = name
    this.addEventListener.mockImplementation((_event: string, handler: MessageHandler) => {
      this._handlers.add(handler)
    })
    this.removeEventListener.mockImplementation((_event: string, handler: MessageHandler) => {
      this._handlers.delete(handler)
    })
    mockChannels.push(this as unknown as MockChannel)
  }
}

beforeEach(() => {
  mockChannels = []
  ;(globalThis as Record<string, unknown>).BroadcastChannel = MockBroadcastChannel
})

afterEach(() => {
  vi.resetModules()
  delete (globalThis as Record<string, unknown>).BroadcastChannel
})

describe('crossTabSync', () => {
  it('broadcastStoreUpdate posts a message with store name and tabId', async () => {
    const mod = await import('../crossTabSync')

    mod.broadcastStoreUpdate('workout')

    expect(mockChannels.length).toBe(1)
    expect(mockChannels[0].name).toBe('lift-sync')
    const ch = mockChannels[0]
    expect(ch.postMessage).toHaveBeenCalledOnce()
    const msg = ch.postMessage.mock.calls[0][0]
    expect(msg.store).toBe('workout')
    expect(msg.tabId).toBe(mod.TAB_ID)
    expect(msg.timestamp).toBeTruthy()
  })

  it('onCrossTabUpdate fires callback on foreign messages, ignores own', async () => {
    const mod = await import('../crossTabSync')

    const callback = vi.fn()
    mod.onCrossTabUpdate(callback)

    expect(mockChannels.length).toBe(1)
    const ch = mockChannels[0]
    expect(ch._handlers.size).toBe(1)

    const handler = [...ch._handlers][0]

    // Message from another tab
    handler({ data: { store: 'bodyweight', timestamp: new Date().toISOString(), tabId: 'other-tab' } } as MessageEvent)
    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith('bodyweight')

    // Message from own tab — ignored
    handler({ data: { store: 'workout', timestamp: new Date().toISOString(), tabId: mod.TAB_ID } } as MessageEvent)
    expect(callback).toHaveBeenCalledOnce()
  })

  it('unsubscribe removes the listener', async () => {
    const mod = await import('../crossTabSync')

    const callback = vi.fn()
    const unsub = mod.onCrossTabUpdate(callback)

    const ch = mockChannels[0]
    expect(ch._handlers.size).toBe(1)

    unsub()
    expect(ch.removeEventListener).toHaveBeenCalled()
  })

  it('closeCrossTabChannel closes the channel', async () => {
    const mod = await import('../crossTabSync')

    mod.broadcastStoreUpdate('preferences')
    expect(mockChannels.length).toBe(1)

    mod.closeCrossTabChannel()
    expect(mockChannels[0].close).toHaveBeenCalledOnce()
  })

  it('gracefully no-ops when BroadcastChannel is unavailable', async () => {
    delete (globalThis as Record<string, unknown>).BroadcastChannel

    const mod = await import('../crossTabSync')

    // Should not throw
    mod.broadcastStoreUpdate('workout')

    const callback = vi.fn()
    const unsub = mod.onCrossTabUpdate(callback)
    expect(typeof unsub).toBe('function')
    unsub()
  })

  it('reuses the same channel across multiple calls', async () => {
    const mod = await import('../crossTabSync')

    mod.broadcastStoreUpdate('workout')
    mod.broadcastStoreUpdate('bodyweight')

    expect(mockChannels.length).toBe(1)
    expect(mockChannels[0].postMessage).toHaveBeenCalledTimes(2)
  })

  it('ignores null/malformed message data', async () => {
    const mod = await import('../crossTabSync')

    const callback = vi.fn()
    mod.onCrossTabUpdate(callback)

    const ch = mockChannels[0]
    const handler = [...ch._handlers][0]

    // null data — should not throw or call callback
    handler({ data: null } as MessageEvent)
    expect(callback).not.toHaveBeenCalled()
  })
})
