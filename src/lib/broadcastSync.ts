/**
 * Cross-tab data synchronization via BroadcastChannel.
 *
 * When a store persists to localStorage, it broadcasts a message so other
 * open tabs/PWA windows can reload the updated data without a manual refresh.
 *
 * Message types:
 * - store-update: a Pinia store wrote new data to localStorage
 * - theme-update: theme or settings changed via useTheme
 * - auth-signout: user signed out — other tabs should also sign out
 */

const CHANNEL_NAME = 'lift-sync'

export type BroadcastMessageType = 'store-update' | 'theme-update' | 'auth-signout'

export interface BroadcastMessage {
  type: BroadcastMessageType
  /** Which store or setting changed (e.g. 'workout', 'bodyweight', 'theme') */
  source: string
  /** Timestamp of the broadcast */
  ts: number
}

type MessageHandler = (msg: BroadcastMessage) => void

let _channel: BroadcastChannel | null = null
const _handlers = new Set<MessageHandler>()

function _getChannel(): BroadcastChannel | null {
  if (_channel) return _channel
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    _channel = new BroadcastChannel(CHANNEL_NAME)
    _channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
      for (const handler of _handlers) {
        handler(event.data)
      }
    }
    return _channel
  } catch {
    // BroadcastChannel not supported (e.g. some WebView environments)
    return null
  }
}

/** Broadcast a store update to other tabs. */
export function broadcastStoreUpdate(source: string): void {
  _getChannel()?.postMessage({
    type: 'store-update',
    source,
    ts: Date.now(),
  } satisfies BroadcastMessage)
}

/** Broadcast a theme/settings update to other tabs. */
export function broadcastThemeUpdate(source: string): void {
  _getChannel()?.postMessage({
    type: 'theme-update',
    source,
    ts: Date.now(),
  } satisfies BroadcastMessage)
}

/** Broadcast a sign-out event so other tabs also sign out. */
export function broadcastSignOut(): void {
  _getChannel()?.postMessage({
    type: 'auth-signout',
    source: 'auth',
    ts: Date.now(),
  } satisfies BroadcastMessage)
}

/** Register a handler for incoming cross-tab messages. */
export function onBroadcast(handler: MessageHandler): () => void {
  _handlers.add(handler)
  // Ensure channel is initialized
  _getChannel()
  return () => {
    _handlers.delete(handler)
  }
}

/** Close the channel (for cleanup in tests or unmount). */
export function closeBroadcastChannel(): void {
  if (_channel) {
    _channel.close()
    _channel = null
  }
  _handlers.clear()
}
