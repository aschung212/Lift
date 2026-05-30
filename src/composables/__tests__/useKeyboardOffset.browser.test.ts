import { describe, it, expect, afterEach } from 'vitest'
import { useKeyboardOffset, type UseKeyboardOffsetReturn } from '../useKeyboardOffset'
import { mountComposable } from './browserMount'

/**
 * Browser-mode tests for useKeyboardOffset.
 *
 * The happy-dom suite (useKeyboardOffset.test.ts) has to vi.stubGlobal an
 * entire fake `visualViewport` because happy-dom does not implement the API at
 * all. Here we run in real Chromium where `window.visualViewport` genuinely
 * exists, so we validate that the composable wires to the real API and computes
 * a sane offset from actual viewport geometry rather than a hand-built stub.
 */
describe('useKeyboardOffset (browser)', () => {
  let mounted: { exposed: UseKeyboardOffsetReturn; unmount: () => void } | null = null

  afterEach(() => {
    mounted?.unmount()
    mounted = null
  })

  it('exposes the real visualViewport API (absent in happy-dom)', () => {
    expect(window.visualViewport).toBeInstanceOf(VisualViewport)
    expect(typeof window.visualViewport!.height).toBe('number')
  })

  it('starts at 0 and stays 0 with the keyboard closed (real viewport)', () => {
    mounted = mountComposable<UseKeyboardOffsetReturn>(() => useKeyboardOffset())
    expect(mounted.exposed.keyboardHeight.value).toBe(0)

    // Dispatch a genuine resize event on the real visualViewport. With no
    // keyboard, vv.height ≈ innerHeight, so the computed offset must be 0 —
    // and never negative (the Math.max(0, ...) guard) against real numbers.
    window.visualViewport!.dispatchEvent(new Event('resize'))
    expect(mounted.exposed.keyboardHeight.value).toBe(0)
  })

  it('recomputes a non-negative offset from real geometry on viewport scroll', () => {
    mounted = mountComposable<UseKeyboardOffsetReturn>(() => useKeyboardOffset())

    window.visualViewport!.dispatchEvent(new Event('scroll'))

    const h = mounted.exposed.keyboardHeight.value
    expect(h).toBeGreaterThanOrEqual(0)
    // Offset can never exceed the window height — sanity bound on real values.
    expect(h).toBeLessThanOrEqual(window.innerHeight)
  })
})
