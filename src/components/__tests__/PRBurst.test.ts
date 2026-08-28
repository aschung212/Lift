import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import type { SessionSummary } from '../../lib/sessionSummary'

// Hoisted spies so the vi.mock factories (which are hoisted above imports) can
// reference them.
const { logEventMock, notifySuccessMock } = vi.hoisted(() => ({
  logEventMock: vi.fn(),
  notifySuccessMock: vi.fn(),
}))

vi.mock('../../composables/useAnalytics', () => ({
  useAnalytics: () => ({ logEvent: logEventMock }),
}))

// usePRBurst fires haptics on present; keep them observable + side-effect free.
vi.mock('../../composables/useHaptics', () => ({
  useHaptics: () => ({
    impactLight: vi.fn(),
    impactMedium: vi.fn(),
    impactHeavy: vi.fn(),
    notifySuccess: notifySuccessMock,
    notifyWarning: vi.fn(),
    notifyError: vi.fn(),
  }),
}))

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn() },
}))

import PRBurst from '../PRBurst.vue'
import { usePRBurst, type PRBurstPayload } from '../../composables/usePRBurst'

const basePayload: PRBurstPayload = {
  exerciseName: 'Hack Squat',
  oldE1RM: 594,
  newE1RM: 606,
  setWeight: 505,
  setReps: 6,
}

describe('PRBurst', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    setActivePinia(createPinia())
    logEventMock.mockClear()
    notifySuccessMock.mockClear()
    // Reset the module-scope singleton synchronously (flush the 200ms
    // deferred payload clear) so each test starts hidden.
    vi.useFakeTimers()
    usePRBurst().dismissPRBurst()
    vi.advanceTimersByTime(200)
    vi.useRealTimers()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  function mountBurst(): VueWrapper {
    return mount(PRBurst, {
      global: {
        // The share picker (async, teleported) pulls in the whole share-card
        // subsystem — stub it and render the Teleport inline so the stub is
        // findable within the wrapper.
        stubs: {
          Teleport: true,
          SharePickerSheet: { name: 'SharePickerSheet', template: '<div class="stub-picker" />' },
        },
      },
    })
  }

  async function present(payload: Partial<PRBurstPayload> = {}) {
    wrapper = mountBurst()
    usePRBurst().presentPRBurst({ ...basePayload, ...payload })
    await wrapper.vm.$nextTick()
    return wrapper
  }

  it('renders nothing until a PR is presented', () => {
    wrapper = mountBurst()
    expect(wrapper.find('.prBurst').exists()).toBe(false)
  })

  it('renders a labelled celebration dialog on present', async () => {
    await present()
    const burst = wrapper!.find('.prBurst')
    expect(burst.exists()).toBe(true)
    expect(burst.attributes('role')).toBe('dialog')
    expect(burst.attributes('aria-modal')).toBe('true')
    expect(burst.attributes('aria-label')).toBe('Personal record')
    expect(notifySuccessMock).toHaveBeenCalledTimes(1)
  })

  it('shows the eyebrow, delta, subtitle and set chip', async () => {
    await present()
    expect(wrapper!.find('.prBurstEyebrow').text()).toContain('Personal Record')
    expect(wrapper!.find('.prBurstDelta').text()).toBe('+12 lbs')
    const subtitle = wrapper!.find('.prBurstSubtitle').text()
    expect(subtitle).toContain('594')
    expect(subtitle).toContain('606')
    expect(subtitle).toContain('e1RM')
    expect(wrapper!.find('.prBurstChip').text()).toBe('Hack Squat · 505 × 6')
  })

  it('renders the first-PR badge only when isFirstPR is set', async () => {
    await present({ isFirstPR: true })
    expect(wrapper!.find('.prBurstFirstBadge').exists()).toBe(true)
    expect(wrapper!.find('.prBurstFirstBadge').text()).toBe('Your First')
  })

  it('omits the first-PR badge for a subsequent PR', async () => {
    await present({ isFirstPR: false })
    expect(wrapper!.find('.prBurstFirstBadge').exists()).toBe(false)
  })

  it('hides the share button when no shareSummary is supplied', async () => {
    await present()
    expect(wrapper!.find('.prBurstShare').exists()).toBe(false)
  })

  it('shows the share button when a shareSummary is supplied', async () => {
    await present({ shareSummary: { rawDate: '2026-07-17' } as SessionSummary })
    expect(wrapper!.find('.prBurstShare').exists()).toBe(true)
  })

  it('dismisses when the backdrop is tapped', async () => {
    await present()
    const { visible } = usePRBurst()
    expect(visible.value).toBe(true)
    await wrapper!.find('.prBurst').trigger('click')
    expect(visible.value).toBe(false)
    await wrapper!.vm.$nextTick()
    expect(wrapper!.find('.prBurst').exists()).toBe(false)
  })

  it('share button opens the picker, logs analytics, and dismisses the burst', async () => {
    await present({
      isFirstPR: true,
      shareSummary: { rawDate: '2026-07-17' } as SessionSummary,
    })
    const { visible } = usePRBurst()

    await wrapper!.find('.prBurstShare').trigger('click')

    expect(logEventMock).toHaveBeenCalledWith('pr_share_opened', {
      exercise: 'Hack Squat',
      firstPr: true,
    })
    // Handing off to the share sheet dismisses the celebration so they don't stack.
    expect(visible.value).toBe(false)
    await wrapper!.vm.$nextTick()
    expect(wrapper!.find('.stub-picker').exists()).toBe(true)
  })
})
