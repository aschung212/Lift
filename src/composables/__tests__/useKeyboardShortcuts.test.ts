import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, ref, nextTick } from 'vue'
import { useKeyboardShortcuts, type Shortcut } from '../useKeyboardShortcuts'

function fire(key: string, opts: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }))
}

// Helper component that uses the composable
function createWrapper(shortcuts: Shortcut[]) {
  const Comp = defineComponent({
    setup() {
      const result = useKeyboardShortcuts(() => shortcuts)
      return { ...result }
    },
    template: '<div></div>',
  })
  return mount(Comp)
}

describe('useKeyboardShortcuts', () => {
  let actions: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(() => {
    actions = {
      help: vi.fn(),
      workouts: vi.fn(),
      calendar: vi.fn(),
      settings: vi.fn(),
    }
  })

  it('fires action when matching key is pressed', () => {
    const wrapper = createWrapper([
      { key: '1', label: 'Workouts', action: actions.workouts },
    ])
    fire('1')
    expect(actions.workouts).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('does not fire action for non-matching key', () => {
    const wrapper = createWrapper([
      { key: '1', label: 'Workouts', action: actions.workouts },
    ])
    fire('2')
    expect(actions.workouts).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('ignores keypresses when Ctrl is held', () => {
    const wrapper = createWrapper([
      { key: '1', label: 'Workouts', action: actions.workouts },
    ])
    fire('1', { ctrlKey: true })
    expect(actions.workouts).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('ignores keypresses when Meta is held', () => {
    const wrapper = createWrapper([
      { key: '1', label: 'Workouts', action: actions.workouts },
    ])
    fire('1', { metaKey: true })
    expect(actions.workouts).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('supports multiple shortcuts', () => {
    const wrapper = createWrapper([
      { key: '1', label: 'Workouts', action: actions.workouts },
      { key: '2', label: 'Calendar', action: actions.calendar },
    ])
    fire('1')
    fire('2')
    expect(actions.workouts).toHaveBeenCalledOnce()
    expect(actions.calendar).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('toggles help dialog open and closed', async () => {
    const wrapper = createWrapper([
      { key: '?', label: 'Help', action: actions.help },
    ])
    // helpOpen starts false
    expect(wrapper.vm.helpOpen).toBe(false)
    wrapper.vm.toggleHelp()
    expect(wrapper.vm.helpOpen).toBe(true)
    wrapper.vm.closeHelp()
    expect(wrapper.vm.helpOpen).toBe(false)
    wrapper.unmount()
  })

  it('removes event listener on unmount', () => {
    const wrapper = createWrapper([
      { key: '1', label: 'Workouts', action: actions.workouts },
    ])
    wrapper.unmount()
    fire('1')
    expect(actions.workouts).not.toHaveBeenCalled()
  })

  it('closes help on Escape when help is open', async () => {
    const wrapper = createWrapper([
      { key: '?', label: 'Help', action: actions.help },
    ])
    wrapper.vm.toggleHelp()
    expect(wrapper.vm.helpOpen).toBe(true)
    fire('Escape')
    expect(wrapper.vm.helpOpen).toBe(false)
    wrapper.unmount()
  })

  it('global shortcuts fire even from input context', () => {
    const wrapper = createWrapper([
      { key: 'Escape', label: 'Close', action: actions.settings, global: true },
    ])
    // Simulate keydown with target being an input
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    Object.defineProperty(event, 'target', { value: input })
    window.dispatchEvent(event)
    expect(actions.settings).toHaveBeenCalled()
    document.body.removeChild(input)
    wrapper.unmount()
  })

  it('non-global shortcuts are suppressed when input is focused', () => {
    const wrapper = createWrapper([
      { key: '1', label: 'Workouts', action: actions.workouts },
    ])
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const event = new KeyboardEvent('keydown', { key: '1', bubbles: true })
    Object.defineProperty(event, 'target', { value: input })
    window.dispatchEvent(event)
    expect(actions.workouts).not.toHaveBeenCalled()
    document.body.removeChild(input)
    wrapper.unmount()
  })
})
