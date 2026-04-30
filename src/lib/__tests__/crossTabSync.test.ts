import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  broadcastStoreUpdate,
  broadcastSWUpdate,
  startCrossTabListener,
  stopCrossTabListener,
  _resetCrossTabSync,
  type CrossTabMessage,
} from '../crossTabSync'

// ── Mock BroadcastChannel ───────────────────────────────────────

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = []
  name: string
  onmessage: ((event: MessageEvent) => void) | null = null
  closed = false
  posted: CrossTabMessage[] = []

  constructor(name: string) {
    this.name = name
    MockBroadcastChannel.instances.push(this)
  }

  postMessage(msg: CrossTabMessage) {
    if (this.closed) throw new Error('Channel is closed')
    this.posted.push(msg)
    // Simulate delivery to other instances (not self)
    for (const instance of MockBroadcastChannel.instances) {
      if (instance !== this && instance.name === this.name && !instance.closed && instance.onmessage) {
        instance.onmessage(new MessageEvent('message', { data: msg }))
      }
    }
  }

  close() {
    this.closed = true
    MockBroadcastChannel.instances = MockBroadcastChannel.instances.filter(i => i !== this)
  }
}

beforeEach(() => {
  MockBroadcastChannel.instances = []
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
  _resetCrossTabSync()
})

afterEach(() => {
  _resetCrossTabSync()
  vi.unstubAllGlobals()
})

describe('crossTabSync', () => {
  describe('broadcastStoreUpdate', () => {
    it('posts a store-update message to the channel', () => {
      broadcastStoreUpdate('workout')
      const instance = MockBroadcastChannel.instances[0]
      expect(instance).toBeDefined()
      expect(instance.posted).toHaveLength(1)
      expect(instance.posted[0]).toMatchObject({
        type: 'store-update',
        store: 'workout',
      })
      expect(instance.posted[0].timestamp).toBeGreaterThan(0)
    })

    it('reuses the same channel across multiple calls', () => {
      broadcastStoreUpdate('workout')
      broadcastStoreUpdate('bodyweight')
      expect(MockBroadcastChannel.instances).toHaveLength(1)
      expect(MockBroadcastChannel.instances[0].posted).toHaveLength(2)
    })
  })

  describe('broadcastSWUpdate', () => {
    it('posts an sw-update message', () => {
      broadcastSWUpdate()
      const instance = MockBroadcastChannel.instances[0]
      expect(instance.posted[0]).toMatchObject({ type: 'sw-update' })
    })
  })

  describe('startCrossTabListener', () => {
    it('calls onStoreUpdate when another tab broadcasts a store update', () => {
      const handler = vi.fn()
      startCrossTabListener(handler)

      // Simulate a broadcast from "another tab" by creating a second channel
      const otherTab = new MockBroadcastChannel('lift-sync')
      otherTab.postMessage({ type: 'store-update', store: 'bodyweight', timestamp: Date.now() })

      expect(handler).toHaveBeenCalledWith('bodyweight')
    })

    it('calls onSWUpdate when another tab broadcasts a sw-update', () => {
      const storeHandler = vi.fn()
      const swHandler = vi.fn()
      startCrossTabListener(storeHandler, swHandler)

      const otherTab = new MockBroadcastChannel('lift-sync')
      otherTab.postMessage({ type: 'sw-update', timestamp: Date.now() })

      expect(storeHandler).not.toHaveBeenCalled()
      expect(swHandler).toHaveBeenCalled()
    })

    it('ignores malformed messages', () => {
      const handler = vi.fn()
      startCrossTabListener(handler)

      // Get the listener's channel and fire bad messages at it
      const listenerChannel = MockBroadcastChannel.instances[0]
      listenerChannel.onmessage?.(new MessageEvent('message', { data: null }))
      listenerChannel.onmessage?.(new MessageEvent('message', { data: 'not an object' }))
      listenerChannel.onmessage?.(new MessageEvent('message', { data: { type: 'unknown' } }))

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('stopCrossTabListener', () => {
    it('closes the channel and clears the handler', () => {
      const handler = vi.fn()
      startCrossTabListener(handler)

      const channel = MockBroadcastChannel.instances[0]
      stopCrossTabListener()

      expect(channel.closed).toBe(true)
      expect(channel.onmessage).toBeNull()
    })
  })

  describe('graceful degradation', () => {
    it('does nothing when BroadcastChannel is unavailable', () => {
      vi.stubGlobal('BroadcastChannel', undefined)
      _resetCrossTabSync()

      // These should not throw
      expect(() => broadcastStoreUpdate('workout')).not.toThrow()
      expect(() => broadcastSWUpdate()).not.toThrow()

      const handler = vi.fn()
      expect(() => startCrossTabListener(handler)).not.toThrow()
    })
  })

  describe('store integration — broadcast calls from _persist', () => {
    it('workout store imports and calls broadcastStoreUpdate', async () => {
      // Structural: verify the import exists in the store file
      const workoutSrc = await import('../../stores/workout?raw')
      expect(workoutSrc.default).toContain("broadcastStoreUpdate('workout')")
    })

    it('bodyweight store imports and calls broadcastStoreUpdate', async () => {
      const bwSrc = await import('../../stores/bodyweight?raw')
      expect(bwSrc.default).toContain("broadcastStoreUpdate('bodyweight')")
    })

    it('preferences store imports and calls broadcastStoreUpdate', async () => {
      const prefsSrc = await import('../../stores/preferences?raw')
      expect(prefsSrc.default).toContain("broadcastStoreUpdate('preferences')")
    })

    it('progression store imports and calls broadcastStoreUpdate', async () => {
      const progSrc = await import('../../stores/progression?raw')
      expect(progSrc.default).toContain("broadcastStoreUpdate('progression')")
    })
  })
})
