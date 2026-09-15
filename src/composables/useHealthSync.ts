/**
 * Apple Health bodyweight write-sync — the native half (#1420).
 *
 * Owns every plugin call and the reactive state Settings renders; the pure
 * mapping / ledger / planning lives in `src/lib/healthSync.ts`. Supported ONLY
 * inside the native iOS shell (`isHealthSyncSupported`): HealthKit has no web
 * API, and Android's Health Connect is out of scope. On every other platform
 * `enable()` answers `'unavailable'` and `setupHealthSync()` is a no-op, so the
 * web bundle never touches the plugin — it is dynamically imported behind the
 * gate, the same shape as `@capacitor/share` in `useAppShare`.
 *
 * Contract:
 *  - `enable()` requests WRITE-only authorization for `weight` (no read scope:
 *    HealthKit always lets an app query the samples it wrote itself, which is
 *    all the read-back match needs), persists the switch bound to the current
 *    user, then runs a backfill of every existing weigh-in.
 *  - `syncNow()` is single-flight with one trailing re-run: it re-checks
 *    authorization (a user can revoke access in the Health app at any time),
 *    reads back Lift's own samples over the pending window so a reinstall or a
 *    second device never duplicates, then writes the rest oldest-first, marking
 *    the ledger after EACH successful save — an interruption mid-backfill costs
 *    a retry, never a duplicate.
 *  - `setupHealthSync()` (App.vue, once) subscribes to the bodyweight store so a
 *    weigh-in reaches Health as it is logged, including entries arriving from
 *    another device via `_fetchFromSupabase`. Edits and deletions are NOT
 *    mirrored — see the lib doc for why the plugin cannot express them.
 *
 * One module-level instance, created inside a detached `effectScope`: the
 * first caller may be a component (SettingsSheet), and a watcher created in a
 * component's scope would be stopped when that sheet closes.
 */

import { ref, computed, watch, effectScope, type Ref, type ComputedRef } from 'vue'
import type { HealthPlugin, AuthorizationOptions } from '@capgo/capacitor-health'
import { isNative, platform } from '../lib/platform'
import { logError } from '../lib/logger'
import { useAuth } from './useAuth'
import { useAnalytics } from './useAnalytics'
import { useBodyweightStore } from '../stores/bodyweight'
import {
  readHealthSyncState,
  writeHealthSyncState,
  pendingHealthEntries,
  buildWeightSample,
  matchExistingSamples,
  readBackWindow,
  markWritten,
  type HealthSyncState,
} from '../lib/healthSync'

/** Native iOS only — HealthKit has no web API; Health Connect is out of scope. */
export const isHealthSyncSupported: boolean = isNative && platform === 'ios'

export type HealthSyncStatus = 'idle' | 'syncing' | 'denied' | 'unavailable' | 'error'
export type HealthSyncEnableResult = 'enabled' | 'denied' | 'unavailable' | 'error'

export interface HealthSyncResult {
  kind: 'skipped' | 'synced' | 'denied' | 'error'
  /** Samples written this run. */
  written: number
  /** Entries found already in Health and marked without a write. */
  matched: number
  /** Entries still waiting after this run. */
  pending: number
}

export interface HealthSyncApi {
  isSupported: boolean
  enabled: ComputedRef<boolean>
  status: Readonly<Ref<HealthSyncStatus>>
  busy: ComputedRef<boolean>
  pendingCount: ComputedRef<number>
  lastSyncedAt: ComputedRef<string | null>
  lastError: Readonly<Ref<Error | null>>
  enable: () => Promise<HealthSyncEnableResult>
  disable: () => void
  syncNow: () => Promise<HealthSyncResult>
  /** Debounced `syncNow` for store-driven triggers. */
  scheduleSync: () => void
  cancelScheduled: () => void
}

/** Write-only: the read-back match needs no read scope (see module doc). */
const WEIGHT_AUTH: AuthorizationOptions = { read: [], write: ['weight'] }

/**
 * Explicit, generous cap on the read-back query. The plugin defaults to 100,
 * which a backfill of daily weigh-ins passes in four months; without read
 * authorization the query only ever returns Lift's own samples, so even a
 * multi-year history sits far under this.
 */
const READ_BACK_LIMIT = 10_000

/** Coalesces the burst a fetch/merge produces into one run. */
const SYNC_DEBOUNCE_MS = 500

/** Store actions after which new writable entries may exist. */
const SYNC_TRIGGER_ACTIONS: ReadonlySet<string> = new Set([
  'addEntry',
  // `updateEntry` strips the onboarding `sample` flag — that turns a demo row
  // into a real weigh-in, which is then pending.
  'updateEntry',
  'restoreEntry',
  '_fetchFromSupabase',
])

let pluginPromise: Promise<HealthPlugin> | null = null
function loadPlugin(): Promise<HealthPlugin> {
  if (!pluginPromise) pluginPromise = import('@capgo/capacitor-health').then(m => m.Health)
  return pluginPromise
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

function createInstance(): HealthSyncApi {
  const { user } = useAuth()
  const { logEvent } = useAnalytics()
  const store = useBodyweightStore()

  const ownerId = computed<string | null>(() => user.value?.id ?? null)
  const state = ref<HealthSyncState>(readHealthSyncState(ownerId.value))
  const status = ref<HealthSyncStatus>('idle')
  const lastError = ref<Error | null>(null)

  // A different user on this device gets their own (disabled) ledger; the
  // previous owner's comes back intact when they sign in again.
  watch(ownerId, id => {
    state.value = readHealthSyncState(id)
    status.value = 'idle'
    lastError.value = null
  })

  const enabled = computed(() => state.value.enabled)
  const busy = computed(() => status.value === 'syncing')
  const pendingCount = computed(() => pendingHealthEntries(store.entries, state.value).length)
  const lastSyncedAt = computed(() => state.value.lastSyncedAt)

  function persist(next: HealthSyncState): void {
    state.value = next
    writeHealthSyncState(next)
  }

  function fail(err: unknown, source: string, extra: Record<string, number> = {}): void {
    logError(err, { source, ...extra })
    lastError.value = toError(err)
    status.value = 'error'
    logEvent('health_sync', { outcome: 'error', source })
  }

  async function runSync(): Promise<HealthSyncResult> {
    const remaining = () => pendingHealthEntries(store.entries, state.value).length
    if (!isHealthSyncSupported || !state.value.enabled) {
      return { kind: 'skipped', written: 0, matched: 0, pending: remaining() }
    }
    status.value = 'syncing'
    let written = 0
    let matched = 0
    try {
      const health = await loadPlugin()
      const auth = await health.checkAuthorization(WEIGHT_AUTH)
      if (!auth.writeAuthorized.includes('weight')) {
        status.value = 'denied'
        return { kind: 'denied', written, matched, pending: remaining() }
      }

      let pending = pendingHealthEntries(store.entries, state.value)
      const window = readBackWindow(pending)
      if (window) {
        const { samples } = await health.readSamples({
          dataType: 'weight',
          ...window,
          limit: READ_BACK_LIMIT,
          ascending: true,
        })
        const matchedIds = matchExistingSamples(pending, samples)
        if (matchedIds.length > 0) {
          persist(markWritten(state.value, matchedIds, new Date().toISOString()))
          matched = matchedIds.length
          const done = new Set(matchedIds)
          pending = pending.filter(e => !done.has(e.id))
        }
      }

      for (const entry of pending) {
        // `disable()` mid-backfill stops here rather than finishing behind the user's back.
        if (!state.value.enabled) break
        await health.saveSample(buildWeightSample(entry))
        persist(markWritten(state.value, [entry.id], new Date().toISOString()))
        written++
      }

      if (state.value.enabled) persist({ ...state.value, lastSyncedAt: new Date().toISOString() })
      status.value = 'idle'
      lastError.value = null
      if (written > 0 || matched > 0) logEvent('health_sync', { outcome: 'synced', written, matched })
      return { kind: 'synced', written, matched, pending: remaining() }
    } catch (err) {
      fail(err, 'useHealthSync.syncNow', { written, matched })
      return { kind: 'error', written, matched, pending: remaining() }
    }
  }

  let inFlight: Promise<HealthSyncResult> | null = null
  let rerun = false
  function syncNow(): Promise<HealthSyncResult> {
    if (inFlight) {
      // Coalesce: an entry logged during a backfill is picked up by ONE trailing run.
      rerun = true
      return inFlight
    }
    inFlight = runSync().finally(() => {
      inFlight = null
      if (rerun) {
        rerun = false
        void syncNow()
      }
    })
    return inFlight
  }

  let debounceId: ReturnType<typeof setTimeout> | null = null
  function cancelScheduled(): void {
    if (debounceId !== null) {
      clearTimeout(debounceId)
      debounceId = null
    }
  }
  function scheduleSync(): void {
    if (!isHealthSyncSupported || !state.value.enabled) return
    cancelScheduled()
    debounceId = setTimeout(() => {
      debounceId = null
      void syncNow()
    }, SYNC_DEBOUNCE_MS)
  }

  async function enable(): Promise<HealthSyncEnableResult> {
    if (!isHealthSyncSupported) return 'unavailable'
    try {
      const health = await loadPlugin()
      const { available } = await health.isAvailable()
      if (!available) {
        status.value = 'unavailable'
        logEvent('health_sync', { outcome: 'unavailable' })
        return 'unavailable'
      }
      const auth = await health.requestAuthorization(WEIGHT_AUTH)
      if (!auth.writeAuthorized.includes('weight')) {
        // "Don't Allow" — the switch stays off and the status row says where to
        // turn it on; tapping again re-asks HealthKit for the current status.
        status.value = 'denied'
        logEvent('health_sync', { outcome: 'denied' })
        return 'denied'
      }
      persist({ ...state.value, ownerId: ownerId.value, enabled: true })
      status.value = 'idle'
      lastError.value = null
      logEvent('health_sync', { outcome: 'enabled' })
      // The switch has already flipped (state is persisted above, before the
      // backfill); awaiting the backfill here just means the promise settles
      // once the history is in Health. Its outcome is reported through
      // `status`/`lastError`, not this result — authorization is what
      // `enable` answers for.
      await syncNow()
      return 'enabled'
    } catch (err) {
      fail(err, 'useHealthSync.enable')
      return 'error'
    }
  }

  function disable(): void {
    cancelScheduled()
    // The ledger is kept: re-enabling must not rewrite what Health already holds.
    persist({ ...state.value, enabled: false })
    status.value = 'idle'
    lastError.value = null
    logEvent('health_sync', { outcome: 'disabled' })
  }

  return {
    isSupported: isHealthSyncSupported,
    enabled,
    status,
    busy,
    pendingCount,
    lastSyncedAt,
    lastError,
    enable,
    disable,
    syncNow,
    scheduleSync,
    cancelScheduled,
  }
}

let instance: HealthSyncApi | null = null

export function useHealthSync(): HealthSyncApi {
  if (!instance) {
    const scope = effectScope(true)
    instance = scope.run(createInstance)!
  }
  return instance
}

/**
 * Subscribe the sync to the bodyweight store and run once for anything left
 * pending from a previous session. Call once from App.vue's `onMounted`; the
 * returned teardown unsubscribes. A no-op off the native iOS shell — nothing is
 * instantiated there, so the web bundle never constructs the singleton.
 */
export function setupHealthSync(): () => void {
  if (!isHealthSyncSupported) return () => {}
  const api = useHealthSync()
  const store = useBodyweightStore()
  const unsubscribe = store.$onAction(({ name, after }) => {
    if (SYNC_TRIGGER_ACTIONS.has(name)) after(() => api.scheduleSync())
  })
  api.scheduleSync()
  return () => {
    unsubscribe()
    api.cancelScheduled()
  }
}
