import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import StarterPickerFlow from '../StarterPickerFlow.vue'

import { getLocalStorageMock, mockAnalytics } from '../../__tests__/helpers'
const localStorageMock = getLocalStorageMock()

const mockLogEvent = vi.fn()
vi.mock('../../composables/useAnalytics', () => ({
  useAnalytics: () => ({
    logEvent: mockLogEvent,
    tabSwitch: vi.fn(),
    flushEngagement: vi.fn(),
  })
}))

describe('StarterPickerFlow', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    wrapper = mount(StarterPickerFlow, {
      props: { showSkip: true, resolvedMode: 'dark' },
    })
  })

  it('starts on the explainer step', () => {
    expect(wrapper.find('.spfTitle').text()).toBe('Theme Progression')
  })

  it('advances to the pick step when clicking "Pick a Starter Theme"', async () => {
    await wrapper.find('.spfPrimary').trigger('click')
    expect(wrapper.find('.spfTitle').text()).toBe('Pick Your Starter')
  })

  describe('theme preview on pick step', () => {
    beforeEach(async () => {
      // Advance to pick step
      await wrapper.find('.spfPrimary').trigger('click')
    })

    it('emits preview event when tapping a starter card', async () => {
      const cards = wrapper.findAll('.spfCard')
      expect(cards.length).toBe(3)

      await cards[0].trigger('click') // Fire / Intensity
      expect(wrapper.emitted('preview')).toHaveLength(1)
      expect(wrapper.emitted('preview')![0]).toEqual(['fire'])
    })

    it('emits preview for each card tap', async () => {
      const cards = wrapper.findAll('.spfCard')

      await cards[0].trigger('click') // fire
      await cards[1].trigger('click') // water
      await cards[2].trigger('click') // luck

      const previews = wrapper.emitted('preview')!
      expect(previews).toHaveLength(3)
      expect(previews[0]).toEqual(['fire'])
      expect(previews[1]).toEqual(['water'])
      expect(previews[2]).toEqual(['luck'])
    })

    it('selects the tapped card visually', async () => {
      const cards = wrapper.findAll('.spfCard')
      await cards[1].trigger('click') // water

      expect(cards[1].classes()).toContain('selected')
      expect(cards[0].classes()).not.toContain('selected')
    })

    it('emits revert-preview when skipping from pick step', async () => {
      await wrapper.find('.spfSecondary').trigger('click') // Skip button

      expect(wrapper.emitted('revert-preview')).toHaveLength(1)
      expect(wrapper.emitted('skip')).toHaveLength(1)
    })
  })

  describe('onboarding step analytics', () => {
    it('fires onboarding_step when advancing from explainer to pick', async () => {
      mockLogEvent.mockClear()
      await wrapper.find('.spfPrimary').trigger('click')
      expect(mockLogEvent).toHaveBeenCalledWith('onboarding_step', { step: 'explainer_done' })
    })

    it('fires onboarding_step when advancing from pick to goal', async () => {
      mockLogEvent.mockClear()
      await wrapper.find('.spfPrimary').trigger('click') // explainer → pick
      mockLogEvent.mockClear()

      const cards = wrapper.findAll('.spfCard')
      await cards[0].trigger('click') // select fire
      await wrapper.find('.spfPrimary').trigger('click') // pick → goal

      expect(mockLogEvent).toHaveBeenCalledWith('onboarding_step', { step: 'pick_done', theme: 'fire' })
    })

    it('fires onboarding_step with skip and from step when skipping from explainer', async () => {
      mockLogEvent.mockClear()
      await wrapper.find('.spfSecondary').trigger('click') // Skip
      expect(mockLogEvent).toHaveBeenCalledWith('onboarding_step', { step: 'skip', from: 'explainer' })
    })

    it('fires onboarding_step with goal_done on confirm', async () => {
      mockLogEvent.mockClear()
      await wrapper.find('.spfPrimary').trigger('click') // explainer → pick
      const cards = wrapper.findAll('.spfCard')
      await cards[1].trigger('click') // select water
      await wrapper.find('.spfPrimary').trigger('click') // pick → goal
      mockLogEvent.mockClear()

      await wrapper.find('.spfPrimary').trigger('click') // confirm

      expect(mockLogEvent).toHaveBeenCalledWith('onboarding_step', { step: 'goal_done', goal: 3 })
      expect(wrapper.emitted('confirm')).toHaveLength(1)
      expect(wrapper.emitted('confirm')![0]).toEqual(['water', 3])
    })
  })

  describe('reset', () => {
    it('emits revert-preview on reset', async () => {
      await wrapper.find('.spfPrimary').trigger('click') // go to pick step
      const cards = wrapper.findAll('.spfCard')
      await cards[0].trigger('click') // select fire

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(wrapper.vm as any).reset()

      expect(wrapper.emitted('revert-preview')).toHaveLength(1)
    })
  })
})
