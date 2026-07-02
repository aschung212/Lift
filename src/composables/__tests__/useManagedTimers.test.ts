import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, effectScope } from 'vue'
import { useManagedTimers, type ManagedTimers } from '../useManagedTimers'

/**
 * Mount a throwaway component that exposes a ManagedTimers instance created in
 * its setup scope, so we can assert timers are cleared on unmount (#877).
 */
function mountWithTimers() {
  let timers!: ManagedTimers
  const wrapper = mount(
    defineComponent({
      setup() {
        timers = useManagedTimers()
        return () => null
      },
    }),
  )
  return { wrapper, get timers() { return timers } }
}

describe('useManagedTimers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires a managed timeout like a normal setTimeout', () => {
    const { wrapper, timers } = mountWithTimers()
    const cb = vi.fn()
    timers.setTimeout(cb, 100)
    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(cb).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('fires a managed interval repeatedly', () => {
    const { wrapper, timers } = mountWithTimers()
    const cb = vi.fn()
    timers.setInterval(cb, 50)
    vi.advanceTimersByTime(150)
    expect(cb).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })

  it('clears a pending timeout on component unmount', () => {
    const { wrapper, timers } = mountWithTimers()
    const cb = vi.fn()
    timers.setTimeout(cb, 100)
    wrapper.unmount()
    vi.advanceTimersByTime(200)
    expect(cb).not.toHaveBeenCalled()
  })

  it('stops a running interval on component unmount', () => {
    const { wrapper, timers } = mountWithTimers()
    const cb = vi.fn()
    timers.setInterval(cb, 50)
    vi.advanceTimersByTime(50)
    expect(cb).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    vi.advanceTimersByTime(500)
    // No further ticks after unmount
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('clearTimeout cancels a specific timer and is a no-op for null', () => {
    const { wrapper, timers } = mountWithTimers()
    const cb = vi.fn()
    const id = timers.setTimeout(cb, 100)
    timers.clearTimeout(id)
    timers.clearTimeout(null)
    timers.clearTimeout(undefined)
    vi.advanceTimersByTime(200)
    expect(cb).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('clearInterval cancels a specific interval', () => {
    const { wrapper, timers } = mountWithTimers()
    const cb = vi.fn()
    const id = timers.setInterval(cb, 50)
    vi.advanceTimersByTime(50)
    timers.clearInterval(id)
    vi.advanceTimersByTime(500)
    expect(cb).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('clearAll clears every outstanding timer', () => {
    const { wrapper, timers } = mountWithTimers()
    const t = vi.fn()
    const i = vi.fn()
    timers.setTimeout(t, 100)
    timers.setInterval(i, 50)
    timers.clearAll()
    vi.advanceTimersByTime(500)
    expect(t).not.toHaveBeenCalled()
    expect(i).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('auto-clears when its effectScope is stopped', () => {
    const cb = vi.fn()
    const scope = effectScope()
    scope.run(() => {
      const timers = useManagedTimers()
      timers.setTimeout(cb, 100)
    })
    scope.stop()
    vi.advanceTimersByTime(200)
    expect(cb).not.toHaveBeenCalled()
  })

  it('is safe to use with no active scope (no auto-clear, no warning)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const timers = useManagedTimers()
    const cb = vi.fn()
    timers.setTimeout(cb, 100)
    vi.advanceTimersByTime(100)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
