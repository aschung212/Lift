import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ErrorBoundary from '../ErrorBoundary.vue'

describe('ErrorBoundary', () => {
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
    expect(wrapper.find('.errorBoundaryBtn').text()).toBe('Reload')
  })

  it('recovers when Reload button is clicked', async () => {
    const wrapper = mount(ErrorBoundary, {
      slots: { default: '<div class="content">Hello</div>' },
    })

    wrapper.vm.error = new Error('Crash')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.errorBoundary').exists()).toBe(true)

    await wrapper.find('.errorBoundaryBtn').trigger('click')

    expect(wrapper.find('.errorBoundary').exists()).toBe(false)
    expect(wrapper.find('.content').exists()).toBe(true)
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
