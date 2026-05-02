/**
 * Cross-tab data synchronization via BroadcastChannel.
 *
 * When Lift is open in multiple browser tabs (or a PWA window + browser tab),
 * store mutations in one tab are invisible to others until a manual refresh.
 * This module broadcasts a lightweight "store changed" signal after each
 * _persist() call, so other tabs can reload from localStorage and stay in sync.
 *
 * Also propagates service worker update notifications across all open instances.
 */

const CHANNEL_NAME = 'lift-sync'

export type CrossTabMessage =
  | { type: 'store-update'; store: string; timestamp: number }
  | { type: 'sw-update'; timestamp: number }

let _channel: BroadcastChannel | null = null

/**
 * Per-store sequence numbers to suppress self-echo.
 * Each tab increments the counter when it broadcasts, and ignores
 * incoming messages whose store+timestamp match its own last broadcast.
 */
const _lastBroadcast = new Map<string, number>()

type StoreUpdateHandler = (store: string) => void
const _handlers: StoreUpdateHandler[] = []
const _swHandlers: Array<() => void> = []

function _getChannel(): BroadcastChannel | null {
  if (_channel) return _channel
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    _channel = new BroadcastChannel(CHANNEL_NAME)
    _channel.onmessage = (event: MessageEvent<CrossTabMessage>) => {
      const msg = event.data
      if (!msg || typeof msg !== 'object' || !msg.type) return

      if (msg.type === 'store-update') {
        // Suppress self-echo: if this tab just broadcast this store update, skip
        const lastTs = _lastBroadcast.get(msg.store)
        if (lastTs === msg.timestamp) return
        for (const handler of _handlers) {
          handler(msg.store)
        }
      } else if (msg.type === 'sw-update') {
        for (const handler of _swHandlers) {
          handler()
        }
      }
    }
    return _channel
  } catch {
    // BroadcastChannel can throw in restrictive contexts (e.g., opaque origins)
    return null
  }
}

/**
 * Broadcast that a store was updated. Call this after _persist().
 */
export function broadcastStoreUpdate(store: string): void {
  const ch = _getChannel()
  if (!ch) return
  const timestamp = Date.now()
  _lastBroadcast.set(store, timestamp)
  try {
    ch.postMessage({ type: 'store-update', store, timestamp } satisfies CrossTabMessage)
  } catch {
    // Channel may be closed — ignore
  }
}

/**
 * Broadcast that a service worker update is available.
 */
export function broadcastSWUpdate(): void {
  const ch = _getChannel()
  if (!ch) return
  try {
    ch.postMessage({ type: 'sw-update', timestamp: Date.now() } satisfies CrossTabMessage)
  } catch {
    // Channel may be closed
  }
}

/**
 * Register a handler to be called when another tab updates a store.
 * Returns an unsubscribe function.
 */
export function onStoreUpdate(handler: StoreUpdateHandler): () => void {
  _handlers.push(handler)
  // Lazily initialize the channel on first subscription
  _getChannel()
  return () => {
    const idx = _handlers.indexOf(handler)
    if (idx !== -1) _handlers.splice(idx, 1)
  }
}

/**
 * Register a handler to be called when another tab detects a SW update.
 * Returns an unsubscribe function.
 */
export function onSWUpdate(handler: () => void): () => void {
  _swHandlers.push(handler)
  _getChannel()
  return () => {
    const idx = _swHandlers.indexOf(handler)
    if (idx !== -1) _swHandlers.splice(idx, 1)
  }
}

/**
 * Close the channel and clean up. Call on app teardown if needed.
 */
export function closeCrossTabSync(): void {
  if (_channel) {
    _channel.close()
    _channel = null
  }
  _handlers.length = 0
  _swHandlers.length = 0
  _lastBroadcast.clear()
}
