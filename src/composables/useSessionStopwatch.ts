/**
 * Live in-workout session stopwatch composable (LIFT-926).
 *
 * Drives the running "time since your first set today" clock rendered next to
 * the Finish-workout affordance in WorkoutTracker. Strong and Hevy both surface
 * a live session duration during an active workout; Lift previously only
 * computed it retrospectively in WorkoutCompleteView.
 *
 * The clock is purely a function of when the current day's first set was
 * logged. UI-logged sets carry an `endOfDayISO` timestamp (no real wall clock),
 * so the real start is captured once and persisted device-local (NOT synced) so
 * it survives a reload or backgrounding within the session. Pure decisions live
 * in `src/lib/sessionStopwatch.ts`; this composable only owns the tick loop and
 * lifecycle wiring (cleaning up its interval + listener on unmount).
 */

import { ref, computed, watch, onMounted, onUnmounted, type Ref, type ComputedRef } from 'vue'
import { todayISO } from '../lib/dates'
import { loadJSON } from '../lib/storage'
import {
  formatSessionClock,
  resolveSessionStart,
  isStoredSessionStart,
  type StoredSessionStart,
} from '../lib/sessionStopwatch'

/** Device-local key holding the active session's start. Deliberately NOT synced. */
const STORAGE_KEY = 'workout-session-start'

export interface UseSessionStopwatchReturn {
  /** True while a session is running (at least one set logged today). */
  isActive: ComputedRef<boolean>
  /** Elapsed milliseconds since the session's first set (0 when inactive). */
  elapsedMs: ComputedRef<number>
  /** Formatted clock string (`M:SS` / `H:MM:SS`), live-updating each second. */
  label: ComputedRef<string>
}

/**
 * @param setCount — reactive count of sets logged on the local "today". The
 *   stopwatch starts when this crosses 0 → >0 and resets when it returns to 0
 *   (e.g. day rollover, or every set deleted).
 */
export function useSessionStopwatch(setCount: Ref<number>): UseSessionStopwatchReturn {
  const startedAt = ref<number | null>(null)
  const now = ref(Date.now())
  let tickId: ReturnType<typeof setInterval> | null = null

  function persist(dayKey: string, ts: number): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ dayKey, startedAt: ts }))
    } catch {
      /* storage full / unavailable — the clock still runs in-memory this session */
    }
  }

  function clearPersisted(): void {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }

  /** Reconcile in-memory + persisted state with the current set count. */
  function sync(): void {
    const hasSets = setCount.value > 0
    if (!hasSets) {
      if (startedAt.value !== null) {
        startedAt.value = null
        clearPersisted()
      }
      return
    }
    // Already counting for the live session — leave it running.
    if (startedAt.value !== null) return

    const stored = loadJSON<StoredSessionStart | null>(STORAGE_KEY, null, isStoredSessionStart)
    const today = todayISO()
    const resolved = resolveSessionStart(stored, today, true, Date.now())
    if (resolved === null) return
    startedAt.value = resolved
    now.value = Date.now()
    persist(today, resolved)
  }

  function startTick(): void {
    if (tickId !== null) return
    tickId = setInterval(() => {
      now.value = Date.now()
    }, 1000)
  }

  function stopTick(): void {
    if (tickId !== null) {
      clearInterval(tickId)
      tickId = null
    }
  }

  function isDocHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden'
  }

  function onVisibilityChange(): void {
    if (isDocHidden()) {
      stopTick()
      return
    }
    // Resync (the session may have started/ended while backgrounded) and snap
    // the clock forward so it doesn't show a stale value on resume.
    now.value = Date.now()
    sync()
    if (startedAt.value !== null) startTick()
  }

  // Resolve immediately so the first paint already shows the clock (avoids a
  // one-frame flash of the plain set count on a mid-session reload).
  sync()

  watch(setCount, sync)
  watch(startedAt, (v) => {
    if (v !== null && !isDocHidden()) startTick()
    else stopTick()
  })

  onMounted(() => {
    now.value = Date.now()
    sync()
    if (startedAt.value !== null && !isDocHidden()) startTick()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
  })

  onUnmounted(() => {
    stopTick()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  })

  const isActive = computed(() => startedAt.value !== null)
  const elapsedMs = computed(() =>
    startedAt.value === null ? 0 : Math.max(0, now.value - startedAt.value),
  )
  const label = computed(() => formatSessionClock(elapsedMs.value))

  return { isActive, elapsedMs, label }
}
