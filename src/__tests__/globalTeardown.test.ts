/**
 * Regression coverage for the global afterEach teardown in setup.ts (LIFT-966).
 *
 * The global hook exists so test isolation is the default rather than a per-file
 * responsibility. These tests deliberately DIRTY shared state (localStorage,
 * mock call history, fake timers) in one `it` and assert the *next* `it` starts
 * clean — proving the teardown ran in between. If a future edit drops any line
 * from the global afterEach, one of these ordered assertions fails.
 *
 * Ordering matters: Vitest runs `it` blocks in source order, so the "leave dirty"
 * test must precede its "starts clean" partner.
 */
import { describe, it, expect, vi } from 'vitest'

describe('global test teardown (setup.ts)', () => {
  describe('localStorage isolation', () => {
    it('writes a key without cleaning up', () => {
      localStorage.setItem('leaked-key', 'dirty')
      expect(localStorage.getItem('leaked-key')).toBe('dirty')
    })

    it('does not inherit the previous test\'s localStorage entry', () => {
      expect(localStorage.getItem('leaked-key')).toBeNull()
    })
  })

  describe('mock call-history isolation', () => {
    const spy = vi.fn()

    it('accumulates calls without clearing them', () => {
      spy('a')
      spy('b')
      expect(spy).toHaveBeenCalledTimes(2)
    })

    it('sees cleared call history in the next test', () => {
      expect(spy).toHaveBeenCalledTimes(0)
    })
  })

  describe('fake-timer isolation', () => {
    it('arms fake timers and deliberately never restores them', () => {
      vi.useFakeTimers()
      expect(vi.isFakeTimers()).toBe(true)
    })

    it('starts the next test on real timers despite the leak above', () => {
      expect(vi.isFakeTimers()).toBe(false)
    })
  })
})
