/**
 * Cross-Tab Sync via BroadcastChannel
 *
 * Coordinates data between multiple browser tabs / PWA windows.
 * When one tab persists state, it broadcasts a lightweight notification
 * so other tabs can reload from localStorage.
 *
 * Messages are fire-and-forget — if no other tab is listening, the
 * message is silently dropped. The channel gracefully degrades to
 * a no-op when BroadcastChannel is unavailable (e.g. older browsers,
 * some Capacitor webviews).
 */

export type StoreName = 'workout' | 'bodyweight' | 'preferences' | 'progression'

export interface CrossTabMessage {
  type: 'store-updated'
  store: StoreName
  /** Tab ID that sent the message — used to ignore own broadcasts */
  sender: string
  timestamp: number
}

const CHANNEL_NAME = 'lift-sync'

/** Unique ID for this tab — prevents reacting to own broadcasts */
const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (channel) return channel
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    return channel
  } catch {
    return null
  }
}

/**
 * Notify other tabs that a store was updated.
 * Call this after persisting to localStorage.
 */
export function broadcastStoreUpdate(store: StoreName): void {
  const ch = getChannel()
  if (!ch) return
  const msg: CrossTabMessage = {
    type: 'store-updated',
    store,
    sender: TAB_ID,
    timestamp: Date.now(),
  }
  try {
    ch.postMessage(msg)
  } catch {
    // Channel closed or serialization error — ignore
  }
}

/**
 * Listen for store updates from other tabs.
 * Returns a cleanup function to remove the listener.
 */
export function onCrossTabUpdate(callback: (store: StoreName) => void): () => void {
  const ch = getChannel()
  if (!ch) return () => {}

  const handler = (event: MessageEvent) => {
    const msg = event.data as CrossTabMessage
    if (msg?.type !== 'store-updated') return
    if (msg.sender === TAB_ID) return // ignore own messages
    callback(msg.store)
  }
  ch.addEventListener('message', handler)
  return () => ch.removeEventListener('message', handler)
}

/** Close the channel. Call on app unmount. */
export function closeCrossTabChannel(): void {
  if (channel) {
    channel.close()
    channel = null
  }
}
