import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reactive, nextTick } from 'vue'
import { useOnboarding, type OnboardingStores } from '../useOnboarding'

function makeStores(): OnboardingStores & {
  workoutStore: { exercises: Array<{ id: string }>; deleteExercise: (id: string) => void }
  bodyweightStore: { entries: unknown[]; clearAll: () => void }
} {
  const workoutStore = reactive({
    exercises: [] as Array<{ id: string }>,
    deleteExercise(id: string) {
      const i = workoutStore.exercises.findIndex(e => e.id === id)
      if (i >= 0) workoutStore.exercises.splice(i, 1)
    },
  })
  const bodyweightStore = reactive({
    entries: [] as unknown[],
    clearAll() {
      bodyweightStore.entries.splice(0, bodyweightStore.entries.length)
    },
  })
  return { workoutStore, bodyweightStore }
}

describe('useOnboarding', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows onboarding when there is no flag and no data', () => {
    const { showOnboarding } = useOnboarding(makeStores())
    expect(showOnboarding.value).toBe(true)
  })

  it('does not show onboarding when the completion flag is already set', () => {
    localStorage.setItem('onboarding-complete', 'true')
    const { showOnboarding } = useOnboarding(makeStores())
    expect(showOnboarding.value).toBe(false)
  })

  it('auto-completes immediately when the user already has data on init', () => {
    const stores = makeStores()
    stores.workoutStore.exercises.push({ id: 'a' })
    const { showOnboarding } = useOnboarding(stores)
    expect(showOnboarding.value).toBe(false)
    expect(localStorage.getItem('onboarding-complete')).toBe('true')
  })

  it('auto-completes when data appears asynchronously after init', async () => {
    const stores = makeStores()
    const { showOnboarding } = useOnboarding(stores)
    expect(showOnboarding.value).toBe(true)

    stores.bodyweightStore.entries.push({ weight: 180 })
    await nextTick()
    expect(showOnboarding.value).toBe(false)
    expect(localStorage.getItem('onboarding-complete')).toBe('true')
  })

  it('does not auto-complete while onboarding is in progress', async () => {
    const stores = makeStores()
    const { showOnboarding, onboardingInProgress } = useOnboarding(stores)
    onboardingInProgress.value = true

    // Onboarding screen itself adds an exercise — must not flip complete.
    stores.workoutStore.exercises.push({ id: 'seed' })
    await nextTick()
    expect(showOnboarding.value).toBe(true)
    expect(localStorage.getItem('onboarding-complete')).toBeNull()
  })

  it('completeOnboarding finishes onboarding and refreshes sample-data state', () => {
    localStorage.setItem('sample-data', 'true')
    const { showOnboarding, onboardingInProgress, hasSampleData, completeOnboarding } =
      useOnboarding(makeStores())
    onboardingInProgress.value = true
    completeOnboarding()
    expect(onboardingInProgress.value).toBe(false)
    expect(showOnboarding.value).toBe(false)
    expect(hasSampleData.value).toBe(true)
  })

  it('clearSampleData wipes seeded data and signals a fresh start', () => {
    localStorage.setItem('sample-data', 'true')
    const stores = makeStores()
    stores.workoutStore.exercises.push({ id: 'x' }, { id: 'y' })
    stores.bodyweightStore.entries.push({ weight: 1 })

    const clearAllSpy = vi.spyOn(stores.bodyweightStore, 'clearAll')
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    const { hasSampleData, clearSampleData } = useOnboarding(stores)
    clearSampleData()

    expect(stores.workoutStore.exercises).toHaveLength(0)
    expect(clearAllSpy).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('sample-data')).toBeNull()
    expect(localStorage.getItem('fresh-start')).toBe('true')
    expect(hasSampleData.value).toBe(false)
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(CustomEvent))
    expect((dispatchSpy.mock.calls.at(-1)![0] as CustomEvent).type).toBe('fresh-start')
  })

  it('resetOnboarding clears the persisted flag and re-shows onboarding', () => {
    localStorage.setItem('onboarding-complete', 'true')
    const { showOnboarding, resetOnboarding } = useOnboarding(makeStores())
    expect(showOnboarding.value).toBe(false)
    resetOnboarding()
    expect(showOnboarding.value).toBe(true)
    expect(localStorage.getItem('onboarding-complete')).toBeNull()
  })
})
