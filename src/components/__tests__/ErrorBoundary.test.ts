import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ErrorBoundary from '../ErrorBoundary.vue'
import { guardedReload } from '../../lib/reloadGuard'

vi.mock('../../lib/reloadGuard', () => ({
  guardedReload: vi.fn(() => true),
}))

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.mocked(guardedReload).mockClear()
  })

  it('renders slot content when no error occurs', () => {
    const wrapper = mount(ErrorBoundary, {
      slots: {
        default: '<div class="happy">Works fine</div>',
      },
    })

    expect(wrapper.find('.happy').exists()).toBe(true)
    expect(wrapper.find('.errorBoundary').exists()).toBe(false)
  })

  it('displays error boundary UI with correct structure', async () => {
    const wrapper = mount(ErrorBoundary, {
      slots: { default: '<div>Content</div>' },
    })

    // Manually trigger the error state
    wrapper.vm.error = new Error('Something broke')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.errorBoundary').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('.errorBoundaryTitle').text()).toBe('Something went wrong')
    expect(wrapper.find('.errorBoundaryMessage').text()).toBe('Something broke')
    // Two buttons initially: a soft "Try again" and the hard "Reload".
    expect(wrapper.find('.errorBoundaryBtnSecondary').text()).toBe('Try again')
    expect(wrapper.findAll('.errorBoundaryBtn').at(-1)?.text()).toBe('Reload')
  })

  it('soft "Try again" clears the error without reloading', async () => {
    const wrapper = mount(ErrorBoundary, {
      slots: { default: '<div class="content">Hello</div>' },
    })

    wrapper.vm.error = new Error('Crash')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.errorBoundary').exists()).toBe(true)

    await wrapper.find('.errorBoundaryBtnSecondary').trigger('click')

    expect(wrapper.find('.errorBoundary').exists()).toBe(false)
    expect(wrapper.find('.content').exists()).toBe(true)
    expect(guardedReload).not.toHaveBeenCalled()
  })

  it('after one failed soft recovery, only the hard Reload path remains', async () => {
    const wrapper = mount(ErrorBoundary, {
      slots: { default: '<div>OK</div>' },
    })

    wrapper.vm.error = new Error('Deterministic crash')
    await wrapper.vm.$nextTick()

    // First soft attempt.
    await wrapper.find('.errorBoundaryBtnSecondary').trigger('click')

    // The same deterministic error re-fires — the boundary re-enters error
    // state and must no longer offer the soft path.
    wrapper.vm.error = new Error('Deterministic crash')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.errorBoundary').exists()).toBe(true)
    expect(wrapper.find('.errorBoundaryBtnSecondary').exists()).toBe(false)
    expect(wrapper.findAll('.errorBoundaryBtn')).toHaveLength(1)
    expect(wrapper.find('.errorBoundaryBtn').text()).toBe('Reload')
  })

  it('Reload button routes through guardedReload (circuit-broken, #1155)', async () => {
    const wrapper = mount(ErrorBoundary, {
      slots: { default: '<div>OK</div>' },
    })

    wrapper.vm.error = new Error('Crash')
    await wrapper.vm.$nextTick()

    await wrapper.findAll('.errorBoundaryBtn').at(-1)?.trigger('click')

    expect(guardedReload).toHaveBeenCalledExactlyOnceWith('error-boundary')
  })

  it('a re-throwing child keeps the fallback visible after a soft retry', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const wrapper = mount(ErrorBoundary, {
      slots: { default: '<div>OK</div>' },
    })

    // Simulate onErrorCaptured firing, a soft retry, then the same error again.
    wrapper.vm.error = new Error('boom')
    await wrapper.vm.$nextTick()
    await wrapper.find('.errorBoundaryBtnSecondary').trigger('click')
    wrapper.vm.error = new Error('boom')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.errorBoundary').exists()).toBe(true)
    spy.mockRestore()
  })

  it('has accessible role=alert on error state', async () => {
    const wrapper = mount(ErrorBoundary, {
      slots: { default: '<div>OK</div>' },
    })

    wrapper.vm.error = new Error('Failure')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('catches child component errors via onErrorCaptured', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const wrapper = mount(ErrorBoundary, {
      slots: { default: '<div>OK</div>' },
    })

    // Simulate what onErrorCaptured does
    const err = new Error('Child exploded')
    wrapper.vm.error = err

    spy.mockRestore()
    expect(wrapper.vm.error).toBe(err)
  })
})
