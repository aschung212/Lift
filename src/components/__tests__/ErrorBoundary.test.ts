import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h, ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import ErrorBoundary from '../ErrorBoundary.vue'
import { guardedReload } from '../../lib/reloadGuard'

vi.mock('../../lib/reloadGuard', () => ({
  guardedReload: vi.fn(() => true),
}))

// A child whose render throws whenever the shared `boom` ref holds an error.
// Flipping `boom` between renders lets a test model a deterministic crash
// (stays set → re-throws on retry) vs. a transient one (cleared → recovers).
const boom = ref<Error | null>(null)
const Boom = defineComponent({
  name: 'Boom',
  setup() {
    return () => {
      if (boom.value) throw boom.value
      return h('div', { class: 'ok-child' }, 'ok')
    }
  },
})

function mountWithChild() {
  return mount(ErrorBoundary, {
    slots: { default: () => h(Boom) },
  })
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.mocked(guardedReload).mockClear().mockReturnValue(true)
    boom.value = null
    vi.spyOn(console, 'error').mockImplementation(() => {})
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

  it('catches a child render error and shows the fallback', async () => {
    boom.value = new Error('Child exploded')
    const wrapper = mountWithChild()
    await nextTick()

    expect(wrapper.find('.errorBoundary').exists()).toBe(true)
    expect(wrapper.find('.errorBoundaryMessage').text()).toBe('Child exploded')
    expect(guardedReload).not.toHaveBeenCalled()
  })

  it('soft "Try again" recovers from a transient error without reloading', async () => {
    boom.value = new Error('Transient')
    const wrapper = mountWithChild()
    await nextTick()
    expect(wrapper.find('.errorBoundary').exists()).toBe(true)

    // The underlying condition clears before the retry re-renders.
    boom.value = null
    await wrapper.find('.errorBoundaryBtnSecondary').trigger('click')
    await nextTick()

    expect(wrapper.find('.errorBoundary').exists()).toBe(false)
    expect(wrapper.find('.ok-child').exists()).toBe(true)
    expect(guardedReload).not.toHaveBeenCalled()
  })

  it('after a failed soft recovery, only the hard Reload path remains', async () => {
    boom.value = new Error('Deterministic crash')
    const wrapper = mountWithChild()
    await nextTick()

    // The condition persists, so the retry re-throws synchronously.
    await wrapper.find('.errorBoundaryBtnSecondary').trigger('click')
    await nextTick()

    expect(wrapper.find('.errorBoundary').exists()).toBe(true)
    expect(wrapper.find('.errorBoundaryBtnSecondary').exists()).toBe(false)
    expect(wrapper.findAll('.errorBoundaryBtn')).toHaveLength(1)
    expect(wrapper.find('.errorBoundaryBtn').text()).toBe('Reload')
  })

  it('a successful soft recovery preserves the soft path for a later error', async () => {
    boom.value = new Error('Transient one')
    const wrapper = mountWithChild()
    await nextTick()

    boom.value = null
    await wrapper.find('.errorBoundaryBtnSecondary').trigger('click')
    await nextTick()
    expect(wrapper.find('.errorBoundary').exists()).toBe(false)

    // A brand-new, unrelated error later — `boom` is reactive and read by the
    // still-mounted child, so setting it re-triggers a render that throws.
    boom.value = new Error('Transient two')
    await nextTick()

    expect(wrapper.find('.errorBoundary').exists()).toBe(true)
    expect(wrapper.find('.errorBoundaryBtnSecondary').exists()).toBe(true)
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

  it('surfaces a relaunch hint when a reload is suppressed (no silent no-op)', async () => {
    vi.mocked(guardedReload).mockReturnValueOnce(false)

    const wrapper = mount(ErrorBoundary, {
      slots: { default: '<div>OK</div>' },
    })

    wrapper.vm.error = new Error('Crash')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.errorBoundaryHint').exists()).toBe(false)

    await wrapper.findAll('.errorBoundaryBtn').at(-1)?.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.errorBoundaryHint').exists()).toBe(true)
  })

  it('has accessible role=alert on error state', async () => {
    const wrapper = mount(ErrorBoundary, {
      slots: { default: '<div>OK</div>' },
    })

    wrapper.vm.error = new Error('Failure')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })
})
