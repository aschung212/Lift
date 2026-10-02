import { ref, computed, watch, type ComputedRef, type Ref } from 'vue'
import type { Exercise, RemovedExercise } from '../stores/workout'
import type { BodyweightEntry } from '../stores/bodyweight'
import { SAMPLE_DATA_KEY, isExploringSampleData } from '../lib/sampleData'
import { useUndoToast } from './useUndoToast'

const ONBOARDING_KEY = 'onboarding-complete'
const FRESH_START_KEY = 'fresh-start'

/**
 * The minimal store surface the onboarding flow depends on. Kept structural
 * (not the full Pinia store type) so the composable stays decoupled and can be
 * unit-tested with lightweight fakes.
 */
export interface OnboardingStores {
  workoutStore: {
    exercises: ReadonlyArray<Pick<Exercise, 'sample'>>
    removeSampleExercises: () => RemovedExercise[]
    restoreSampleExercises: (removed: readonly RemovedExercise[]) => void
  }
  bodyweightStore: {
    entries: ReadonlyArray<Pick<BodyweightEntry, 'sample'>>
    removeSampleEntries: () => BodyweightEntry[]
    restoreSampleEntries: (removed: readonly BodyweightEntry[]) => void
  }
}

export interface Onboarding {
  /** True while the onboarding screen should be shown. */
  showOnboarding: ComputedRef<boolean>
  /**
   * True while the onboarding screen itself is adding data, so the
   * auto-complete watcher doesn't fire on exercises it created.
   */
  onboardingInProgress: Ref<boolean>
  /**
   * True while the user is looking at sample data they chose to explore:
   * "Explore first" was picked AND some of the rows it seeded are still here.
   */
  hasSampleData: ComputedRef<boolean>
  /** Mark onboarding finished (from the OnboardingScreen `complete` event). */
  completeOnboarding: () => void
  /** Remove what is left of the seeded sample data, with an undo toast. */
  clearSampleData: () => void
  /** Reset the persisted onboarding flag (used on sign-out). */
  resetOnboarding: () => void
}

/**
 * Owns onboarding lifecycle for the app shell: persisted completion state,
 * auto-completion once the user has any real data, sample-data teardown, and
 * the sign-out reset. Stores are injected so App.vue can acquire each store
 * once and hand references in, rather than re-calling the store hooks inside
 * scattered handlers.
 */
export function useOnboarding(stores: OnboardingStores): Onboarding {
  const { workoutStore, bodyweightStore } = stores
  const { show: showUndo } = useUndoToast()

  const onboardingComplete = ref(!!localStorage.getItem(ONBOARDING_KEY))
  const onboardingInProgress = ref(false)

  // Skip onboarding if the user already has any data (exercises or bodyweight
  // entries). Reactive so it catches data that loads asynchronously after auth.
  // onboardingInProgress prevents the watcher from firing when the onboarding
  // screen itself adds exercises (e.g. Popular Exercises option).
  watch(
    () => workoutStore.exercises.length + bodyweightStore.entries.length,
    (total) => {
      if (!onboardingComplete.value && !onboardingInProgress.value && total > 0) {
        localStorage.setItem(ONBOARDING_KEY, 'true')
        onboardingComplete.value = true
      }
    },
    { immediate: true },
  )

  const showOnboarding = computed(() => !onboardingComplete.value)

  // ── Sample data (LIFT-1527) ─────────────────────────────────────
  // Two facts, and the banner needs both. The `sample-data` flag records that
  // the user picked "Explore first"; the rows' own `sample` flag says which
  // data is still the seeded demo. The banner used to read only the first, a
  // flag that stayed set after the data it described had become real or gone:
  // a sample exercise adopted by the user's first real set (and pushed to the
  // server with it), or a store wiped by sign-out while App.vue's copy of the
  // flag stayed true for the next account to sign in. The flag alone is not
  // enough either, because a Strong/Hevy CSV import also creates rows flagged
  // `sample` (LIFT-1526), and they must not grow a "clear" button for a user
  // who never explored.
  const sampleDataChosen = ref(isExploringSampleData())
  const sampleDataPresent = computed(() =>
    workoutStore.exercises.some(e => e.sample) ||
    bodyweightStore.entries.some(e => e.sample),
  )
  const hasSampleData = computed(() => sampleDataChosen.value && sampleDataPresent.value)

  // Retire the flag with the last of its data, whatever removed it (the clear
  // below, real use adopting every row, a sign-out wipe), so a leftover flag
  // cannot later put the banner over rows it does not describe. The undo
  // raises it again along with the data.
  watch(
    sampleDataPresent,
    (present) => {
      if (present || !sampleDataChosen.value) return
      sampleDataChosen.value = false
      localStorage.removeItem(SAMPLE_DATA_KEY)
    },
    { immediate: true },
  )

  function completeOnboarding() {
    onboardingInProgress.value = false
    onboardingComplete.value = true
    sampleDataChosen.value = isExploringSampleData()
  }

  /**
   * Remove the sample data that is still sample data, and nothing else.
   *
   * This used to delete EVERY exercise and call the bodyweight store's
   * `clearAll`, with no confirmation and no undo: the user's own exercises and
   * any sample exercise their real sets had adopted were soft-deleted on the
   * server, and so was every live bodyweight row on the account, weigh-ins
   * logged on other devices included. Now it removes only rows still flagged
   * `sample`, which were never pushed, so the whole operation stays on this
   * device. That is also why the undo can be a plain local restore.
   */
  function clearSampleData() {
    // The banner only renders while this is true. The guard covers a second
    // tap that lands before the banner unmounts, and any other caller.
    if (!hasSampleData.value) return
    const removedExercises = workoutStore.removeSampleExercises()
    const removedEntries = bodyweightStore.removeSampleEntries()
    // The "You're starting fresh!" card is the empty-list state; with the
    // user's own exercises still listed there is no fresh start to announce.
    if (workoutStore.exercises.length === 0) {
      localStorage.setItem(FRESH_START_KEY, 'true')
      window.dispatchEvent(new CustomEvent(FRESH_START_KEY))
    }
    showUndo(
      'Sample data cleared',
      () => {
        workoutStore.restoreSampleExercises(removedExercises)
        bodyweightStore.restoreSampleEntries(removedEntries)
        localStorage.removeItem(FRESH_START_KEY)
        localStorage.setItem(SAMPLE_DATA_KEY, 'true')
        sampleDataChosen.value = true
      },
      // Nothing to commit: the removal is already final on this device, and
      // these rows never reached the server.
      () => {},
    )
  }

  function resetOnboarding() {
    localStorage.removeItem(ONBOARDING_KEY)
    onboardingComplete.value = false
  }

  return {
    showOnboarding,
    onboardingInProgress,
    hasSampleData,
    completeOnboarding,
    clearSampleData,
    resetOnboarding,
  }
}
