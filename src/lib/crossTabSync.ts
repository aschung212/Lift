/**
 * Cross-tab data synchronization via BroadcastChannel.
 *
 * When a store calls `broadcastStoreUpdate(storeName)` after persisting to
 * localStorage, other tabs/windows receive the message and can reload their
 * Pinia state from localStorage to stay in sync.
 *
 * Gracefully degrades to a no-op when BroadcastChannel is unavailable
 * (e.g. older browsers, Capacitor WKWebView).
 */

const CHANNEL_NAME = 'lift-sync'

export type StoreName = 'workout' | 'bodyweight' | 'preferences' | 'progression'

export interface CrossTabMessage {
  /** Which store was updated */
  store: StoreName
  /** Timestamp of the mutation (ISO 8601) */
  timestamp: string
  /** Tab identifier to avoid reacting to own broadcasts */
  tabId: string
}

/** Unique ID for this tab/window instance */
const TAB_ID = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`

let _channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (_channel) return _channel
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    _channel = new BroadcastChannel(CHANNEL_NAME)
    return _channel
  } catch {
    // BroadcastChannel constructor can throw in restricted contexts
    return null
  }
}

/**
 * Notify other tabs that a store was updated.
 * Call this after `_persist()` in any store action.
 */
export function broadcastStoreUpdate(store: StoreName): void {
  const ch = getChannel()
  if (!ch) return
  const msg: CrossTabMessage = {
    store,
    timestamp: new Date().toISOString(),
    tabId: TAB_ID,
  }
  try {
    ch.postMessage(msg)
  } catch {
    // postMessage can fail if the channel was closed or in an error state
  }
}

/**
 * Register a callback for cross-tab store updates.
 * The callback is NOT fired for messages from the current tab.
 * Returns an unsubscribe function.
 */
export function onCrossTabUpdate(
  callback: (store: StoreName) => void,
): () => void {
  const ch = getChannel()
  if (!ch) return () => {}

  const handler = (event: MessageEvent) => {
    const msg = event.data as CrossTabMessage
    // Ignore our own broadcasts
    if (!msg || msg.tabId === TAB_ID) return
    callback(msg.store)
  }
  ch.addEventListener('message', handler)
  return () => ch.removeEventListener('message', handler)
}

/**
 * Close the channel. Call on app teardown if needed.
 */
export function closeCrossTabChannel(): void {
  if (_channel) {
    _channel.close()
    _channel = null
  }
}

/** Expose TAB_ID for testing */
export { TAB_ID }
