/**
 * Cross-tab data synchronization via BroadcastChannel.
 *
 * When a store calls `_persist()` to write to localStorage, it also
 * broadcasts a message on the `lift-sync` channel. Other tabs listen
 * for these messages and reload the affected store from localStorage,
 * keeping all open instances in sync without a full page reload.
 *
 * The channel also propagates service worker update notifications
 * so all tabs can prompt the user simultaneously.
 */

import { logWarn } from './logger'

// Store names that can be broadcast
export type SyncStoreName = 'workout' | 'bodyweight' | 'preferences' | 'progression'

export interface CrossTabMessage {
  /** Which store was mutated. */
  store: SyncStoreName
  /** ISO timestamp of the mutation — used to detect stale messages. */
  timestamp: string
  /** Tab identifier — used to ignore self-broadcasts. */
  senderId: string
}

// Unique ID for this tab instance — prevents reloading our own writes
const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

let _channel: BroadcastChannel | null = null
const _listeners = new Map<SyncStoreName, () => void>()

function _getChannel(): BroadcastChannel | null {
  if (_channel) return _channel
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    _channel = new BroadcastChannel('lift-sync')
    _channel.onmessage = (event: MessageEvent<CrossTabMessage>) => {
      const { store, senderId } = event.data
      if (senderId === TAB_ID) return // ignore own broadcasts
      const handler = _listeners.get(store)
      if (handler) {
        handler()
      }
    }
    _channel.onmessageerror = () => {
      logWarn('BroadcastChannel message deserialization error')
    }
  } catch {
    // BroadcastChannel not supported or blocked — degrade silently
    return null
  }
  return _channel
}

/**
 * Broadcast that a store was just persisted to localStorage.
 * Called from each store's `_persist()` action.
 */
export function broadcastChange(store: SyncStoreName): void {
  const ch = _getChannel()
  if (!ch) return
  const message: CrossTabMessage = {
    store,
    timestamp: new Date().toISOString(),
    senderId: TAB_ID,
  }
  try {
    ch.postMessage(message)
  } catch {
    // Channel may be closed — degrade silently
  }
}

/**
 * Register a callback to run when another tab mutates the given store.
 * The callback should re-read localStorage and update Pinia state.
 */
export function onCrossTabChange(store: SyncStoreName, handler: () => void): void {
  _listeners.set(store, handler)
  // Ensure the channel is initialized
  _getChannel()
}

/**
 * Close the channel and clear all listeners. Used in tests and cleanup.
 */
export function closeCrossTabSync(): void {
  _listeners.clear()
  if (_channel) {
    _channel.close()
    _channel = null
  }
}

/** Expose TAB_ID for testing. */
export function _getTabId(): string {
  return TAB_ID
}
