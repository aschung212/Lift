import { onUnmounted } from 'vue'
import { useWorkoutStore } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { usePreferencesStore } from '../stores/preferences'
import { useProgressionStore } from '../stores/progression'
import { onCrossTabUpdate, type StoreName } from '../lib/crossTabSync'
import { logWarn } from '../lib/logger'

/**
 * Reload a store's state from localStorage when another tab broadcasts a mutation.
 *
 * This composable subscribes to BroadcastChannel messages and patches the
 * affected Pinia store with the latest localStorage data. It avoids a full
 * page reload — only the changed store is refreshed.
 *
 * Call once in App.vue after stores are available.
 */
export function useCrossTabSync(): void {
  const reloaders: Record<StoreName, () => void> = {
    workout() {
      const store = useWorkoutStore()
      try {
        const raw = localStorage.getItem('workout-exercises')
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            store.exercises = parsed
          }
        }
        // Also reload tag-related state
        store.customTags = JSON.parse(localStorage.getItem('lift-custom-tags') || '[]')
        store.tagRecoveryDays = JSON.parse(localStorage.getItem('lift-tag-recovery-days') || '{}')
        store.tagRecoveryExcluded = JSON.parse(localStorage.getItem('lift-tag-recovery-excluded') || '[]')
      } catch {
        logWarn('Cross-tab sync: failed to reload workout store')
      }
    },

    bodyweight() {
      const store = useBodyweightStore()
      try {
        const raw = localStorage.getItem('bodyweight-entries')
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            store.entries = parsed
          }
        }
      } catch {
        logWarn('Cross-tab sync: failed to reload bodyweight store')
      }
    },

    preferences() {
      const store = usePreferencesStore()
      try {
        const raw = localStorage.getItem('user-preferences')
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed.features) store.features = { workouts: true, calendar: true, weight: true, ...parsed.features }
          if (parsed.weightGoal) store.weightGoal = { ...store.weightGoal, ...parsed.weightGoal }
          if (parsed.experience) store.experience = { ...store.experience, ...parsed.experience }
        }
      } catch {
        logWarn('Cross-tab sync: failed to reload preferences store')
      }
    },

    progression() {
      const store = useProgressionStore()
      try {
        const raw = localStorage.getItem('user-progression')
        if (raw) {
          const parsed = JSON.parse(raw)
          // Patch all state fields except _userId (auth-scoped, not from localStorage)
          const { _userId } = store.$state
          store.$patch({ ...parsed, _userId })
        }
      } catch {
        logWarn('Cross-tab sync: failed to reload progression store')
      }
    },
  }

  const unsubscribe = onCrossTabUpdate((store: StoreName) => {
    const reload = reloaders[store]
    if (reload) reload()
  })

  onUnmounted(unsubscribe)
}
