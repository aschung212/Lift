/**
 * Cross-tab data synchronization via BroadcastChannel.
 *
 * When a Pinia store persists to localStorage in one tab, it broadcasts
 * a lightweight message so other tabs can reload the updated state.
 * This prevents stale data when multiple tabs (or a PWA window + browser
 * tab) are open simultaneously.
 *
 * Design:
 * - Each tab has a unique ID to ignore its own broadcasts
 * - Messages carry the store name; the receiving tab reloads from localStorage
 * - No Supabase round-trips — localStorage is the shared medium
 * - Gracefully degrades: BroadcastChannel is unavailable in some contexts
 *   (e.g., older browsers, some Capacitor webviews)
 */

export type SyncableStore = 'workout' | 'bodyweight' | 'preferences' | 'progression'

interface SyncMessage {
  type: 'store-update'
  store: SyncableStore
  tabId: string
}

const TAB_ID = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2)

const CHANNEL_NAME = 'lift-sync'

let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (channel) return channel
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    return channel
  } catch {
    // SecurityError in some contexts (e.g., opaque origins)
    return null
  }
}

/**
 * Broadcast that a store was updated in this tab.
 * Called from each store's `_persist()` method.
 */
export function broadcastStoreUpdate(store: SyncableStore): void {
  const ch = getChannel()
  if (!ch) return
  const msg: SyncMessage = { type: 'store-update', store, tabId: TAB_ID }
  try {
    ch.postMessage(msg)
  } catch {
    // Channel may be closed or in an error state
  }
}

/**
 * Listen for cross-tab store updates. Returns an unsubscribe function.
 * The callback receives the store name that was updated in another tab.
 * Messages from this tab are automatically filtered out.
 */
export function onCrossTabUpdate(callback: (store: SyncableStore) => void): () => void {
  const ch = getChannel()
  if (!ch) return () => {}

  const handler = (event: MessageEvent<SyncMessage>) => {
    const data = event.data
    if (!data || data.type !== 'store-update') return
    if (data.tabId === TAB_ID) return
    callback(data.store)
  }

  ch.addEventListener('message', handler)
  return () => ch.removeEventListener('message', handler)
}

/**
 * Close the channel. Called during cleanup (e.g., sign-out, tests).
 */
export function closeSyncChannel(): void {
  if (channel) {
    channel.close()
    channel = null
  }
}
