/**
 * Cross-Tab Sync via BroadcastChannel
 *
 * When a store persists to localStorage, it broadcasts a message to other
 * open tabs/windows via BroadcastChannel. Receiving tabs reload the updated
 * store from localStorage so all instances stay in sync without waiting for
 * the next Supabase round-trip.
 *
 * Also propagates service worker update notifications across tabs.
 */

const CHANNEL_NAME = 'lift-sync'

export type CrossTabMessage =
  | { type: 'store-update'; store: string; timestamp: number }
  | { type: 'sw-update'; timestamp: number }

type StoreUpdateHandler = (store: string) => void

let _channel: BroadcastChannel | null = null
let _handler: StoreUpdateHandler | null = null

function getChannel(): BroadcastChannel | null {
  if (_channel) return _channel

  if (typeof BroadcastChannel === 'undefined') return null

  try {
    _channel = new BroadcastChannel(CHANNEL_NAME)
  } catch {
    // BroadcastChannel not supported (e.g. some WebViews)
    return null
  }

  return _channel
}

/**
 * Broadcast that a store was updated. Call this after `_persist()` in each store.
 * Other tabs will receive the message and reload from localStorage.
 */
export function broadcastStoreUpdate(store: string): void {
  const channel = getChannel()
  if (!channel) return

  const message: CrossTabMessage = {
    type: 'store-update',
    store,
    timestamp: Date.now(),
  }

  try {
    channel.postMessage(message)
  } catch {
    // Channel closed or errored — non-critical
  }
}

/**
 * Broadcast a service worker update notification to all tabs.
 */
export function broadcastSWUpdate(): void {
  const channel = getChannel()
  if (!channel) return

  const message: CrossTabMessage = {
    type: 'sw-update',
    timestamp: Date.now(),
  }

  try {
    channel.postMessage(message)
  } catch {
    // Channel closed or errored — non-critical
  }
}

/**
 * Start listening for cross-tab messages. Call once during app initialization.
 *
 * @param onStoreUpdate — called when another tab updates a store. The handler
 *   should reload the named store from localStorage.
 * @param onSWUpdate — optional callback for service worker update notifications.
 */
export function startCrossTabListener(
  onStoreUpdate: StoreUpdateHandler,
  onSWUpdate?: () => void,
): void {
  const channel = getChannel()
  if (!channel) return

  _handler = onStoreUpdate

  channel.onmessage = (event: MessageEvent<CrossTabMessage>) => {
    const msg = event.data
    if (!msg || typeof msg !== 'object' || !msg.type) return

    if (msg.type === 'store-update' && _handler) {
      _handler(msg.store)
    } else if (msg.type === 'sw-update' && onSWUpdate) {
      onSWUpdate()
    }
  }
}

/**
 * Stop listening and close the channel. Call on app teardown or test cleanup.
 */
export function stopCrossTabListener(): void {
  _handler = null
  if (_channel) {
    _channel.onmessage = null
    _channel.close()
    _channel = null
  }
}

/** Reset internal state (for testing only). */
export function _resetCrossTabSync(): void {
  stopCrossTabListener()
}
