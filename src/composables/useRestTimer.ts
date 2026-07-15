import { computed, type Ref } from 'vue'
import { usePreferencesStore } from '../stores/preferences'

export interface UseRestTimerReturn {
  restTimerEnabled: Ref<boolean>
  restTimerAutoStart: Ref<boolean>
  setRestTimerEnabled: (enabled: boolean) => void
}

/**
 * Rest-timer settings accessor. The preferences store is the single source of
 * truth (LIFT-821) — both flags are writable computeds bound to the store, so
 * reads reflect `preferences` and writes flow through `setRestTimer` /
 * `setRestTimerAutoStart` (which persist the blob + legacy keys + Supabase).
 * This composable no longer holds its own module-scope refs or touches
 * localStorage directly.
 */
export function useRestTimer(): UseRestTimerReturn {
  const prefs = usePreferencesStore()

  const restTimerEnabled = computed<boolean>({
    get: () => prefs.restTimerEnabled,
    set: (v) => prefs.setRestTimer(v),
  })

  const restTimerAutoStart = computed<boolean>({
    get: () => prefs.restTimerAutoStart,
    set: (v) => prefs.setRestTimerAutoStart(v),
  })

  function setRestTimerEnabled(enabled: boolean): void {
    prefs.setRestTimer(enabled)
  }

  return { restTimerEnabled, restTimerAutoStart, setRestTimerEnabled }
}
