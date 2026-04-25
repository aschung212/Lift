import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, ref, nextTick } from 'vue'
import { useInstallPrompt } from '../useInstallPrompt'

// Mock platform module
vi.mock('../../lib/platform', () => ({
  isNative: false,
  isIOS: false,
  platform: 'web',
}))

const DISMISS_KEY = 'install-prompt-dismissed'

function createWrapper(workoutDateCount = ref(0)) {
  return mount(
    defineComponent({
      setup() {
        const result = useInstallPrompt(() => workoutDateCount.value)
        return { ...result }
      },
      template: '<div />',
    }),
  )
}

describe('useInstallPrompt', () => {
  let matchMediaResult: { matches: boolean }

  beforeEach(() => {
    localStorage.clear()
    matchMediaResult = { matches: false }
    vi.spyOn(window, 'matchMedia').mockReturnValue(matchMediaResult as unknown as MediaQueryList)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not show banner initially when workout count is below threshold', () => {
    const wrapper = createWrapper(ref(0))
    expect(wrapper.vm.showBanner).toBe(false)
  })

  it('does not show banner when already in standalone mode', () => {
    matchMediaResult.matches = true
    const wrapper = createWrapper(ref(5))
    expect(wrapper.vm.showBanner).toBe(false)
  })

  it('does not show banner when previously dismissed', () => {
    localStorage.setItem(DISMISS_KEY, new Date().toISOString())
    const wrapper = createWrapper(ref(5))
    expect(wrapper.vm.showBanner).toBe(false)
  })

  it('shows banner on iOS path when workout threshold is met', async () => {
    // Re-mock platform as iOS
    const platformMod = await import('../../lib/platform')
    Object.defineProperty(platformMod, 'isIOS', { value: true, writable: true })

    const count = ref(3)
    const wrapper = createWrapper(count)
    wrapper.vm.check()
    await nextTick()

    expect(wrapper.vm.showBanner).toBe(true)
    expect(wrapper.vm.isIOSPrompt).toBe(true)

    // Reset
    Object.defineProperty(platformMod, 'isIOS', { value: false, writable: true })
  })

  it('dismiss() hides banner and persists to localStorage', async () => {
    const platformMod = await import('../../lib/platform')
    Object.defineProperty(platformMod, 'isIOS', { value: true, writable: true })

    const count = ref(5)
    const wrapper = createWrapper(count)
    wrapper.vm.check()
    await nextTick()
    expect(wrapper.vm.showBanner).toBe(true)

    wrapper.vm.dismiss()
    await nextTick()
    expect(wrapper.vm.showBanner).toBe(false)
    expect(localStorage.getItem(DISMISS_KEY)).toBeTruthy()

    // After dismiss, check() should not re-show
    wrapper.vm.check()
    await nextTick()
    expect(wrapper.vm.showBanner).toBe(false)

    Object.defineProperty(platformMod, 'isIOS', { value: false, writable: true })
  })

  it('shows banner when beforeinstallprompt fires and threshold met', async () => {
    const count = ref(3)
    const wrapper = createWrapper(count)

    // Simulate the browser firing beforeinstallprompt
    const promptEvent = new Event('beforeinstallprompt', { cancelable: true })
    Object.defineProperty(promptEvent, 'prompt', { value: vi.fn().mockResolvedValue(undefined) })
    Object.defineProperty(promptEvent, 'userChoice', { value: Promise.resolve({ outcome: 'dismissed' }) })

    window.dispatchEvent(promptEvent)
    await nextTick()

    expect(wrapper.vm.showBanner).toBe(true)
    expect(wrapper.vm.isIOSPrompt).toBe(false)
  })

  it('check() re-evaluates when workout count crosses threshold', async () => {
    const platformMod = await import('../../lib/platform')
    Object.defineProperty(platformMod, 'isIOS', { value: true, writable: true })

    const count = ref(1)
    const wrapper = createWrapper(count)
    wrapper.vm.check()
    await nextTick()
    expect(wrapper.vm.showBanner).toBe(false)

    count.value = 3
    wrapper.vm.check()
    await nextTick()
    expect(wrapper.vm.showBanner).toBe(true)

    Object.defineProperty(platformMod, 'isIOS', { value: false, writable: true })
  })
})
