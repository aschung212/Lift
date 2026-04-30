/**
 * Cross-tab data synchronization via BroadcastChannel.
 *
 * When a store calls `_persist()` and writes to localStorage, it also
 * broadcasts a message on the `lift-sync` channel. Other tabs listening
 * on the same channel reload the affected store's data from localStorage,
 * keeping all open instances in sync without manual refresh.
 *
 * Also propagates service-worker update notifications so all tabs can
 * show the "new version available" prompt simultaneously.
 */

/** Message types that can be sent on the channel. */
export interface CrossTabMessage {
  type: 'store-update' | 'sw-update'
  /** Which store changed (matches localStorage key). */
  store?: string
  /** Tab that originated the message (to avoid self-handling). */
  source: string
  /** Timestamp of the change. */
  timestamp: number
}

/** Unique ID for this tab, used to ignore self-broadcasts. */
const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

let channel: BroadcastChannel | null = null

/** Registered reload callbacks keyed by store name. */
const listeners = new Map<string, () => void>()

/** Callback for SW update notifications. */
let swUpdateCallback: (() => void) | null = null

/**
 * Initialize the BroadcastChannel and start listening.
 * Safe to call multiple times — subsequent calls are no-ops.
 * Returns false if BroadcastChannel is not supported (e.g. some Capacitor WebViews).
 */
export function initCrossTabSync(): boolean {
  if (channel) return true
  if (typeof BroadcastChannel === 'undefined') return false

  channel = new BroadcastChannel('lift-sync')
  channel.onmessage = (event: MessageEvent<CrossTabMessage>) => {
    const msg = event.data
    if (!msg || msg.source === TAB_ID) return

    if (msg.type === 'store-update' && msg.store) {
      const reload = listeners.get(msg.store)
      if (reload) reload()
    } else if (msg.type === 'sw-update') {
      if (swUpdateCallback) swUpdateCallback()
    }
  }

  return true
}

/**
 * Broadcast that a store's localStorage data has changed.
 * Called from each store's `_persist()` method.
 */
export function broadcastStoreUpdate(storeName: string): void {
  if (!channel) return
  const msg: CrossTabMessage = {
    type: 'store-update',
    store: storeName,
    source: TAB_ID,
    timestamp: Date.now(),
  }
  try {
    channel.postMessage(msg)
  } catch {
    // Channel may be closed — silently ignore
  }
}

/**
 * Broadcast that a new service worker version is available.
 * Called from the SW registration/update handler.
 */
export function broadcastSwUpdate(): void {
  if (!channel) return
  const msg: CrossTabMessage = {
    type: 'sw-update',
    source: TAB_ID,
    timestamp: Date.now(),
  }
  try {
    channel.postMessage(msg)
  } catch {
    // Channel may be closed — silently ignore
  }
}

/**
 * Register a callback to reload a store's state from localStorage
 * when another tab broadcasts an update.
 */
export function onStoreUpdate(storeName: string, reload: () => void): void {
  listeners.set(storeName, reload)
}

/**
 * Register a callback for SW update notifications from other tabs.
 */
export function onSwUpdate(callback: () => void): void {
  swUpdateCallback = callback
}

/**
 * Close the channel and clean up. Primarily for testing.
 */
export function destroyCrossTabSync(): void {
  if (channel) {
    channel.close()
    channel = null
  }
  listeners.clear()
  swUpdateCallback = null
}
