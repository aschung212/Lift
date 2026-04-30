import { onUnmounted } from 'vue'
import { startCrossTabListener, stopCrossTabListener } from '../lib/crossTabSync'
import { useWorkoutStore } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { usePreferencesStore } from '../stores/preferences'
import { useProgressionStore } from '../stores/progression'

/** Storage keys mirroring each store's STORAGE_KEY constant. */
const STORAGE_KEYS: Record<string, string> = {
  workout: 'workout-exercises',
  bodyweight: 'bodyweight-entries',
  preferences: 'user-preferences',
  progression: 'user-progression',
}

/**
 * Set up cross-tab sync listeners. When another tab persists a store update,
 * this tab reloads the affected store from localStorage.
 *
 * Call once in the root component (App.vue) after stores are initialized.
 */
export function useCrossTabSync(): void {
  startCrossTabListener((storeName: string) => {
    const key = STORAGE_KEYS[storeName]
    if (!key) return

    const raw = localStorage.getItem(key)
    if (!raw) return

    try {
      if (storeName === 'workout') {
        const store = useWorkoutStore()
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          store.exercises = parsed
        }
      } else if (storeName === 'bodyweight') {
        const store = useBodyweightStore()
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          store.entries = parsed
        }
      } else if (storeName === 'preferences') {
        const store = usePreferencesStore()
        const parsed = JSON.parse(raw)
        if (parsed.features) store.features = parsed.features
        if (parsed.weightGoal) store.weightGoal = parsed.weightGoal
        if (parsed.experience) store.experience = parsed.experience
      } else if (storeName === 'progression') {
        const store = useProgressionStore()
        const parsed = JSON.parse(raw)
        // Merge progression state without overwriting _userId
        const userId = store._userId
        store.$patch(parsed)
        store._userId = userId
      }
    } catch {
      // Corrupt localStorage data — ignore, next sync will fix it
    }
  })

  onUnmounted(() => {
    stopCrossTabListener()
  })
}
