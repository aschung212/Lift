/**
 * Cross-tab data synchronization via BroadcastChannel.
 *
 * When a store persists data to localStorage, it broadcasts a message so other
 * tabs can reload the updated state. This prevents data divergence when the app
 * is open in multiple tabs or a PWA window + browser tab.
 *
 * Messages include a sender ID so the originating tab ignores its own broadcasts.
 */
import { uuid } from '../lib/uuid'

const CHANNEL_NAME = 'lift-sync'

export type SyncStore = 'workout' | 'bodyweight' | 'preferences' | 'progression'

interface SyncMessage {
  /** Which store was updated */
  store: SyncStore
  /** Tab-unique ID to prevent self-handling */
  senderId: string
  /** Timestamp for debugging */
  ts: number
}

/** Unique ID for this tab instance */
const tabId = uuid()

let channel: BroadcastChannel | null = null

/** Registered handlers: store name → reload function */
const handlers = new Map<SyncStore, () => void>()

/**
 * Initialize the BroadcastChannel and start listening.
 * Safe to call multiple times — only creates the channel once.
 */
export function initCrossTabSync(): void {
  if (channel) return
  if (typeof BroadcastChannel === 'undefined') return // SSR or unsupported browser

  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (event: MessageEvent<SyncMessage>) => {
    const msg = event.data
    if (!msg || msg.senderId === tabId) return

    const handler = handlers.get(msg.store)
    if (handler) handler()
  }
}

/**
 * Register a reload handler for a store. When another tab persists to that
 * store, this handler will be called to reload state from localStorage.
 */
export function onCrossTabUpdate(store: SyncStore, handler: () => void): void {
  handlers.set(store, handler)
}

/**
 * Broadcast that a store was just persisted. Call this from _persist() methods.
 */
export function broadcastStoreUpdate(store: SyncStore): void {
  if (!channel) return

  const msg: SyncMessage = { store, senderId: tabId, ts: Date.now() }
  try {
    channel.postMessage(msg)
  } catch {
    // Channel may be closed if the page is being unloaded — safe to ignore
  }
}

/**
 * Close the channel. Call on app teardown if needed.
 */
export function closeCrossTabSync(): void {
  if (channel) {
    channel.close()
    channel = null
  }
  handlers.clear()
}
