/**
 * useManagedTimers — scope-aware setTimeout / setInterval wrappers.
 *
 * Timers registered through this helper are tracked and cleared automatically
 * when the owning reactive scope is disposed (component unmount or effectScope
 * stop). This closes the class of leak where a composable schedules a timer but
 * never pairs it with an onUnmounted/onScopeDispose cleanup, so the callback
 * fires against torn-down state after the component is gone (see LIFT-877).
 *
 * Use these in place of the global `setTimeout`/`setInterval` inside any
 * composable that owns timers. New composables then inherit cleanup by default
 * instead of hand-rolling (and forgetting) it.
 *
 * The scope hook is registered lazily and guarded by `getCurrentScope()`, so
 * the helper is safe to call from module init or plain unit tests where no
 * component/effect scope is active — in that case timers simply are not
 * auto-cleared (call `clearAll()` manually if needed).
 */

import { getCurrentScope, onScopeDispose } from 'vue'

export interface ManagedTimers {
  /** Schedule a self-untracking timeout. Returns the timer id. */
  setTimeout: (handler: () => void, timeout?: number) => ReturnType<typeof setTimeout>
  /** Clear a timeout created via this helper (no-op for null/undefined). */
  clearTimeout: (id: ReturnType<typeof setTimeout> | null | undefined) => void
  /** Schedule a tracked interval. Returns the timer id. */
  setInterval: (handler: () => void, timeout?: number) => ReturnType<typeof setInterval>
  /** Clear an interval created via this helper (no-op for null/undefined). */
  clearInterval: (id: ReturnType<typeof setInterval> | null | undefined) => void
  /** Clear every outstanding timeout and interval. Runs automatically on scope disposal. */
  clearAll: () => void
}

export function useManagedTimers(): ManagedTimers {
  const timeouts = new Set<ReturnType<typeof setTimeout>>()
  const intervals = new Set<ReturnType<typeof setInterval>>()

  function _setTimeout(handler: () => void, timeout?: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      timeouts.delete(id)
      handler()
    }, timeout)
    timeouts.add(id)
    return id
  }

  function _clearTimeout(id: ReturnType<typeof setTimeout> | null | undefined): void {
    if (id === null || id === undefined) return
    clearTimeout(id)
    timeouts.delete(id)
  }

  function _setInterval(handler: () => void, timeout?: number): ReturnType<typeof setInterval> {
    const id = setInterval(handler, timeout)
    intervals.add(id)
    return id
  }

  function _clearInterval(id: ReturnType<typeof setInterval> | null | undefined): void {
    if (id === null || id === undefined) return
    clearInterval(id)
    intervals.delete(id)
  }

  function clearAll(): void {
    for (const id of timeouts) clearTimeout(id)
    timeouts.clear()
    for (const id of intervals) clearInterval(id)
    intervals.clear()
  }

  // Auto-clear when the owning scope is disposed. Guarded so calling outside a
  // component/effect scope does not emit Vue's "onScopeDispose() called when
  // there is no active effect scope" warning.
  if (getCurrentScope()) {
    onScopeDispose(clearAll)
  }

  return {
    setTimeout: _setTimeout,
    clearTimeout: _clearTimeout,
    setInterval: _setInterval,
    clearInterval: _clearInterval,
    clearAll,
  }
}
