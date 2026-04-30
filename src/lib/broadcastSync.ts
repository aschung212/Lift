/**
 * Cross-tab data sync via BroadcastChannel.
 *
 * When a store persists to localStorage, it broadcasts the store name so
 * other open tabs/windows can reload from localStorage and stay in sync.
 *
 * This avoids the `storage` event's quirks (doesn't fire in the originating
 * tab, inconsistent across browsers in PWA standalone mode) and also lets us
 * broadcast non-storage events like SW update notifications.
 */

const CHANNEL_NAME = 'lift-sync'

/** Unique per-tab ID so we can ignore our own broadcasts. */
const TAB_ID = crypto.randomUUID()

export type SyncMessageType = 'store-update' | 'sw-update'

export interface SyncMessage {
  type: SyncMessageType
  /** Which store changed (e.g. 'workout', 'bodyweight', 'preferences', 'progression'). */
  store?: string
  /** Tab that sent the message — receivers ignore messages from themselves. */
  tabId: string
}

type StoreChangeHandler = (storeName: string) => void
type SWUpdateHandler = () => void

let _channel: BroadcastChannel | null = null
const _storeHandlers: StoreChangeHandler[] = []
const _swHandlers: SWUpdateHandler[] = []

function getChannel(): BroadcastChannel | null {
  if (_channel) return _channel
  if (typeof BroadcastChannel === 'undefined') return null

  try {
    _channel = new BroadcastChannel(CHANNEL_NAME)
    _channel.onmessage = (event: MessageEvent<SyncMessage>) => {
      const msg = event.data
      if (!msg || msg.tabId === TAB_ID) return

      if (msg.type === 'store-update' && msg.store) {
        for (const handler of _storeHandlers) handler(msg.store)
      } else if (msg.type === 'sw-update') {
        for (const handler of _swHandlers) handler()
      }
    }
    return _channel
  } catch {
    // BroadcastChannel may throw in some restricted contexts (e.g. opaque origins)
    return null
  }
}

/** Broadcast that a store's localStorage data has changed. */
export function broadcastStoreUpdate(storeName: string): void {
  const ch = getChannel()
  if (!ch) return
  const msg: SyncMessage = { type: 'store-update', store: storeName, tabId: TAB_ID }
  try { ch.postMessage(msg) } catch { /* channel may be closed */ }
}

/** Broadcast a service worker update notification to all tabs. */
export function broadcastSWUpdate(): void {
  const ch = getChannel()
  if (!ch) return
  const msg: SyncMessage = { type: 'sw-update', tabId: TAB_ID }
  try { ch.postMessage(msg) } catch { /* channel may be closed */ }
}

/** Register a handler for store changes from other tabs. Returns an unsubscribe function. */
export function onStoreUpdate(handler: StoreChangeHandler): () => void {
  getChannel() // ensure channel is initialized
  _storeHandlers.push(handler)
  return () => {
    const idx = _storeHandlers.indexOf(handler)
    if (idx !== -1) _storeHandlers.splice(idx, 1)
  }
}

/** Register a handler for SW update notifications from other tabs. Returns an unsubscribe function. */
export function onSWUpdate(handler: SWUpdateHandler): () => void {
  getChannel()
  _swHandlers.push(handler)
  return () => {
    const idx = _swHandlers.indexOf(handler)
    if (idx !== -1) _swHandlers.splice(idx, 1)
  }
}

/** Close the channel and clear handlers. Mainly for testing. */
export function closeBroadcastChannel(): void {
  if (_channel) {
    _channel.close()
    _channel = null
  }
  _storeHandlers.length = 0
  _swHandlers.length = 0
}
