import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('broadcastSync', () => {
  let originalBC: typeof globalThis.BroadcastChannel

  beforeEach(() => {
    originalBC = globalThis.BroadcastChannel
    vi.resetModules()
  })

  afterEach(() => {
    globalThis.BroadcastChannel = originalBC
  })

  function createMockChannel() {
    let onmessageHandler: ((ev: MessageEvent) => void) | null = null
    const mock = {
      postMessage: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      set onmessage(fn: ((ev: MessageEvent) => void) | null) {
        onmessageHandler = fn
      },
      get onmessage() {
        return onmessageHandler
      },
      onmessageerror: null,
    }
    return { mock, getOnMessage: () => onmessageHandler }
  }

  it('broadcasts a store-update message via BroadcastChannel', async () => {
    const { mock } = createMockChannel()
    globalThis.BroadcastChannel = function() { return mock } as unknown as typeof BroadcastChannel

    const { broadcastStoreUpdate } = await import('../broadcastSync')
    broadcastStoreUpdate('workout')

    expect(mock.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'store-update',
        store: 'workout',
        timestamp: expect.any(Number),
      })
    )
  })

  it('calls registered handler when a message is received', async () => {
    const handler = vi.fn()
    const { mock, getOnMessage } = createMockChannel()
    globalThis.BroadcastChannel = function() { return mock } as unknown as typeof BroadcastChannel

    const { onStoreUpdate } = await import('../broadcastSync')
    onStoreUpdate('bodyweight', handler)

    getOnMessage()!({ data: { type: 'store-update', store: 'bodyweight', timestamp: Date.now() } } as MessageEvent)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not call handler for a different store', async () => {
    const handler = vi.fn()
    const { mock, getOnMessage } = createMockChannel()
    globalThis.BroadcastChannel = function() { return mock } as unknown as typeof BroadcastChannel

    const { onStoreUpdate } = await import('../broadcastSync')
    onStoreUpdate('workout', handler)

    getOnMessage()!({ data: { type: 'store-update', store: 'bodyweight', timestamp: Date.now() } } as MessageEvent)

    expect(handler).not.toHaveBeenCalled()
  })

  it('removes handler with offStoreUpdate', async () => {
    const handler = vi.fn()
    const { mock, getOnMessage } = createMockChannel()
    globalThis.BroadcastChannel = function() { return mock } as unknown as typeof BroadcastChannel

    const { onStoreUpdate, offStoreUpdate } = await import('../broadcastSync')
    onStoreUpdate('workout', handler)
    offStoreUpdate('workout')

    getOnMessage()!({ data: { type: 'store-update', store: 'workout', timestamp: Date.now() } } as MessageEvent)

    expect(handler).not.toHaveBeenCalled()
  })

  it('gracefully handles environments without BroadcastChannel', async () => {
    // @ts-expect-error — testing undefined case
    delete globalThis.BroadcastChannel

    const { broadcastStoreUpdate } = await import('../broadcastSync')
    expect(() => broadcastStoreUpdate('workout')).not.toThrow()
  })

  it('gracefully handles closed channel on postMessage', async () => {
    const { mock } = createMockChannel()
    mock.postMessage = vi.fn(() => { throw new Error('Channel is closed') })
    globalThis.BroadcastChannel = function() { return mock } as unknown as typeof BroadcastChannel

    const { broadcastStoreUpdate } = await import('../broadcastSync')
    expect(() => broadcastStoreUpdate('workout')).not.toThrow()
  })
})
