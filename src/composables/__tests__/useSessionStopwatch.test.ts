import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, ref, nextTick, type Ref } from 'vue'
import { useSessionStopwatch } from '../useSessionStopwatch'

const STORAGE_KEY = 'workout-session-start'
// A fixed local "today" so day-key logic is deterministic regardless of TZ.
const FIXED_NOW = new Date(2026, 6, 9, 10, 0, 0).getTime() // 2026-07-09 10:00 local

function createWrapper(setCount: Ref<number>) {
  const Comp = defineComponent({
    setup() {
      const sw = useSessionStopwatch(setCount)
      return { ...sw }
    },
    template: '<div />',
  })
  return mount(Comp, { attachTo: document.body })
}

describe('useSessionStopwatch', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('is inactive with zero elapsed when no sets are logged', () => {
    const setCount = ref(0)
    const w = createWrapper(setCount)
    expect(w.vm.isActive).toBe(false)
    expect(w.vm.elapsedMs).toBe(0)
    expect(w.vm.label).toBe('0:00')
    w.unmount()
  })

  it('starts counting when the first set is logged and ticks each second', async () => {
    const setCount = ref(0)
    const w = createWrapper(setCount)

    setCount.value = 1
    await nextTick()
    expect(w.vm.isActive).toBe(true)
    expect(w.vm.label).toBe('0:00')

    vi.advanceTimersByTime(65_000)
    await nextTick()
    expect(w.vm.label).toBe('1:05')
    w.unmount()
  })

  it('persists the start so a remount mid-session resumes the same clock', async () => {
    const setCount = ref(1)
    const first = createWrapper(setCount)
    expect(first.vm.isActive).toBe(true)
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored.startedAt).toBe(FIXED_NOW)
    first.unmount()

    // 90s later the user reopens the app — the clock should resume, not reset.
    vi.setSystemTime(FIXED_NOW + 90_000)
    const second = createWrapper(setCount)
    await nextTick()
    expect(second.vm.isActive).toBe(true)
    expect(second.vm.label).toBe('1:30')
    second.unmount()
  })

  it('resets and clears storage when every set is removed', async () => {
    const setCount = ref(2)
    const w = createWrapper(setCount)
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()

    setCount.value = 0
    await nextTick()
    expect(w.vm.isActive).toBe(false)
    expect(w.vm.elapsedMs).toBe(0)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    w.unmount()
  })

  it('ignores a stored start from a previous day (day rollover)', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ dayKey: '2020-01-01', startedAt: FIXED_NOW - 5_000 }),
    )
    const setCount = ref(1)
    const w = createWrapper(setCount)
    await nextTick()
    // Fresh start at now, not the stale day's timestamp.
    expect(w.vm.label).toBe('0:00')
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored.startedAt).toBe(FIXED_NOW)
    w.unmount()
  })

  it('stops ticking after unmount (no leaked interval)', async () => {
    const setCount = ref(1)
    const w = createWrapper(setCount)
    const before = w.vm.label
    w.unmount()
    vi.advanceTimersByTime(120_000)
    // The composable return is detached after unmount; assert the interval was
    // cleared by confirming no pending timers remain.
    expect(vi.getTimerCount()).toBe(0)
    expect(before).toBe('0:00')
  })
})
