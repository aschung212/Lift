import { onUnmounted } from 'vue'
import { onStoreUpdate, closeCrossTabSync } from '../lib/crossTabSync'
import { useWorkoutStore } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { usePreferencesStore } from '../stores/preferences'
import { useProgressionStore } from '../stores/progression'

/**
 * Composable that listens for cross-tab store updates via BroadcastChannel
 * and reloads the affected Pinia store from localStorage.
 *
 * Call once in App.vue (or any root-level component). The listener is
 * automatically cleaned up when the component unmounts.
 */
export function useCrossTabSync(): void {
  const unsubscribe = onStoreUpdate((store) => {
    switch (store) {
      case 'workout':
        useWorkoutStore()._reloadFromStorage()
        break
      case 'bodyweight':
        useBodyweightStore()._reloadFromStorage()
        break
      case 'preferences':
        usePreferencesStore()._reloadFromStorage()
        break
      case 'progression':
        useProgressionStore()._reloadFromStorage()
        break
    }
  })

  onUnmounted(() => {
    unsubscribe()
    closeCrossTabSync()
  })
}
