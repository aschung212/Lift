/**
 * Cross-tab data sync via BroadcastChannel.
 *
 * When a store persists to localStorage, it broadcasts a message so other
 * tabs can reload from localStorage without waiting for a manual refresh.
 * Each tab has a unique ID to avoid processing its own messages.
 *
 * Gracefully degrades: if BroadcastChannel is unsupported (e.g. some
 * Capacitor WKWebView builds), all calls are no-ops.
 */

const CHANNEL_NAME = 'lift-sync'

interface StoreUpdateMessage {
  type: 'store-update'
  store: string
  tabId: string
}

const tabId = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2)

let channel: BroadcastChannel | null = null
const listeners = new Map<string, () => void>()

/**
 * Initialize the BroadcastChannel and start listening for messages
 * from other tabs. Call once at app startup (e.g. in App.vue onMounted).
 */
export function initBroadcastSync(): void {
  if (typeof BroadcastChannel === 'undefined') return
  if (channel) return // already initialized

  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (event: MessageEvent<StoreUpdateMessage>) => {
    const msg = event.data
    if (!msg || msg.tabId === tabId) return
    if (msg.type === 'store-update') {
      const listener = listeners.get(msg.store)
      if (listener) listener()
    }
  }
}

/**
 * Broadcast that a store was updated in this tab. Other tabs will
 * receive the message and reload the store from localStorage.
 */
export function broadcastStoreUpdate(store: string): void {
  try {
    channel?.postMessage({ type: 'store-update', store, tabId } satisfies StoreUpdateMessage)
  } catch {
    // Channel may be closed or in an error state — non-critical
  }
}

/**
 * Register a callback to be invoked when another tab updates a store.
 * Typically wired to a store's `_reloadFromStorage()` action.
 */
export function onStoreUpdate(store: string, callback: () => void): void {
  listeners.set(store, callback)
}

/**
 * Close the channel and remove all listeners. Call on app teardown.
 */
export function destroyBroadcastSync(): void {
  channel?.close()
  channel = null
  listeners.clear()
}
