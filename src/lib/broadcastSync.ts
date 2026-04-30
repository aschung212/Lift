/**
 * Cross-tab data synchronization via BroadcastChannel.
 *
 * When a store calls `_persist()` in one tab, it broadcasts the store name
 * so other open tabs/PWA windows can reload that store's data from
 * localStorage. This prevents stale state when Lift is open in multiple
 * browser tabs or a PWA window + browser tab simultaneously.
 *
 * Degrades gracefully: BroadcastChannel is unavailable in some contexts
 * (e.g., older browsers, certain Capacitor WebView versions). In those
 * cases, all operations are no-ops.
 */

type StoreKey = 'workout' | 'bodyweight' | 'preferences' | 'progression' | 'theme'

interface SyncMessage {
  /** Which store was updated */
  store: StoreKey
  /** Timestamp of the mutation — receivers ignore stale messages */
  ts: number
  /** Tab ID so we can ignore our own broadcasts */
  sender: string
}

const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

let _channel: BroadcastChannel | null = null
const _listeners = new Map<StoreKey, () => void>()

function getChannel(): BroadcastChannel | null {
  if (_channel) return _channel
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    _channel = new BroadcastChannel('lift-sync')
    _channel.onmessage = (event: MessageEvent<SyncMessage>) => {
      const msg = event.data
      if (!msg || msg.sender === TAB_ID) return
      const handler = _listeners.get(msg.store)
      if (handler) handler()
    }
    return _channel
  } catch {
    // BroadcastChannel constructor can throw in restricted contexts
    return null
  }
}

/**
 * Notify other tabs that a store's data changed.
 * Call this after writing to localStorage in `_persist()`.
 */
export function notifyPeers(store: StoreKey): void {
  const ch = getChannel()
  if (!ch) return
  try {
    ch.postMessage({ store, ts: Date.now(), sender: TAB_ID } satisfies SyncMessage)
  } catch {
    // postMessage can fail if the channel was closed
  }
}

/**
 * Register a callback for when another tab updates a store.
 * The callback should reload the store's state from localStorage.
 */
export function onPeerUpdate(store: StoreKey, handler: () => void): void {
  _listeners.set(store, handler)
  // Ensure the channel is created so we start listening
  getChannel()
}

/**
 * Close the BroadcastChannel. Called on app teardown or for testing.
 */
export function closeBroadcastSync(): void {
  if (_channel) {
    _channel.close()
    _channel = null
  }
  _listeners.clear()
}
