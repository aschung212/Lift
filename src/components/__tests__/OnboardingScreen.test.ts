import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import OnboardingScreen from '../OnboardingScreen.vue'

// Mock stores — exercises array populated by mockAddExercise so applyPlateConfig can find them
const mockExercises: { id: string; name: string; tags: string[]; inputMode?: string; barWeight?: number }[] = []
let nextMockId = 0
const mockAddExercise = vi.fn().mockImplementation((name: string, tags: string[]) => {
  const id = `mock-id-${nextMockId++}`
  mockExercises.push({ id, name, tags })
  return id
})
const mockLogSet = vi.fn()
const mockAddEntry = vi.fn()

const mockSetExerciseInputMode = vi.fn().mockImplementation((id: string, mode: string) => {
  const ex = mockExercises.find(e => e.id === id)
  if (ex) ex.inputMode = mode
})

const mockSetStarterTheme = vi.fn()

vi.mock('../../stores/workout', () => ({
  ExerciseInputMode: {},
  useWorkoutStore: () => ({
    exercises: mockExercises,
    addExercise: mockAddExercise,
    logSet: mockLogSet,
    setExerciseInputMode: mockSetExerciseInputMode,
  })
}))

vi.mock('../../stores/bodyweight', () => ({
  useBodyweightStore: () => ({
    addEntry: mockAddEntry,
  })
}))

vi.mock('../../stores/progression', () => ({
  useProgressionStore: () => ({
    setStarterTheme: mockSetStarterTheme,
  })
}))

vi.mock('../../lib/uuid', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return { ...actual, uuid: () => 'test-uuid' }
})

import { getLocalStorageMock } from '../../__tests__/helpers'
const localStorageMock = getLocalStorageMock()

describe('OnboardingScreen', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    vi.clearAllMocks()
    mockExercises.length = 0
    nextMockId = 0
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

    it('shows Start empty option', () => {
      expect(wrapper.text()).toContain('Start empty')
      expect(wrapper.text()).toContain('Add your own exercises from scratch')
    })

    it('shows Popular exercises option', () => {
      expect(wrapper.text()).toContain('Popular exercises')
      expect(wrapper.text()).toContain('Pre-load 6 common lifts')
    })

    it('shows Explore first option', () => {
      expect(wrapper.text()).toContain('Explore first')
      expect(wrapper.text()).toContain('sample data')
    })

    it('features Popular exercises as the recommended option (gold glow)', () => {
      // Popular exercises is now the first / featured option in the restyled
      // onboarding per design_handoff_lift_ios_pwa/screens/01-auth.png.
      const featured = wrapper.find('.obOptionFeatured')
      expect(featured.exists()).toBe(true)
      expect(featured.text()).toContain('Popular exercises')
    })
  })

  describe('Start empty', () => {
    async function chooseEmptyAndSkip() {
      // Order after 01-auth.png restyle: [0] Popular, [1] Empty, [2] Explore.
      await wrapper.findAll('.obOption')[1].trigger('click')
      await wrapper.find('.spfSecondary').trigger('click')
    }

    it('advances to progression explainer step', async () => {
      await wrapper.findAll('.obOption')[1].trigger('click')
      expect(wrapper.text()).toContain('Theme Progression')
      expect(wrapper.find('.spfExplainer').exists()).toBe(true)
    })

    it('emits complete event after skipping starter', async () => {
      await chooseEmptyAndSkip()
      expect(wrapper.emitted('complete')).toHaveLength(1)
    })

    it('sets onboarding-complete in localStorage', async () => {
      await chooseEmptyAndSkip()
      expect(localStorageMock.setItem).toHaveBeenCalledWith('onboarding-complete', 'true')
    })

    it('does not add any exercises', async () => {
      await chooseEmptyAndSkip()
      expect(mockAddExercise).not.toHaveBeenCalled()
    })

    it('does not set sample-data flag', async () => {
      await chooseEmptyAndSkip()
      const sampleDataCalls = localStorageMock.setItem.mock.calls.filter(
        ([key]: [string]) => key === 'sample-data'
      )
      expect(sampleDataCalls.length).toBe(0)
    })
  })

  describe('Popular exercises', () => {
    it('adds 6 starter exercises with tags', async () => {
      // Popular is the featured / first option after the 01-auth.png restyle.
      await wrapper.findAll('.obOption')[0].trigger('click')
      expect(mockAddExercise).toHaveBeenCalledTimes(6)
      expect(mockAddExercise).toHaveBeenCalledWith('Bench Press', ['Push', 'Chest'])
      expect(mockAddExercise).toHaveBeenCalledWith('Squat', ['Legs'])
      expect(mockAddExercise).toHaveBeenCalledWith('Deadlift', ['Pull', 'Legs'])
      expect(mockAddExercise).toHaveBeenCalledWith('Overhead Press', ['Push', 'Shoulders'])
      expect(mockAddExercise).toHaveBeenCalledWith('Barbell Row', ['Pull', 'Back'])
      expect(mockAddExercise).toHaveBeenCalledWith('Pull-ups', ['Pull', 'Back'])
    })

    it('emits complete event after skipping starter', async () => {
      await wrapper.findAll('.obOption')[0].trigger('click')
      await wrapper.find('.spfSecondary').trigger('click')
      expect(wrapper.emitted('complete')).toHaveLength(1)
    })

    it('does not log any sets', async () => {
      await wrapper.findAll('.obOption')[0].trigger('click')
      expect(mockLogSet).not.toHaveBeenCalled()
    })

    it('sets plate calculator mode on barbell exercises via store method', async () => {
      await wrapper.findAll('.obOption')[0].trigger('click')
      // setExerciseInputMode should be called for each barbell exercise (not Pull-ups)
      expect(mockSetExerciseInputMode).toHaveBeenCalledTimes(5)
      const barbellNames = ['Bench Press', 'Squat', 'Deadlift', 'Overhead Press', 'Barbell Row']
      for (const name of barbellNames) {
        const ex = mockExercises.find(e => e.name === name)
        expect(ex, `${name} should exist`).toBeDefined()
        expect(ex!.inputMode).toBe('plates')
      }
      const pullups = mockExercises.find(e => e.name === 'Pull-ups')
      expect(pullups).toBeDefined()
      expect(pullups!.inputMode).toBeUndefined()
    })
  })

  describe('Explore first (sample data)', () => {
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

    it('sets sample-data flag in localStorage after skipping starter', async () => {
      await wrapper.findAll('.obOption')[2].trigger('click')
      await wrapper.find('.spfSecondary').trigger('click')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('sample-data', 'true')
    })

    it('emits complete event after skipping starter', async () => {
      await wrapper.findAll('.obOption')[2].trigger('click')
      await wrapper.find('.spfSecondary').trigger('click')
      expect(wrapper.emitted('complete')).toHaveLength(1)
    })

    it('logs sets for 5 exercises with sample data', async () => {
      await wrapper.findAll('.obOption')[2].trigger('click')
      // Extended sample data: ~365 days across 5 exercises (multiple sets per session)
      expect(mockLogSet.mock.calls.length).toBe(367)
    })

    it('sets plate calculator mode on barbell exercises', async () => {
      await wrapper.findAll('.obOption')[2].trigger('click')
      const barbellNames = ['Bench Press', 'Squat', 'Deadlift', 'Overhead Press', 'Barbell Row']
      for (const name of barbellNames) {
        const ex = mockExercises.find(e => e.name === name)
        expect(ex, `${name} should exist`).toBeDefined()
        expect(ex!.inputMode).toBe('plates')
        expect(ex!.barWeight).toBe(45)
      }
      // Pull-ups should NOT have plate calculator
      const pullups = mockExercises.find(e => e.name === 'Pull-ups')
      expect(pullups).toBeDefined()
      expect(pullups!.inputMode).toBeUndefined()
    })
  })

  // ── Edge cases (MAS-270) ────────────────────────────────────────
  describe('edge cases', () => {
    it('chooseStarter does not duplicate exercises that already exist', async () => {
      // Simulate existing exercises by having addExercise return the same id
      // (the real store returns existing id for duplicates)
      mockAddExercise.mockReturnValue('existing-id')
      await wrapper.findAll('.obOption')[0].trigger('click')
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
      // Start empty path → skip starter. After 01-auth.png restyle, the "Start empty"
      // option is the second one (index 1) — Popular exercises is featured/first.
      await wrapper.findAll('.obOption')[1].trigger('click')
      await wrapper.find('.spfSecondary').trigger('click')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('onboarding-complete', 'true')
      expect(mockAddExercise).not.toHaveBeenCalled()
    })
  })

  describe('starter theme picker', () => {
    async function goToStarterPicker() {
      await wrapper.findAll('.obOption')[0].trigger('click') // → explainer
      await wrapper.find('.spfPrimary').trigger('click') // → starter picker
    }

    it('shows explainer before starter picker', async () => {
      await wrapper.findAll('.obOption')[0].trigger('click')
      expect(wrapper.text()).toContain('Theme Progression')
      expect(wrapper.text()).toContain('Every set you log earns XP')
    })

    it('shows three starter theme options after explainer', async () => {
      await goToStarterPicker()
      expect(wrapper.findAll('.spfCard')).toHaveLength(3)
      expect(wrapper.text()).toContain('Intensity')
      expect(wrapper.text()).toContain('Flow')
      expect(wrapper.text()).toContain('Luck')
    })

    it('confirm button is disabled until a theme is selected', async () => {
      await goToStarterPicker()
      const confirm = wrapper.findAll('.spfPrimary').at(-1)!
      expect((confirm.element as HTMLButtonElement).disabled).toBe(true)
    })

    it('selecting a theme enables the confirm button', async () => {
      await goToStarterPicker()
      await wrapper.findAll('.spfCard')[0].trigger('click')
      const confirm = wrapper.findAll('.spfPrimary').at(-1)!
      expect((confirm.element as HTMLButtonElement).disabled).toBe(false)
    })

    it('confirming a starter calls setStarterTheme after goal step', async () => {
      await goToStarterPicker()
      await wrapper.findAll('.spfCard')[0].trigger('click') // Fire
      await wrapper.findAll('.spfPrimary').at(-1)!.trigger('click') // → goal step
      await wrapper.find('.spfPrimary').trigger('click') // → confirm
      expect(mockSetStarterTheme).toHaveBeenCalledWith('fire', 3)
      expect(wrapper.emitted('complete')).toHaveLength(1)
    })

    it('skipping from explainer does not call setStarterTheme', async () => {
      await wrapper.findAll('.obOption')[0].trigger('click') // → explainer
      await wrapper.find('.spfSecondary').trigger('click') // skip
      expect(mockSetStarterTheme).not.toHaveBeenCalled()
      expect(wrapper.emitted('complete')).toHaveLength(1)
    })
  })
})
