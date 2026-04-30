/**
 * Cross-tab data synchronization via BroadcastChannel.
 *
 * When a store mutates data in one tab, this module broadcasts a notification
 * so other tabs can reload from localStorage. This prevents stale data across
 * tabs/PWA windows without requiring Supabase round-trips.
 *
 * Messages are typed and carry the store name so receivers can selectively
 * reload only the affected store.
 */

import { logWarn } from './logger'

// --- Types ---

export type CrossTabMessageType = 'store-update' | 'sw-update' | 'auth-change'

export interface CrossTabMessage {
  type: CrossTabMessageType
  /** Which store was updated (for store-update messages) */
  store?: string
  /** Tab that sent the message (to avoid echo) */
  senderId: string
}

type StoreReloadHandler = (storeName: string) => void

// --- State ---

let _channel: BroadcastChannel | null = null
const _senderId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
let _onStoreReload: StoreReloadHandler | null = null

// Debounce incoming reloads per store to avoid thrashing when a store
// persists multiple times in quick succession (e.g., bulk import).
const _reloadTimers = new Map<string, ReturnType<typeof setTimeout>>()
const RELOAD_DEBOUNCE_MS = 100

// --- Public API ---

/**
 * Initialize the cross-tab sync channel.
 * Call once at app startup (e.g., in App.vue mounted).
 *
 * @param onStoreReload — called when another tab updates a store.
 *   The handler receives the store name and should reload that store
 *   from localStorage.
 */
export function initCrossTabSync(onStoreReload: StoreReloadHandler): void {
  if (typeof BroadcastChannel === 'undefined') {
    // Graceful degradation: Capacitor WKWebView and some older browsers
    // don't support BroadcastChannel. Cross-tab sync is a nice-to-have.
    return
  }

  if (_channel) {
    // Already initialized (hot-reload guard)
    return
  }

  _onStoreReload = onStoreReload

  try {
    _channel = new BroadcastChannel('lift-sync')
    _channel.onmessage = _handleMessage
    _channel.onmessageerror = () => {
      logWarn('BroadcastChannel message error', { source: 'crossTabSync' })
    }
  } catch {
    // BroadcastChannel constructor can throw in restrictive contexts
    logWarn('Failed to create BroadcastChannel', { source: 'crossTabSync' })
  }
}

/**
 * Broadcast that a store was updated. Call after _persist() in each store.
 * Other tabs will reload the store from localStorage.
 */
export function broadcastStoreUpdate(storeName: string): void {
  _post({ type: 'store-update', store: storeName, senderId: _senderId })
}

/**
 * Broadcast that a service worker update is available.
 * All tabs can show a refresh prompt.
 */
export function broadcastSwUpdate(): void {
  _post({ type: 'sw-update', senderId: _senderId })
}

/**
 * Broadcast that auth state changed (sign-in/sign-out).
 * Other tabs should re-check auth and reinitialize stores.
 */
export function broadcastAuthChange(): void {
  _post({ type: 'auth-change', senderId: _senderId })
}

/**
 * Tear down the channel. Call on app unmount or sign-out cleanup.
 */
export function destroyCrossTabSync(): void {
  if (_channel) {
    _channel.close()
    _channel = null
  }
  _onStoreReload = null
  for (const timer of _reloadTimers.values()) clearTimeout(timer)
  _reloadTimers.clear()
}

// --- Internals ---

function _post(msg: CrossTabMessage): void {
  try {
    _channel?.postMessage(msg)
  } catch {
    // Channel can be closed or message uncloneable — non-critical
  }
}

function _handleMessage(event: MessageEvent<CrossTabMessage>): void {
  const msg = event.data
  if (!msg || typeof msg !== 'object' || !msg.type) return

  // Ignore our own messages
  if (msg.senderId === _senderId) return

  switch (msg.type) {
    case 'store-update': {
      if (!msg.store || !_onStoreReload) break
      // Debounce reloads for the same store
      const existing = _reloadTimers.get(msg.store)
      if (existing) clearTimeout(existing)
      const storeName = msg.store
      _reloadTimers.set(
        storeName,
        setTimeout(() => {
          _reloadTimers.delete(storeName)
          _onStoreReload?.(storeName)
        }, RELOAD_DEBOUNCE_MS),
      )
      break
    }
    case 'sw-update':
      // Re-dispatch as a custom event so App.vue can handle it
      // without coupling to BroadcastChannel directly
      window.dispatchEvent(new CustomEvent('lift-sw-update-broadcast'))
      break
    case 'auth-change':
      // Auth changed in another tab — reload to pick up new session
      window.location.reload()
      break
  }
}
