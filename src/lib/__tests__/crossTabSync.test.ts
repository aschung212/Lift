import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Shared state for the mock channel — survives module resets
const channels: Array<{
  postMessage: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  handlers: Map<string, Set<(event: { data: unknown }) => void>>
}> = []

function latestChannel() {
  return channels[channels.length - 1]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).BroadcastChannel = function MockBroadcastChannel() {
  const handlers = new Map<string, Set<(event: { data: unknown }) => void>>()
  const ch = {
    postMessage: vi.fn(),
    addEventListener: vi.fn((event: string, handler: (event: { data: unknown }) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    }),
    removeEventListener: vi.fn((event: string, handler: (event: { data: unknown }) => void) => {
      handlers.get(event)?.delete(handler)
    }),
    close: vi.fn(),
    handlers,
  }
  channels.push(ch)
  return ch
}

describe('crossTabSync', () => {
  let broadcastStoreUpdate: typeof import('../crossTabSync').broadcastStoreUpdate
  let onCrossTabUpdate: typeof import('../crossTabSync').onCrossTabUpdate
  let closeCrossTabChannel: typeof import('../crossTabSync').closeCrossTabChannel

  beforeEach(async () => {
    vi.resetModules()
    channels.length = 0
    const mod = await import('../crossTabSync')
    broadcastStoreUpdate = mod.broadcastStoreUpdate
    onCrossTabUpdate = mod.onCrossTabUpdate
    closeCrossTabChannel = mod.closeCrossTabChannel
  })

  afterEach(() => {
    closeCrossTabChannel()
  })

  it('broadcasts a store-updated message', () => {
    broadcastStoreUpdate('workout')
    const ch = latestChannel()
    expect(ch.postMessage).toHaveBeenCalledOnce()
    const msg = ch.postMessage.mock.calls[0][0]
    expect(msg.type).toBe('store-updated')
    expect(msg.store).toBe('workout')
    expect(msg.sender).toBeTruthy()
    expect(msg.timestamp).toBeGreaterThan(0)
  })

  it('receives messages from other tabs', () => {
    const callback = vi.fn()
    onCrossTabUpdate(callback)

    const ch = latestChannel()
    const listeners = ch.handlers.get('message')
    expect(listeners).toBeDefined()
    expect(listeners!.size).toBe(1)

    const handler = [...listeners!][0]
    handler({
      data: {
        type: 'store-updated',
        store: 'bodyweight',
        sender: 'other-tab-id',
        timestamp: Date.now(),
      },
    })

    expect(callback).toHaveBeenCalledWith('bodyweight')
  })

  it('ignores own messages (same sender)', () => {
    const callback = vi.fn()
    onCrossTabUpdate(callback)

    // Broadcast to capture the sender ID
    broadcastStoreUpdate('workout')
    const ch = latestChannel()
    const sentMsg = ch.postMessage.mock.calls[0][0]

    // Simulate receiving our own message back
    const listeners = ch.handlers.get('message')
    const handler = [...listeners!][0]
    handler({ data: sentMsg })

    expect(callback).not.toHaveBeenCalled()
  })

  it('ignores messages with wrong type', () => {
    const callback = vi.fn()
    onCrossTabUpdate(callback)

    const ch = latestChannel()
    const listeners = ch.handlers.get('message')
    const handler = [...listeners!][0]
    handler({
      data: { type: 'something-else', store: 'workout', sender: 'x', timestamp: 1 },
    })

    expect(callback).not.toHaveBeenCalled()
  })

  it('cleanup removes the listener', () => {
    const callback = vi.fn()
    const cleanup = onCrossTabUpdate(callback)

    const ch = latestChannel()
    expect(ch.handlers.get('message')?.size).toBe(1)
    cleanup()
    expect(ch.removeEventListener).toHaveBeenCalled()
  })

  it('closeCrossTabChannel closes the channel', () => {
    // Trigger channel creation
    broadcastStoreUpdate('preferences')
    const ch = latestChannel()
    closeCrossTabChannel()
    expect(ch.close).toHaveBeenCalledOnce()
  })

  it('gracefully handles missing BroadcastChannel', async () => {
    vi.resetModules()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const savedBC = (globalThis as any).BroadcastChannel
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).BroadcastChannel

    const mod = await import('../crossTabSync')
    // Should not throw
    mod.broadcastStoreUpdate('workout')
    const cleanup = mod.onCrossTabUpdate(vi.fn())
    cleanup()
    mod.closeCrossTabChannel()

    // Restore
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).BroadcastChannel = savedBC
  })

  it('broadcasts different store names correctly', () => {
    const stores = ['workout', 'bodyweight', 'preferences', 'progression'] as const
    for (const store of stores) {
      broadcastStoreUpdate(store)
    }
    const ch = latestChannel()
    expect(ch.postMessage).toHaveBeenCalledTimes(4)
    const sentStores = ch.postMessage.mock.calls.map(
      (c: [{ store: string }]) => c[0].store,
    )
    expect(sentStores).toEqual([...stores])
  })
})
