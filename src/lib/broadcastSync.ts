/**
 * Cross-tab data synchronization via BroadcastChannel.
 *
 * When a store calls `_persist()`, it also calls `broadcastStoreUpdate(storeName)`
 * to notify other tabs that localStorage has changed. The receiving tab re-reads
 * localStorage to update its Pinia state — no Supabase round-trip needed.
 *
 * Also broadcasts sync status changes and SW update readiness across tabs.
 *
 * Guards against missing BroadcastChannel API (older Safari, some WebViews)
 * by silently no-oping when unavailable.
 */

export type SyncStatusValue = 'synced' | 'syncing' | 'error' | 'offline'

// Unique per-tab ID to avoid processing our own messages
const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export type BroadcastMessage =
  | { type: 'store-update'; store: string; tabId: string }
  | { type: 'sync-status'; status: SyncStatusValue; tabId: string }
  | { type: 'sw-update'; tabId: string }

type StoreUpdateHandler = (store: string) => void
type SyncStatusHandler = (status: SyncStatusValue) => void
type SWUpdateHandler = () => void

let channel: BroadcastChannel | null = null
let storeUpdateHandler: StoreUpdateHandler | null = null
let syncStatusHandler: SyncStatusHandler | null = null
let swUpdateHandler: SWUpdateHandler | null = null

function getChannel(): BroadcastChannel | null {
  if (channel) return channel
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    channel = new BroadcastChannel('lift-sync')
    channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
      const msg = event.data
      if (!msg || msg.tabId === TAB_ID) return

      switch (msg.type) {
        case 'store-update':
          storeUpdateHandler?.(msg.store)
          break
        case 'sync-status':
          syncStatusHandler?.(msg.status)
          break
        case 'sw-update':
          swUpdateHandler?.()
          break
      }
    }
    return channel
  } catch {
    // BroadcastChannel constructor can throw in restricted contexts
    return null
  }
}

/**
 * Notify other tabs that a store's localStorage data has changed.
 * Call this from `_persist()` in each store.
 */
export function broadcastStoreUpdate(store: string): void {
  getChannel()?.postMessage({
    type: 'store-update',
    store,
    tabId: TAB_ID,
  } satisfies BroadcastMessage)
}

/**
 * Notify other tabs of a sync status change.
 */
export function broadcastSyncStatus(status: SyncStatusValue): void {
  getChannel()?.postMessage({
    type: 'sync-status',
    status,
    tabId: TAB_ID,
  } satisfies BroadcastMessage)
}

/**
 * Notify other tabs that a new service worker is ready.
 */
export function broadcastSWUpdate(): void {
  getChannel()?.postMessage({
    type: 'sw-update',
    tabId: TAB_ID,
  } satisfies BroadcastMessage)
}

/**
 * Register handlers for incoming broadcast messages.
 * Should be called once during app initialization (e.g., in App.vue setup).
 */
export function onBroadcast(handlers: {
  onStoreUpdate?: StoreUpdateHandler
  onSyncStatus?: SyncStatusHandler
  onSWUpdate?: SWUpdateHandler
}): void {
  if (handlers.onStoreUpdate) storeUpdateHandler = handlers.onStoreUpdate
  if (handlers.onSyncStatus) syncStatusHandler = handlers.onSyncStatus
  if (handlers.onSWUpdate) swUpdateHandler = handlers.onSWUpdate
  // Ensure the channel is initialized so the onmessage handler is set
  getChannel()
}

/**
 * Close the channel and clear handlers. Useful for cleanup in tests.
 */
export function closeBroadcastChannel(): void {
  channel?.close()
  channel = null
  storeUpdateHandler = null
  syncStatusHandler = null
  swUpdateHandler = null
}

/** Expose tab ID for testing */
export const _tabId = TAB_ID
