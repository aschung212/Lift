/**
 * Cross-tab data synchronization via BroadcastChannel.
 *
 * When a store persists to localStorage in one tab, it broadcasts a message
 * so other tabs can reload that store's state without waiting for a manual
 * refresh or Supabase round-trip.
 *
 * Also propagates sync status and service-worker update signals.
 */

import { logWarn } from './logger'

// ---- Message types ----

export type SyncStatus = 'synced' | 'syncing' | 'error' | 'offline'

export type CrossTabMessage =
  | { type: 'store-update'; store: StoreKey; timestamp: number }
  | { type: 'sync-status'; status: SyncStatus; timestamp: number }
  | { type: 'sw-update'; timestamp: number }

export type StoreKey = 'workout' | 'bodyweight' | 'preferences' | 'progression'

// ---- Singleton channel ----

const CHANNEL_NAME = 'lift-sync'
let _channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (_channel) return _channel
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    _channel = new BroadcastChannel(CHANNEL_NAME)
  } catch {
    // BroadcastChannel unavailable (e.g. some Capacitor WebViews)
    logWarn('BroadcastChannel unavailable — cross-tab sync disabled')
  }
  return _channel
}

// ---- Broadcasting ----

/** Notify other tabs that a store was updated in localStorage. */
export function broadcastStoreUpdate(store: StoreKey): void {
  getChannel()?.postMessage({
    type: 'store-update',
    store,
    timestamp: Date.now(),
  } satisfies CrossTabMessage)
}

/** Notify other tabs of a sync status change. */
export function broadcastSyncStatus(status: SyncStatus): void {
  getChannel()?.postMessage({
    type: 'sync-status',
    status,
    timestamp: Date.now(),
  } satisfies CrossTabMessage)
}

/** Notify other tabs that a new service worker activated. */
export function broadcastSWUpdate(): void {
  getChannel()?.postMessage({
    type: 'sw-update',
    timestamp: Date.now(),
  } satisfies CrossTabMessage)
}

// ---- Listening ----

export type CrossTabHandler = (msg: CrossTabMessage) => void

/**
 * Register a listener for messages from other tabs.
 * Returns an unsubscribe function.
 */
export function onCrossTabMessage(handler: CrossTabHandler): () => void {
  const ch = getChannel()
  if (!ch) return () => {}

  const listener = (event: MessageEvent) => {
    const data = event.data as CrossTabMessage
    if (data && typeof data.type === 'string') {
      handler(data)
    }
  }
  ch.addEventListener('message', listener)
  return () => ch.removeEventListener('message', listener)
}

// ---- Cleanup (for tests) ----

export function _resetChannel(): void {
  _channel?.close()
  _channel = null
}
