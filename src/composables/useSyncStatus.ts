/**
 * The one description of "is my data getting to the server?" (LIFT-1323).
 *
 * The sync indicator used to be an icon-only `<span>` whose only explanation
 * lived in a `:title` tooltip — hover-only, on an app that ships to iOS and
 * bans hover-gated affordances. There was no tap target, no plain-language
 * account of what had gone wrong, and no way at all to ask the app to try
 * again: read recovery fired only on `online` / foreground-resume / a healed
 * session, so a foreground 500 or an RLS regression simply persisted until the
 * user happened to background the app.
 *
 * This composable is the single source the indicator AND the sheet behind it
 * read, so the button and the explanation can never disagree. It folds three
 * signals into one status — the write queue (`syncStatus`), the four stores'
 * read errors, and the count of writes that gave up (LIFT-1323's
 * `strandedWrites`) — and exposes the one action the user has: `syncNow()`.
 *
 * State lives in a DETACHED effect scope created on first use, not in the
 * calling component's scope: App.vue and the sheet both call this, and the
 * `lastSyncedAt` stamp has to survive the sheet unmounting. Pinia must be
 * active at that first call, which it is — App.vue's setup reaches it first.
 */
import { computed, effectScope, ref, watch, type ComputedRef, type Ref } from 'vue'
import { syncStatus } from '../lib/syncQueue'
import { syncQueueStats, formatSyncAge } from '../lib/syncActivity'
import { combineSyncStatus, type SyncErrorKind, type SyncStatus } from '../lib/syncStatus'
import { refetchAllStores } from './useSyncRecovery'
import { useWorkoutStore } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { usePreferencesStore } from '../stores/preferences'
import { useProgressionStore } from '../stores/progression'

/** Outcome of a user-initiated "Try again". */
export type ManualSyncResult = 'synced' | 'offline' | 'failed'

export interface UseSyncStatusReturn {
  /** The folded status the indicator renders. */
  status: ComputedRef<SyncStatus>
  /** Short status line — the indicator's accessible name and the live-region text. */
  label: ComputedRef<string>
  /** Plain-language headline for the sheet. */
  headline: ComputedRef<string>
  /** Plain-language explanation for the sheet, including what is NOT at risk. */
  detail: ComputedRef<string>
  /** Changes written locally that the server has not confirmed. */
  unsentChanges: ComputedRef<number>
  /** Of those, the ones nothing is currently retrying. */
  strandedChanges: ComputedRef<number>
  /** When every signal last agreed, or null if that has not happened yet. */
  lastSyncedAt: Readonly<Ref<number | null>>
  /** "3 minutes ago", or null when there is nothing to describe. */
  lastSyncedLabel: ComputedRef<string | null>
  /** True while `syncNow()` is in flight. */
  isRetrying: Readonly<Ref<boolean>>
  /** Outcome of the most recent `syncNow()`, cleared when the sheet reopens. */
  lastRetryResult: Readonly<Ref<ManualSyncResult | null>>
  /** Replay the journal, flush the queue, re-read every store. */
  syncNow: () => Promise<ManualSyncResult>
  /** Re-read the clock the age label is measured against (call when opening). */
  refreshAge: () => void
}

/**
 * `navigator.onLine === false` is decisive in one direction only — see the
 * matching note in syncQueue. `true` on a dead uplink is common, so a manual
 * retry always gets attempted when the browser claims connectivity; only an
 * explicit "no interface" answer short-circuits it.
 */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function create(): UseSyncStatusReturn {
  const workout = useWorkoutStore()
  const bodyweight = useBodyweightStore()
  const preferences = usePreferencesStore()
  const progression = useProgressionStore()

  // First non-null wins; only present/absent and the `auth` kind are used.
  const readError = computed<SyncErrorKind | null>(() =>
    workout.lastSyncError
    ?? bodyweight.lastSyncError
    ?? progression.lastSyncError
    ?? preferences.lastSyncError
    ?? null,
  )

  const strandedChanges = computed(() => syncQueueStats.value.stranded)
  // `pending` and `stranded` are disjoint by construction — `stranded` counts
  // only journal keys with no live attempt behind them — so this sums each
  // unsent change exactly once.
  const unsentChanges = computed(() => syncQueueStats.value.pending + syncQueueStats.value.stranded)

  const status = computed(() =>
    combineSyncStatus(syncStatus.value, readError.value, strandedChanges.value),
  )

  const label = computed(() => {
    if (status.value === 'syncing') return 'Syncing...'
    if (status.value === 'error') return 'Sync failed — changes saved locally'
    if (status.value === 'offline') return 'Offline — changes saved locally'
    return ''
  })

  const isAuthFailure = computed(() => status.value === 'error' && readError.value === 'auth')

  const headline = computed(() => {
    if (status.value === 'syncing') return 'Syncing'
    if (status.value === 'offline') return 'Offline'
    if (isAuthFailure.value) return 'Sign-in expired'
    if (status.value === 'error') return "Couldn't sync"
    return 'Everything is synced'
  })

  const detail = computed(() => {
    if (status.value === 'syncing') return 'Sending your latest changes to your account.'
    if (status.value === 'offline') {
      return 'Your workouts are saved on this device. They will sync automatically when you are back online.'
    }
    if (isAuthFailure.value) {
      return 'Your session expired, so Lift cannot reach your account. Sign in again to resume syncing — nothing on this device is lost.'
    }
    if (status.value === 'error') {
      return 'Your workouts are saved on this device and nothing has been lost. Lift keeps retrying in the background.'
    }
    return 'Your workouts are backed up to your account.'
  })

  // The last moment the write queue, all four store reads, and the journal
  // agreed. Stamped from the folded status rather than from each sync call
  // site, so it cannot drift away from what the indicator shows — and it
  // freezes the instant anything breaks, which is what makes "last synced 3
  // hours ago" answer the question the sheet exists for.
  const lastSyncedAt = ref<number | null>(null)
  watch(status, (s) => {
    if (s === 'synced') lastSyncedAt.value = Date.now()
  }, { immediate: true })

  // The clock the age is measured against. Refreshed when the sheet opens and
  // after a retry rather than ticking: a live timer on a rarely-open sheet is
  // a wake-up the battery does not owe us, and the value is coarse anyway.
  const measuredAt = ref(Date.now())
  const lastSyncedLabel = computed(() => {
    const at = lastSyncedAt.value
    if (at === null) return null
    return formatSyncAge(measuredAt.value - at)
  })

  const isRetrying = ref(false)
  const lastRetryResult = ref<ManualSyncResult | null>(null)

  function refreshAge(): void {
    measuredAt.value = Date.now()
  }

  async function syncNow(): Promise<ManualSyncResult> {
    if (isRetrying.value) return 'failed'
    isRetrying.value = true
    lastRetryResult.value = null
    try {
      if (isOffline()) return (lastRetryResult.value = 'offline')
      // Replays the journal (including keys the server refused — a manual tap
      // is not the ambient signal that bar exists for), flushes the queue, then
      // re-reads all four stores. Writes before reads: every store read is
      // remote-wins, so reading first would repaint the stale server value over
      // the edit that is still queued.
      await refetchAllStores('manual')
      const outcome: ManualSyncResult =
        status.value === 'synced' ? 'synced'
          : status.value === 'offline' ? 'offline'
            : 'failed'
      return (lastRetryResult.value = outcome)
    } finally {
      isRetrying.value = false
      refreshAge()
    }
  }

  return {
    status,
    label,
    headline,
    detail,
    unsentChanges,
    strandedChanges,
    lastSyncedAt,
    lastSyncedLabel,
    isRetrying,
    lastRetryResult,
    syncNow,
    refreshAge,
  }
}

let _scope: ReturnType<typeof effectScope> | null = null
let _api: UseSyncStatusReturn | null = null

export function useSyncStatus(): UseSyncStatusReturn {
  if (!_api) {
    _scope = effectScope(true)
    _api = _scope.run(create) as UseSyncStatusReturn
  }
  return _api
}

/**
 * Drop the singleton and its watcher. TESTS ONLY — App.vue destructures refs
 * off the instance at setup, so stopping the scope under a running app would
 * freeze the indicator until the next full reload. Sign-out needs no reset
 * here: `syncQueue.clear()` zeroes the counts and every store's `$reset` clears
 * `lastSyncError`, which is itself a transition back through 'synced' and
 * re-stamps `lastSyncedAt`.
 */
export function _resetSyncStatus(): void {
  _scope?.stop()
  _scope = null
  _api = null
}
