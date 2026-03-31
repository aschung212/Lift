import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
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

vi.mock('../../lib/supabase', () => ({ supabase: null }))
vi.mock('../../lib/uuid', () => ({ uuid: () => 'test-uuid' }))

const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val) }),
    removeItem: vi.fn(key => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()
vi.stubGlobal('localStorage', localStorageMock)

describe('OnboardingScreen', () => {
  let wrapper

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
        ([key]) => key === 'sample-data'
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
      // Should have 35 sample weight entries
      expect(mockAddEntry.mock.calls.length).toBe(35)
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
      // Bench (31) + Squat (22) + Deadlift (16) + OHP (15) + Barbell Row (14) = 98 sets
      expect(mockLogSet.mock.calls.length).toBe(98)
    })
  })
})
