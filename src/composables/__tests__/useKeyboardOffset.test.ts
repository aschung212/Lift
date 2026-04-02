import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { useKeyboardOffset } from '../useKeyboardOffset'

// Helper component to test composable lifecycle hooks
const TestComponent = defineComponent({
  setup() {
    const { keyboardHeight } = useKeyboardOffset()
    return { keyboardHeight }
  },
  template: '<div>{{ keyboardHeight }}</div>',
})

describe('useKeyboardOffset', () => {
  let addEventListenerSpy: ReturnType<typeof vi.fn>
  let removeEventListenerSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    addEventListenerSpy = vi.fn()
    removeEventListenerSpy = vi.fn()

    vi.stubGlobal('visualViewport', {
      height: 800,
      offsetTop: 0,
      addEventListener: addEventListenerSpy,
      removeEventListener: removeEventListenerSpy,
    })

    // window.innerHeight is read-only, so stub it
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true, configurable: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts with keyboardHeight of 0', () => {
    const wrapper = mount(TestComponent)
    expect(wrapper.vm.keyboardHeight).toBe(0)
    wrapper.unmount()
  })

  it('registers resize and scroll listeners on mount', () => {
    const wrapper = mount(TestComponent)
    expect(addEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(addEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(addEventListenerSpy).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('removes listeners on unmount', () => {
    const wrapper = mount(TestComponent)
    wrapper.unmount()
    expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(removeEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(removeEventListenerSpy).toHaveBeenCalledTimes(2)
  })

  it('calculates keyboard height when viewport shrinks (keyboard opens)', () => {
    const wrapper = mount(TestComponent)

    // Simulate keyboard opening: viewport shrinks from 800 to 500
    Object.defineProperty(window, 'innerHeight', { value: 800 })
    ;(window.visualViewport as { height: number }).height = 500
    ;(window.visualViewport as { offsetTop: number }).offsetTop = 0

    // Get the resize handler and call it
    const resizeHandler = addEventListenerSpy.mock.calls.find(
      (call: [string, () => void]) => call[0] === 'resize'
    )![1]
    resizeHandler()

    expect(wrapper.vm.keyboardHeight).toBe(300)
    wrapper.unmount()
  })

  it('accounts for viewport offsetTop in calculation', () => {
    const wrapper = mount(TestComponent)

    Object.defineProperty(window, 'innerHeight', { value: 800 })
    ;(window.visualViewport as { height: number }).height = 500
    ;(window.visualViewport as { offsetTop: number }).offsetTop = 50

    const resizeHandler = addEventListenerSpy.mock.calls.find(
      (call: [string, () => void]) => call[0] === 'resize'
    )![1]
    resizeHandler()

    // 800 - 500 - 50 = 250
    expect(wrapper.vm.keyboardHeight).toBe(250)
    wrapper.unmount()
  })

  it('clamps to 0 when viewport is full size (keyboard closed)', () => {
    const wrapper = mount(TestComponent)

    Object.defineProperty(window, 'innerHeight', { value: 800 })
    ;(window.visualViewport as { height: number }).height = 800
    ;(window.visualViewport as { offsetTop: number }).offsetTop = 0

    const resizeHandler = addEventListenerSpy.mock.calls.find(
      (call: [string, () => void]) => call[0] === 'resize'
    )![1]
    resizeHandler()

    expect(wrapper.vm.keyboardHeight).toBe(0)
    wrapper.unmount()
  })

  it('handles missing visualViewport gracefully', () => {
    vi.stubGlobal('visualViewport', undefined)
    // Should not throw
    const wrapper = mount(TestComponent)
    expect(wrapper.vm.keyboardHeight).toBe(0)
    wrapper.unmount()
  })
})
