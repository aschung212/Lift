import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { useInstallPrompt } from '../useInstallPrompt'

/** Mount a wrapper component so onMounted/onUnmounted hooks fire. */
function mountInstallPrompt() {
  let api!: ReturnType<typeof useInstallPrompt>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useInstallPrompt()
        return {}
      },
      template: '<div />',
    }),
  )
  return { api, wrapper }
}

function fireBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const promptFn = vi.fn().mockResolvedValue(undefined)
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: promptFn,
    userChoice: Promise.resolve({ outcome }),
  })
  window.dispatchEvent(event)
  return { event, promptFn }
}

describe('useInstallPrompt', () => {
  let originalMatchMedia: typeof window.matchMedia

  beforeEach(() => {
    originalMatchMedia = window.matchMedia
    // Default: not standalone
    window.matchMedia = vi.fn().mockReturnValue({ matches: false })
    localStorage.clear()
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('canShow is false when no beforeinstallprompt event fired', () => {
    const { api, wrapper } = mountInstallPrompt()
    expect(api.canShow.value).toBe(false)
    wrapper.unmount()
  })

  it('canShow is false when user has dismissed the prompt', () => {
    localStorage.setItem('pwa-install-dismissed', 'true')
    const { api, wrapper } = mountInstallPrompt()
    expect(api.canShow.value).toBe(false)
    wrapper.unmount()
  })

  it('canShow is false when running in standalone mode', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true })
    const { api, wrapper } = mountInstallPrompt()
    expect(api.canShow.value).toBe(false)
    wrapper.unmount()
  })

  it('canShow becomes true after beforeinstallprompt + enough sets', () => {
    localStorage.setItem('exercises', JSON.stringify([
      { sets: [1, 2, 3] },
      { sets: [4, 5] },
    ]))

    const { api, wrapper } = mountInstallPrompt()
    fireBeforeInstallPrompt()
    expect(api.canShow.value).toBe(true)
    wrapper.unmount()
  })

  it('canShow stays false when user has fewer than 3 sets', () => {
    localStorage.setItem('exercises', JSON.stringify([{ sets: [1, 2] }]))

    const { api, wrapper } = mountInstallPrompt()
    fireBeforeInstallPrompt()
    expect(api.canShow.value).toBe(false)
    wrapper.unmount()
  })

  it('dismiss sets localStorage flag and hides the banner', () => {
    localStorage.setItem('exercises', JSON.stringify([{ sets: [1, 2, 3, 4] }]))

    const { api, wrapper } = mountInstallPrompt()
    fireBeforeInstallPrompt()
    expect(api.canShow.value).toBe(true)

    api.dismiss()

    expect(api.canShow.value).toBe(false)
    expect(localStorage.getItem('pwa-install-dismissed')).toBe('true')
    wrapper.unmount()
  })

  it('install calls prompt() and hides banner', async () => {
    localStorage.setItem('exercises', JSON.stringify([{ sets: [1, 2, 3, 4] }]))

    const { api, wrapper } = mountInstallPrompt()

    const { promptFn } = fireBeforeInstallPrompt('accepted')

    expect(api.canShow.value).toBe(true)

    await api.install()

    expect(promptFn).toHaveBeenCalled()
    expect(api.canShow.value).toBe(false)
    wrapper.unmount()
  })

  it('evaluateVisibility re-checks set count threshold', () => {
    const { api, wrapper } = mountInstallPrompt()

    // Fire beforeinstallprompt with no sets yet
    fireBeforeInstallPrompt()
    expect(api.canShow.value).toBe(false)

    // Simulate sets being added to localStorage
    localStorage.setItem('exercises', JSON.stringify([{ sets: [1, 2, 3] }]))

    api.evaluateVisibility()
    expect(api.canShow.value).toBe(true)
    wrapper.unmount()
  })

  it('does not register event listener in standalone mode', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true })
    const addSpy = vi.spyOn(window, 'addEventListener')
    const { wrapper } = mountInstallPrompt()

    const installCalls = addSpy.mock.calls.filter(c => c[0] === 'beforeinstallprompt')
    expect(installCalls).toHaveLength(0)
    wrapper.unmount()
  })

  it('cleans up event listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { wrapper } = mountInstallPrompt()
    wrapper.unmount()

    const installCalls = removeSpy.mock.calls.filter(c => c[0] === 'beforeinstallprompt')
    expect(installCalls).toHaveLength(1)
  })

  it('install records dismissal when user declines', async () => {
    localStorage.setItem('exercises', JSON.stringify([{ sets: [1, 2, 3, 4] }]))

    const { api, wrapper } = mountInstallPrompt()

    fireBeforeInstallPrompt('dismissed')

    await api.install()

    expect(localStorage.getItem('pwa-install-dismissed')).toBe('true')
    expect(api.canShow.value).toBe(false)
    wrapper.unmount()
  })
})
