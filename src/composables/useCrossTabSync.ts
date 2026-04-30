import { useWorkoutStore } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { usePreferencesStore } from '../stores/preferences'
import { useProgressionStore } from '../stores/progression'
import { initCrossTabSync, onStoreUpdate } from '../lib/crossTabSync'

let _initialized = false

/**
 * Initialize cross-tab sync: register reload callbacks for all stores.
 * Call once from App.vue after Pinia is available.
 */
export function useCrossTabSync(): void {
  if (_initialized) return
  _initialized = true

  if (!initCrossTabSync()) return // BroadcastChannel not supported

  const workoutStore = useWorkoutStore()
  const bodyweightStore = useBodyweightStore()
  const preferencesStore = usePreferencesStore()
  const progressionStore = useProgressionStore()

  onStoreUpdate('workout-exercises', () => workoutStore._reloadFromLocalStorage())
  onStoreUpdate('bodyweight-entries', () => bodyweightStore._reloadFromLocalStorage())
  onStoreUpdate('user-preferences', () => preferencesStore._reloadFromLocalStorage())
  onStoreUpdate('user-progression', () => progressionStore._reloadFromLocalStorage())
}
