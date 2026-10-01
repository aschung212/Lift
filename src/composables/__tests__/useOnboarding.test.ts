import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reactive, nextTick, effectScope, type EffectScope } from 'vue'
import { useOnboarding, type OnboardingStores } from '../useOnboarding'
import { useUndoToast } from '../useUndoToast'
import type { Exercise, RemovedExercise } from '../../stores/workout'
import type { BodyweightEntry } from '../../stores/bodyweight'

function exercise(id: string, { sample = false } = {}): Exercise {
  return { id, name: id, tags: [], sets: [], ...(sample ? { sample: true } : {}) }
}

function entry(id: string, { sample = false } = {}): BodyweightEntry {
  return { id, date: '2026-09-01T23:59:30.000Z', weight: 180, ...(sample ? { sample: true } : {}) }
}

/**
 * Fakes with the stores' remove/restore contract: drop exactly the rows still
 * flagged `sample`, hand them back, and put them back on undo. The real
 * stores, and what reaches the server, are covered in sampleDataClear.test.ts.
 */
function makeStores() {
  const workoutStore = reactive({
    exercises: [] as Exercise[],
    removeSampleExercises(): RemovedExercise[] {
      const removed: RemovedExercise[] = []
      workoutStore.exercises.forEach((ex, index) => {
        if (ex.sample) removed.push({ exercise: ex, index })
      })
      workoutStore.exercises = workoutStore.exercises.filter(ex => !ex.sample)
      return removed
    },
    restoreSampleExercises(removed: readonly RemovedExercise[]) {
      for (const { exercise: ex, index } of removed) workoutStore.exercises.splice(index, 0, ex)
    },
  })
  const bodyweightStore = reactive({
    entries: [] as BodyweightEntry[],
    removeSampleEntries(): BodyweightEntry[] {
      const removed = bodyweightStore.entries.filter(e => e.sample)
      bodyweightStore.entries = bodyweightStore.entries.filter(e => !e.sample)
      return removed
    },
    restoreSampleEntries(removed: readonly BodyweightEntry[]) {
      bodyweightStore.entries.push(...removed)
    },
  })
  return { workoutStore, bodyweightStore } satisfies OnboardingStores
}

describe('useOnboarding', () => {
  let scope: EffectScope

  /** Run the composable inside a scope so its watchers stop with the test. */
  function setup(stores: OnboardingStores) {
    return scope.run(() => useOnboarding(stores))!
  }

  beforeEach(() => {
    localStorage.clear()
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    useUndoToast().destroy()
    vi.restoreAllMocks()
  })

  it('shows onboarding when there is no flag and no data', () => {
    const { showOnboarding } = setup(makeStores())
    expect(showOnboarding.value).toBe(true)
  })

  it('does not show onboarding when the completion flag is already set', () => {
    localStorage.setItem('onboarding-complete', 'true')
    const { showOnboarding } = setup(makeStores())
    expect(showOnboarding.value).toBe(false)
  })

  it('auto-completes immediately when the user already has data on init', () => {
    const stores = makeStores()
    stores.workoutStore.exercises.push(exercise('a'))
    const { showOnboarding } = setup(stores)
    expect(showOnboarding.value).toBe(false)
    expect(localStorage.getItem('onboarding-complete')).toBe('true')
  })

  it('auto-completes when data appears asynchronously after init', async () => {
    const stores = makeStores()
    const { showOnboarding } = setup(stores)
    expect(showOnboarding.value).toBe(true)

    stores.bodyweightStore.entries.push(entry('bw-1'))
    await nextTick()
    expect(showOnboarding.value).toBe(false)
    expect(localStorage.getItem('onboarding-complete')).toBe('true')
  })

  it('does not auto-complete while onboarding is in progress', async () => {
    const stores = makeStores()
    const { showOnboarding, onboardingInProgress } = setup(stores)
    onboardingInProgress.value = true

    // Onboarding screen itself adds an exercise — must not flip complete.
    stores.workoutStore.exercises.push(exercise('seed'))
    await nextTick()
    expect(showOnboarding.value).toBe(true)
    expect(localStorage.getItem('onboarding-complete')).toBeNull()
  })

  it('completeOnboarding finishes onboarding and picks up the explore path\'s sample data', () => {
    const stores = makeStores()
    const { showOnboarding, onboardingInProgress, hasSampleData, completeOnboarding } = setup(stores)
    onboardingInProgress.value = true

    // What OnboardingScreen.finish() does on "Explore first": seed, flag, emit.
    stores.workoutStore.exercises.push(exercise('bench', { sample: true }))
    localStorage.setItem('sample-data', 'true')
    completeOnboarding()

    expect(onboardingInProgress.value).toBe(false)
    expect(showOnboarding.value).toBe(false)
    expect(hasSampleData.value).toBe(true)
  })

  it('resetOnboarding clears the persisted flag and re-shows onboarding', () => {
    localStorage.setItem('onboarding-complete', 'true')
    const { showOnboarding, resetOnboarding } = setup(makeStores())
    expect(showOnboarding.value).toBe(false)
    resetOnboarding()
    expect(showOnboarding.value).toBe(true)
    expect(localStorage.getItem('onboarding-complete')).toBeNull()
  })

  describe('sample data (LIFT-1527)', () => {
    /** An explorer who has also started training for real. */
    function explorerWithRealData() {
      localStorage.setItem('sample-data', 'true')
      const stores = makeStores()
      stores.workoutStore.exercises.push(
        exercise('sample-bench', { sample: true }),
        // A sample exercise the user's first real set adopted: its flag is
        // gone and it now lives on the server with that set.
        exercise('adopted-squat'),
        exercise('sample-deadlift', { sample: true }),
        exercise('own-curl'),
      )
      stores.bodyweightStore.entries.push(
        entry('sample-bw-1', { sample: true }),
        entry('other-device-bw'),
        entry('sample-bw-2', { sample: true }),
      )
      return stores
    }

    const exerciseIds = (stores: ReturnType<typeof makeStores>) =>
      stores.workoutStore.exercises.map(e => e.id)
    const entryIds = (stores: ReturnType<typeof makeStores>) =>
      stores.bodyweightStore.entries.map(e => e.id)

    it('removes only the rows still flagged sample', () => {
      const stores = explorerWithRealData()
      const { clearSampleData } = setup(stores)

      clearSampleData()

      // Before the fix every exercise and every bodyweight entry went, the
      // adopted exercise and the other device's weigh-in included.
      expect(exerciseIds(stores)).toEqual(['adopted-squat', 'own-curl'])
      expect(entryIds(stores)).toEqual(['other-device-bw'])
    })

    it('offers an undo that puts the sample data back and re-raises the banner', async () => {
      const stores = explorerWithRealData()
      const { hasSampleData, clearSampleData } = setup(stores)
      const { toast, performUndo } = useUndoToast()

      clearSampleData()
      await nextTick()
      expect(toast.value?.message).toBe('Sample data cleared')
      expect(hasSampleData.value).toBe(false)
      expect(localStorage.getItem('sample-data')).toBeNull()

      performUndo()
      await nextTick()

      expect(exerciseIds(stores)).toEqual(['sample-bench', 'adopted-squat', 'sample-deadlift', 'own-curl'])
      expect(entryIds(stores)).toEqual(expect.arrayContaining(['sample-bw-1', 'sample-bw-2', 'other-device-bw']))
      expect(hasSampleData.value).toBe(true)
      expect(localStorage.getItem('sample-data')).toBe('true')
    })

    it('announces a fresh start when the clear leaves the exercise list empty', () => {
      localStorage.setItem('sample-data', 'true')
      const stores = makeStores()
      stores.workoutStore.exercises.push(exercise('sample-bench', { sample: true }))
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

      setup(stores).clearSampleData()

      expect(localStorage.getItem('fresh-start')).toBe('true')
      expect((dispatchSpy.mock.calls.at(-1)![0] as CustomEvent).type).toBe('fresh-start')
    })

    it('does not announce a fresh start while the user\'s own exercises are still listed', () => {
      const stores = explorerWithRealData()
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

      setup(stores).clearSampleData()

      expect(localStorage.getItem('fresh-start')).toBeNull()
      expect(dispatchSpy).not.toHaveBeenCalled()
    })

    it('undo withdraws the fresh-start card along with the empty list', () => {
      localStorage.setItem('sample-data', 'true')
      const stores = makeStores()
      stores.workoutStore.exercises.push(exercise('sample-bench', { sample: true }))
      setup(stores).clearSampleData()
      expect(localStorage.getItem('fresh-start')).toBe('true')

      useUndoToast().performUndo()

      expect(localStorage.getItem('fresh-start')).toBeNull()
    })

    it('a second tap before the banner unmounts clears nothing more and raises no second toast', () => {
      const stores = explorerWithRealData()
      const { clearSampleData } = setup(stores)
      const remove = vi.spyOn(stores.workoutStore, 'removeSampleExercises')

      clearSampleData()
      const first = useUndoToast().toast.value
      clearSampleData()

      expect(remove).toHaveBeenCalledTimes(1)
      expect(useUndoToast().toast.value?.id).toBe(first?.id)
    })

    it('hides the banner, and retires the flag, once real use has adopted the last sample row', async () => {
      localStorage.setItem('sample-data', 'true')
      const stores = makeStores()
      stores.workoutStore.exercises.push(exercise('sample-bench', { sample: true }))
      const { hasSampleData } = setup(stores)
      expect(hasSampleData.value).toBe(true)

      // `_adoptExercise` deletes the flag in place when a real set is logged.
      delete stores.workoutStore.exercises[0].sample
      await nextTick()

      expect(hasSampleData.value).toBe(false)
      expect(localStorage.getItem('sample-data')).toBeNull()
    })

    it('a flag left behind by a sign-out wipe never puts the banner over the next account\'s data', () => {
      // The previous session explored and signed out without clearing: the
      // stores were wiped, the flag was not. App.vue used to keep showing the
      // banner, and its tap deleted the next account's real rows.
      localStorage.setItem('sample-data', 'true')
      const stores = makeStores()
      stores.workoutStore.exercises.push(exercise('real-bench'))
      stores.bodyweightStore.entries.push(entry('real-bw'))
      const remove = vi.spyOn(stores.workoutStore, 'removeSampleExercises')

      const { hasSampleData, clearSampleData } = setup(stores)
      expect(hasSampleData.value).toBe(false)
      expect(localStorage.getItem('sample-data')).toBeNull()

      clearSampleData()
      expect(remove).not.toHaveBeenCalled()
      expect(exerciseIds(stores)).toEqual(['real-bench'])
    })

    it('never offers to clear sample-flagged rows the user did not choose to explore', () => {
      // A Strong/Hevy CSV import also creates rows flagged `sample` (LIFT-1526).
      // Without the explore flag they are the user's history, not a demo.
      const stores = makeStores()
      stores.workoutStore.exercises.push(exercise('imported-bench', { sample: true }))
      const { hasSampleData, clearSampleData } = setup(stores)

      expect(hasSampleData.value).toBe(false)
      clearSampleData()
      expect(exerciseIds(stores)).toEqual(['imported-bench'])
    })
  })
})
