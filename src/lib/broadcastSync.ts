/**
 * Cross-tab data synchronization via BroadcastChannel.
 *
 * When a store persists to localStorage, it broadcasts a message to other
 * open tabs/PWA instances so they can reload their state. This prevents
 * stale data when the same user has multiple tabs open.
 *
 * Falls back gracefully in environments without BroadcastChannel support
 * (e.g., older browsers, some Capacitor WebViews).
 */

export type SyncMessage = {
  type: 'store-update'
  store: string
  timestamp: number
}

let channel: BroadcastChannel | null = null
const listeners = new Map<string, () => void>()

function getChannel(): BroadcastChannel | null {
  if (channel) return channel
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    channel = new BroadcastChannel('lift-sync')
    channel.onmessage = (event: MessageEvent<SyncMessage>) => {
      const msg = event.data
      if (msg?.type === 'store-update' && msg.store) {
        const handler = listeners.get(msg.store)
        if (handler) handler()
      }
    }
    return channel
  } catch {
    // BroadcastChannel not available (e.g., insecure context)
    return null
  }
}

/**
 * Notify other tabs that a store has been updated.
 * Call this after persisting to localStorage.
 */
export function broadcastStoreUpdate(store: string): void {
  const ch = getChannel()
  if (!ch) return
  const msg: SyncMessage = {
    type: 'store-update',
    store,
    timestamp: Date.now()
  }
  try {
    ch.postMessage(msg)
  } catch {
    // Channel may be closed — ignore
  }
}

/**
 * Register a handler to be called when another tab updates a store.
 * The handler should reload state from localStorage.
 */
export function onStoreUpdate(store: string, handler: () => void): void {
  getChannel() // ensure channel is initialized
  listeners.set(store, handler)
}

/**
 * Remove a previously registered handler.
 */
export function offStoreUpdate(store: string): void {
  listeners.delete(store)
}

/**
 * Close the channel (for cleanup in tests or unmount).
 */
export function closeBroadcastChannel(): void {
  if (channel) {
    channel.close()
    channel = null
  }
  listeners.clear()
}
