/**
 * Cross-Tab Sync via BroadcastChannel
 *
 * When a store persists to localStorage, it broadcasts the affected store key
 * on a shared BroadcastChannel. Other tabs receive the message and reload
 * their state from localStorage (the source of truth).
 *
 * Design decisions:
 * - Payloads carry only the store key, not the data itself. localStorage is
 *   already written by the time the message arrives, so the receiver reads
 *   from there. This avoids large payloads and keeps localStorage authoritative.
 * - A `_tabId` field prevents echo: the broadcasting tab ignores its own messages.
 * - Messages within a short debounce window are coalesced per store key to
 *   avoid thrashing when rapid mutations fire (e.g. logging multiple sets).
 */

const CHANNEL_NAME = 'lift-sync'
const DEBOUNCE_MS = 100

type StoreKey = 'workout-exercises' | 'bodyweight-entries' | 'user-preferences' | 'user-progression'

interface SyncMessage {
  tabId: string
  storeKey: StoreKey
}

type ReloadHandler = (storeKey: StoreKey) => void

let _channel: BroadcastChannel | null = null
let _tabId: string = ''
let _handler: ReloadHandler | null = null
const _debounceTimers = new Map<StoreKey, ReturnType<typeof setTimeout>>()

/**
 * Initialize the cross-tab sync channel.
 * Call once on app startup (e.g. in App.vue onMounted).
 *
 * @param onReload — called when another tab persists a store.
 *   The callback receives the localStorage key that changed.
 */
export function initCrossTabSync(onReload: ReloadHandler): void {
  if (typeof BroadcastChannel === 'undefined') return
  if (_channel) return // already initialized

  _tabId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  _handler = onReload

  _channel = new BroadcastChannel(CHANNEL_NAME)
  _channel.onmessage = (event: MessageEvent<SyncMessage>) => {
    const { tabId, storeKey } = event.data
    if (tabId === _tabId) return // ignore own messages
    if (!_handler) return

    // Debounce per store key to coalesce rapid mutations
    const existing = _debounceTimers.get(storeKey)
    if (existing) clearTimeout(existing)
    _debounceTimers.set(
      storeKey,
      setTimeout(() => {
        _debounceTimers.delete(storeKey)
        _handler?.(storeKey)
      }, DEBOUNCE_MS),
    )
  }
}

/**
 * Broadcast that a store key was persisted to localStorage.
 * Call from each store's `_persist()` method after writing to localStorage.
 *
 * No-op if the channel is not initialized or BroadcastChannel is unavailable.
 */
export function broadcastStoreUpdate(storeKey: StoreKey): void {
  if (!_channel || !_tabId) return
  _channel.postMessage({ tabId: _tabId, storeKey } satisfies SyncMessage)
}

/**
 * Tear down the channel. Call on app unmount or in tests.
 */
export function destroyCrossTabSync(): void {
  _channel?.close()
  _channel = null
  _handler = null
  _tabId = ''
  for (const timer of _debounceTimers.values()) clearTimeout(timer)
  _debounceTimers.clear()
}

/** Visible for testing. */
export function _getTabId(): string {
  return _tabId
}
