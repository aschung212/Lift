import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// Thin wrapper component to test the composable
function withSetup(composable: () => unknown) {
  let result: ReturnType<typeof composable>
  const Comp = defineComponent({
    setup() {
      result = composable()
      return {}
    },
    template: '<div></div>',
  })
  const wrapper = mount(Comp)
  return { wrapper, result: result! as ReturnType<typeof import('../usePWAInstall').usePWAInstall> }
}

describe('usePWAInstall', () => {
  let usePWAInstall: typeof import('../usePWAInstall').usePWAInstall

  beforeEach(async () => {
    vi.resetModules()
    localStorageMock.clear()
    // Reset matchMedia to not standalone
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    })
    const mod = await import('../usePWAInstall')
    usePWAInstall = mod.usePWAInstall
  })

  it('does not show banner initially (no beforeinstallprompt fired)', () => {
    const { result } = withSetup(() => usePWAInstall())
    expect(result.canShow.value).toBe(false)
  })

  it('does not show if in standalone mode', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    })
    vi.resetModules()
    const mod = await import('../usePWAInstall')
    const { result } = withSetup(() => mod.usePWAInstall())
    expect(result.isStandalone).toBe(true)
    expect(result.canShow.value).toBe(false)
  })

  it('shows banner after beforeinstallprompt + engagement threshold (session >= 2)', async () => {
    // Simulate second session
    localStorage.setItem('pwa-session-count', '1')
    vi.resetModules()
    const mod = await import('../usePWAInstall')
    const { result } = withSetup(() => mod.usePWAInstall())

    // Fire beforeinstallprompt
    const event = new Event('beforeinstallprompt', { cancelable: true })
    ;(event as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }).prompt = vi.fn()
    ;(event as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }).userChoice = Promise.resolve({ outcome: 'dismissed' })
    window.dispatchEvent(event)

    await nextTick()
    expect(result.canShow.value).toBe(true)
  })

  it('shows banner after 3 sets logged in first session', async () => {
    const { result } = withSetup(() => usePWAInstall())

    // Fire beforeinstallprompt
    const event = new Event('beforeinstallprompt', { cancelable: true })
    ;(event as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }).prompt = vi.fn()
    ;(event as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }).userChoice = Promise.resolve({ outcome: 'dismissed' })
    window.dispatchEvent(event)

    await nextTick()
    // First session, no sets — not shown
    expect(result.canShow.value).toBe(false)

    result.notifySetLogged()
    result.notifySetLogged()
    expect(result.canShow.value).toBe(false)

    result.notifySetLogged() // 3rd set
    expect(result.canShow.value).toBe(true)
  })

  it('dismissPrompt hides banner and persists for 7 days', async () => {
    localStorage.setItem('pwa-session-count', '1')
    vi.resetModules()
    const mod = await import('../usePWAInstall')
    const { result } = withSetup(() => mod.usePWAInstall())

    // Fire beforeinstallprompt
    const event = new Event('beforeinstallprompt', { cancelable: true })
    ;(event as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }).prompt = vi.fn()
    ;(event as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }).userChoice = Promise.resolve({ outcome: 'dismissed' })
    window.dispatchEvent(event)
    await nextTick()
    expect(result.canShow.value).toBe(true)

    result.dismissPrompt()
    expect(result.canShow.value).toBe(false)
    expect(localStorage.getItem('pwa-install-dismissed')).toBeTruthy()
  })

  it('does not show banner if dismissed within 7 days', async () => {
    localStorage.setItem('pwa-install-dismissed', String(Date.now()))
    localStorage.setItem('pwa-session-count', '5')
    vi.resetModules()
    const mod = await import('../usePWAInstall')
    const { result } = withSetup(() => mod.usePWAInstall())

    // Fire beforeinstallprompt
    const event = new Event('beforeinstallprompt', { cancelable: true })
    ;(event as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }).prompt = vi.fn()
    ;(event as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }).userChoice = Promise.resolve({ outcome: 'dismissed' })
    window.dispatchEvent(event)
    await nextTick()

    expect(result.canShow.value).toBe(false)
  })

  it('shows banner if dismissal expired (>7 days ago)', async () => {
    const eightDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000)
    localStorage.setItem('pwa-install-dismissed', String(eightDaysAgo))
    localStorage.setItem('pwa-session-count', '5')
    vi.resetModules()
    const mod = await import('../usePWAInstall')
    const { result } = withSetup(() => mod.usePWAInstall())

    // Fire beforeinstallprompt
    const event = new Event('beforeinstallprompt', { cancelable: true })
    ;(event as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }).prompt = vi.fn()
    ;(event as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }).userChoice = Promise.resolve({ outcome: 'dismissed' })
    window.dispatchEvent(event)
    await nextTick()

    expect(result.canShow.value).toBe(true)
  })

  it('promptInstall calls the deferred prompt and hides on accept', async () => {
    localStorage.setItem('pwa-session-count', '1')
    vi.resetModules()
    const mod = await import('../usePWAInstall')
    const { result } = withSetup(() => mod.usePWAInstall())

    const promptFn = vi.fn()
    const event = new Event('beforeinstallprompt', { cancelable: true })
    ;(event as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }).prompt = promptFn
    ;(event as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }).userChoice = Promise.resolve({ outcome: 'accepted' })
    window.dispatchEvent(event)
    await nextTick()

    expect(result.canShow.value).toBe(true)
    await result.promptInstall()
    expect(promptFn).toHaveBeenCalled()
    expect(result.canShow.value).toBe(false)
  })
})
