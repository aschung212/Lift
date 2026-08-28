import { ref, computed, watch, type ComputedRef, type Ref } from 'vue'

const ONBOARDING_KEY = 'onboarding-complete'
const SAMPLE_DATA_KEY = 'sample-data'
const FRESH_START_KEY = 'fresh-start'

/**
 * The minimal store surface the onboarding flow depends on. Kept structural
 * (not the full Pinia store type) so the composable stays decoupled and can be
 * unit-tested with lightweight fakes.
 */
export interface OnboardingStores {
  workoutStore: {
    exercises: ReadonlyArray<{ id: string }>
    deleteExercise: (id: string) => void
  }
  bodyweightStore: {
    entries: ReadonlyArray<unknown>
    clearAll: () => void
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
  /** True while the seeded sample dataset is still present. */
  hasSampleData: Ref<boolean>
  /** Mark onboarding finished (from the OnboardingScreen `complete` event). */
  completeOnboarding: () => void
  /** Delete the seeded sample data and start the user fresh. */
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

  const onboardingComplete = ref(!!localStorage.getItem(ONBOARDING_KEY))
  const onboardingInProgress = ref(false)
  const hasSampleData = ref(localStorage.getItem(SAMPLE_DATA_KEY) === 'true')

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

  function completeOnboarding() {
    onboardingInProgress.value = false
    onboardingComplete.value = true
    hasSampleData.value = localStorage.getItem(SAMPLE_DATA_KEY) === 'true'
  }

  function clearSampleData() {
    // Snapshot ids first — deleteExercise mutates the underlying array.
    const exerciseIds = [...workoutStore.exercises.map(e => e.id)]
    for (const id of exerciseIds) {
      workoutStore.deleteExercise(id)
    }
    bodyweightStore.clearAll()
    localStorage.removeItem(SAMPLE_DATA_KEY)
    localStorage.setItem(FRESH_START_KEY, 'true')
    hasSampleData.value = false
    window.dispatchEvent(new CustomEvent(FRESH_START_KEY))
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
