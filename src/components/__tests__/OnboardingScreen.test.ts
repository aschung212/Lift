import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import OnboardingScreen from '../OnboardingScreen.vue'

// Mock stores
const mockAddExercise = vi.fn().mockReturnValue('mock-id')
const mockLogSet = vi.fn()
const mockAddEntry = vi.fn()

vi.mock('../../stores/workout', () => ({
  useWorkoutStore: () => ({
    addExercise: mockAddExercise,
    logSet: mockLogSet,
  })
}))

vi.mock('../../stores/bodyweight', () => ({
  useBodyweightStore: () => ({
    addEntry: mockAddEntry,
  })
}))

vi.mock('../../lib/uuid', () => ({ uuid: () => 'test-uuid' }))

import { getLocalStorageMock } from '../../__tests__/helpers'
const localStorageMock = getLocalStorageMock()

describe('OnboardingScreen', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    wrapper = mount(OnboardingScreen)
  })

  describe('rendering', () => {
    it('displays the app logo', () => {
      expect(wrapper.find('.obLogo').text()).toBe('Lift')
    })

    it('shows the onboarding prompt', () => {
      expect(wrapper.find('.obTagline').text()).toContain('get started')
    })

    it('renders three onboarding options', () => {
      const options = wrapper.findAll('.obOption')
      expect(options.length).toBe(3)
    })

    it('shows Start Empty option', () => {
      expect(wrapper.text()).toContain('Start Empty')
      expect(wrapper.text()).toContain('Add your own exercises from scratch')
    })

    it('shows Popular Exercises option', () => {
      expect(wrapper.text()).toContain('Popular Exercises')
      expect(wrapper.text()).toContain('Pre-load 6 common lifts')
    })

    it('shows Explore First option', () => {
      expect(wrapper.text()).toContain('Explore First')
      expect(wrapper.text()).toContain('sample data')
    })
  })

  describe('Start Empty', () => {
    it('emits complete event', async () => {
      const options = wrapper.findAll('.obOption')
      await options[0].trigger('click')
      expect(wrapper.emitted('complete')).toHaveLength(1)
    })

    it('sets onboarding-complete in localStorage', async () => {
      await wrapper.findAll('.obOption')[0].trigger('click')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('onboarding-complete', 'true')
    })

    it('does not add any exercises', async () => {
      await wrapper.findAll('.obOption')[0].trigger('click')
      expect(mockAddExercise).not.toHaveBeenCalled()
    })

    it('does not set sample-data flag', async () => {
      await wrapper.findAll('.obOption')[0].trigger('click')
      const sampleDataCalls = localStorageMock.setItem.mock.calls.filter(
        ([key]: [string]) => key === 'sample-data'
      )
      expect(sampleDataCalls.length).toBe(0)
    })
  })

  describe('Popular Exercises', () => {
    it('adds 6 starter exercises with tags', async () => {
      await wrapper.findAll('.obOption')[1].trigger('click')
      expect(mockAddExercise).toHaveBeenCalledTimes(6)
      expect(mockAddExercise).toHaveBeenCalledWith('Bench Press', ['Push', 'Chest'])
      expect(mockAddExercise).toHaveBeenCalledWith('Squat', ['Legs'])
      expect(mockAddExercise).toHaveBeenCalledWith('Deadlift', ['Pull', 'Legs'])
      expect(mockAddExercise).toHaveBeenCalledWith('Overhead Press', ['Push', 'Shoulders'])
      expect(mockAddExercise).toHaveBeenCalledWith('Barbell Row', ['Pull', 'Back'])
      expect(mockAddExercise).toHaveBeenCalledWith('Pull-ups', ['Pull', 'Back'])
    })

    it('emits complete event', async () => {
      await wrapper.findAll('.obOption')[1].trigger('click')
      expect(wrapper.emitted('complete')).toHaveLength(1)
    })

    it('does not log any sets', async () => {
      await wrapper.findAll('.obOption')[1].trigger('click')
      expect(mockLogSet).not.toHaveBeenCalled()
    })
  })

  describe('Explore First (sample data)', () => {
    it('adds exercises with sample sets', async () => {
      await wrapper.findAll('.obOption')[2].trigger('click')
      expect(mockAddExercise).toHaveBeenCalled()
      expect(mockLogSet).toHaveBeenCalled()
    })

    it('adds bodyweight entries', async () => {
      await wrapper.findAll('.obOption')[2].trigger('click')
      expect(mockAddEntry).toHaveBeenCalled()
      // Should have 78 sample weight entries (365 days of realistic data)
      expect(mockAddEntry.mock.calls.length).toBe(78)
    })

    it('sets sample-data flag in localStorage', async () => {
      await wrapper.findAll('.obOption')[2].trigger('click')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('sample-data', 'true')
    })

    it('emits complete event', async () => {
      await wrapper.findAll('.obOption')[2].trigger('click')
      expect(wrapper.emitted('complete')).toHaveLength(1)
    })

    it('logs sets for 5 exercises with sample data', async () => {
      await wrapper.findAll('.obOption')[2].trigger('click')
      // Extended sample data: ~365 days across 5 exercises (multiple sets per session)
      expect(mockLogSet.mock.calls.length).toBe(367)
    })
  })

  // ── Edge cases (MAS-270) ────────────────────────────────────────
  describe('edge cases', () => {
    it('chooseStarter does not duplicate exercises that already exist', async () => {
      // Simulate existing exercises by having addExercise return the same id
      // (the real store returns existing id for duplicates)
      mockAddExercise.mockReturnValue('existing-id')
      await wrapper.findAll('.obOption')[1].trigger('click')
      // Should still call addExercise 6 times — dedup is the store's job
      expect(mockAddExercise).toHaveBeenCalledTimes(6)
      // No sets should be logged for starter path
      expect(mockLogSet).not.toHaveBeenCalled()
    })

    it('chooseExplore does not log sets if addExercise returns null (empty name guard)', async () => {
      // If addExercise returns null (rejected), logSet should not be called for that exercise
      mockAddExercise.mockReturnValue(null)
      await wrapper.findAll('.obOption')[2].trigger('click')
      // logSet should not be called since all addExercise calls returned null
      expect(mockLogSet).not.toHaveBeenCalled()
    })

    it('chooseExplore passes sync:false to addExercise for sample data', async () => {
      mockAddExercise.mockReturnValue('mock-id')
      await wrapper.findAll('.obOption')[2].trigger('click')
      // Every addExercise call in chooseExplore should include { sync: false }
      const exploreCalls = mockAddExercise.mock.calls
      for (const call of exploreCalls) {
        expect(call[2]).toEqual({ sync: false })
      }
    })

    it('chooseStarter does NOT pass sync:false (starter data should sync)', async () => {
      await wrapper.findAll('.obOption')[1].trigger('click')
      const starterCalls = mockAddExercise.mock.calls
      for (const call of starterCalls) {
        // Starter exercises only pass (name, tags) — no options object
        expect(call.length).toBe(2)
      }
    })

    it('sets onboarding-complete even if no exercises are added', async () => {
      // Start Empty path
      await wrapper.findAll('.obOption')[0].trigger('click')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('onboarding-complete', 'true')
      expect(mockAddExercise).not.toHaveBeenCalled()
    })
  })
})
