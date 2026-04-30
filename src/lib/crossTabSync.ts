/**
 * Cross-tab data synchronization via BroadcastChannel.
 *
 * When a store persists to localStorage, it broadcasts a notification so other
 * tabs can reload fresh state without a Supabase round-trip. This prevents
 * stale data in multi-tab or PWA-window + browser-tab scenarios.
 *
 * Design:
 * - localStorage is the shared medium (already written by every store's _persist()).
 * - The channel carries lightweight "reload" signals, not full payloads.
 * - A receiving tab re-reads localStorage and patches its Pinia state.
 * - An `_isReloading` guard prevents echo broadcasts when a tab reloads.
 * - Sync queue operations are NOT re-triggered — only the originating tab syncs.
 */

import { logWarn } from './logger'

const CHANNEL_NAME = 'lift-sync'

type StoreId = 'workout' | 'bodyweight' | 'preferences' | 'progression'

interface SyncMessage {
  type: 'store-changed'
  store: StoreId
  /** Tab that originated the change (to ignore own messages). */
  tabId: string
}

/** Unique ID for this tab/window instance. */
const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

let _channel: BroadcastChannel | null = null
let _isReloading = false
let _reloadHandlers = new Map<StoreId, () => void>()

/**
 * Broadcast that a store was updated in this tab.
 * Called by each store's _persist() method.
 */
export function broadcastStoreChange(store: StoreId): void {
  if (_isReloading || !_channel) return
  try {
    _channel.postMessage({ type: 'store-changed', store, tabId: TAB_ID } satisfies SyncMessage)
  } catch {
    // Channel may be closed — non-critical, fail silently
  }
}

/**
 * Register a reload handler for a specific store.
 * Called once per store during app initialization.
 */
export function registerStoreReloader(store: StoreId, handler: () => void): void {
  _reloadHandlers.set(store, handler)
}

/**
 * Initialize the BroadcastChannel listener.
 * Call once at app startup (e.g., in main.ts or App.vue).
 */
export function initCrossTabSync(): void {
  if (typeof BroadcastChannel === 'undefined') return
  if (_channel) return // already initialized

  try {
    _channel = new BroadcastChannel(CHANNEL_NAME)
  } catch {
    logWarn('BroadcastChannel not available — cross-tab sync disabled')
    return
  }

  _channel.onmessage = (event: MessageEvent<SyncMessage>) => {
    const msg = event.data
    if (!msg || msg.type !== 'store-changed') return
    if (msg.tabId === TAB_ID) return // ignore own messages

    const handler = _reloadHandlers.get(msg.store)
    if (handler) {
      _isReloading = true
      try {
        handler()
      } finally {
        _isReloading = false
      }
    }
  }
}

/**
 * Close the channel. Called on sign-out or page unload if needed.
 */
export function closeCrossTabSync(): void {
  _channel?.close()
  _channel = null
  _reloadHandlers.clear()
}

/** Expose for testing. */
export function _getTabId(): string {
  return TAB_ID
}

/** Reset internal state for testing. */
export function _resetCrossTabSync(): void {
  _channel?.close()
  _channel = null
  _reloadHandlers = new Map()
  _isReloading = false
}
