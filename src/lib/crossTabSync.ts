/**
 * Cross-tab data synchronization via BroadcastChannel.
 *
 * When a store persists to localStorage, it broadcasts a notification
 * so other tabs can reload the updated data without a manual refresh.
 * This prevents data conflicts when users have multiple tabs/PWA windows open.
 */

export type SyncStore = 'workout' | 'bodyweight' | 'preferences' | 'progression'

interface SyncMessage {
  type: 'store-update'
  store: SyncStore
  /** Timestamp of the change — lets receivers ignore stale/echo messages. */
  ts: number
  /** Tab identifier so a tab ignores its own broadcasts. */
  tabId: string
}

const CHANNEL_NAME = 'lift-sync'

/** Unique identifier for this tab/window instance. */
const tabId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

let _channel: BroadcastChannel | null = null
const _listeners = new Map<SyncStore, Array<() => void>>()

function getChannel(): BroadcastChannel | null {
  if (_channel) return _channel
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    _channel = new BroadcastChannel(CHANNEL_NAME)
    _channel.onmessage = (event: MessageEvent<SyncMessage>) => {
      const msg = event.data
      if (msg?.type !== 'store-update') return
      // Ignore our own broadcasts
      if (msg.tabId === tabId) return
      const handlers = _listeners.get(msg.store)
      if (handlers) {
        for (const fn of handlers) fn()
      }
    }
    return _channel
  } catch {
    // BroadcastChannel not supported (e.g. some WKWebView configurations)
    return null
  }
}

/**
 * Notify other tabs that a store's data has changed.
 * Call this after persisting to localStorage.
 */
export function broadcastStoreUpdate(store: SyncStore): void {
  const ch = getChannel()
  if (!ch) return
  const msg: SyncMessage = { type: 'store-update', store, ts: Date.now(), tabId }
  try {
    ch.postMessage(msg)
  } catch {
    // Channel may be closed; silently ignore
  }
}

/**
 * Register a callback that fires when another tab updates a store.
 * Returns an unsubscribe function.
 */
export function onCrossTabUpdate(store: SyncStore, callback: () => void): () => void {
  if (!_listeners.has(store)) _listeners.set(store, [])
  _listeners.get(store)!.push(callback)
  // Lazily initialize the channel when the first listener registers
  getChannel()
  return () => {
    const arr = _listeners.get(store)
    if (arr) {
      const idx = arr.indexOf(callback)
      if (idx !== -1) arr.splice(idx, 1)
    }
  }
}

/**
 * Close the channel and clear all listeners.
 * Called on sign-out or account deletion.
 */
export function closeCrossTabSync(): void {
  if (_channel) {
    try { _channel.close() } catch { /* noop */ }
    _channel = null
  }
  _listeners.clear()
}
