import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { useTabRouting, VALID_TABS } from '../useTabRouting'

function makeScrollContainer(scrollTop = 0): HTMLElement {
  return { scrollTop } as unknown as HTMLElement
}

describe('useTabRouting', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initial tab resolution', () => {
    it('uses a valid ?tab= deep-link param over everything else', () => {
      localStorage.setItem('active-tab', 'weight')
      const { activeTab } = useTabRouting({
        scrollContainer: ref(null),
        search: '?tab=calendar',
      })
      expect(activeTab.value).toBe('calendar')
    })

    it('ignores an invalid ?tab= param and falls back to the persisted tab', () => {
      localStorage.setItem('active-tab', 'weight')
      const { activeTab } = useTabRouting({
        scrollContainer: ref(null),
        search: '?tab=bogus',
      })
      expect(activeTab.value).toBe('weight')
    })

    it('falls back to the persisted active-tab when no param is present', () => {
      localStorage.setItem('active-tab', 'calendar')
      const { activeTab } = useTabRouting({ scrollContainer: ref(null), search: '' })
      expect(activeTab.value).toBe('calendar')
    })

    it('defaults to workouts when nothing is persisted', () => {
      const { activeTab } = useTabRouting({ scrollContainer: ref(null), search: '' })
      expect(activeTab.value).toBe('workouts')
    })

    it('exposes the three valid tabs', () => {
      expect([...VALID_TABS]).toEqual(['workouts', 'calendar', 'weight'])
    })
  })

  describe('?tab= cleanup', () => {
    it('strips the tab param from the URL via replaceState', () => {
      const spy = vi.spyOn(window.history, 'replaceState')
      useTabRouting({ scrollContainer: ref(null), search: '?tab=weight' })
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('does not touch history when no tab param is present', () => {
      const spy = vi.spyOn(window.history, 'replaceState')
      useTabRouting({ scrollContainer: ref(null), search: '' })
      expect(spy).not.toHaveBeenCalled()
    })
  })

  describe('switchTab', () => {
    it('updates activeTab, persists it, and fires onSwitch with from/to', () => {
      const onSwitch = vi.fn()
      const { activeTab, switchTab } = useTabRouting({
        scrollContainer: ref(null),
        search: '',
        onSwitch,
      })
      switchTab('calendar')
      expect(activeTab.value).toBe('calendar')
      expect(localStorage.getItem('active-tab')).toBe('calendar')
      expect(onSwitch).toHaveBeenCalledWith('workouts', 'calendar')
    })

    it('runs onBeforeSwitch on every call but skips onSwitch when the tab is unchanged', () => {
      const onBeforeSwitch = vi.fn()
      const onSwitch = vi.fn()
      const { switchTab } = useTabRouting({
        scrollContainer: ref(null),
        search: '',
        onBeforeSwitch,
        onSwitch,
      })
      switchTab('workouts') // already active
      expect(onBeforeSwitch).toHaveBeenCalledTimes(1)
      expect(onSwitch).not.toHaveBeenCalled()
    })

    it('preserves and restores per-tab scroll position', async () => {
      const container = ref<HTMLElement | null>(makeScrollContainer(120))
      const { switchTab } = useTabRouting({ scrollContainer: container, search: '' })

      // Leave workouts scrolled to 120 → switch to calendar (starts at top)
      switchTab('calendar')
      await nextTick()
      expect(container.value!.scrollTop).toBe(0)

      // Scroll calendar, go back to workouts → restores 120
      container.value!.scrollTop = 40
      switchTab('workouts')
      await nextTick()
      expect(container.value!.scrollTop).toBe(120)

      // Return to calendar → restores its saved 40
      switchTab('calendar')
      await nextTick()
      expect(container.value!.scrollTop).toBe(40)
    })
  })
})
