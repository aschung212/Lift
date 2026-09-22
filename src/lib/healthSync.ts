/**
 * Apple Health bodyweight write-sync — the pure half (#1420).
 *
 * HealthKit has no web API, so this only ever runs inside the native Capacitor
 * shell; the PWA's path into Health remains the Weight-tab CSV export (#1159).
 * Everything here is clock- and platform-free so it can be tested without the
 * plugin: entry → sample mapping, the device-local write-once ledger, and the
 * plan of what still needs writing. `useHealthSync` owns the plugin calls.
 *
 * Two facts about the plugin shape the design:
 *
 *  - `@capgo/capacitor-health` can SAVE a `weight` sample but can neither delete
 *    nor update one, and HealthKit's own upsert semantics
 *    (`HKMetadataKeySyncIdentifier` + `SyncVersion`) are unreachable through its
 *    string-only metadata. So a weigh-in is written exactly ONCE — the ledger
 *    below — and a later edit or deletion in Logbook is deliberately NOT propagated:
 *    the only thing it could do is add a second sample beside the first. The
 *    Settings copy says so. Moving to HealthKit's sync-identifier upsert needs a
 *    custom Swift plugin and is tracked as a follow-up.
 *
 *  - Weight is written in kilograms — the only mass unit the plugin accepts —
 *    converted with the app-wide factor so Health shows the number Logbook shows.
 *
 * The ledger is bound to the user who switched sync on (`ownerId`): Health
 * belongs to the phone's owner, so a different account signing in on the same
 * device starts disabled with a fresh ledger rather than inheriting a switch
 * that would pour its weigh-ins into someone else's Health. Deliberately
 * device-local (like `overload-nudge-state` and `goal-celebration-state`), never
 * a synced preference — whether THIS device may write to THIS phone's Health is
 * not a property of the account.
 */

import type { BodyweightEntry } from '../stores/bodyweight'
import { isEndOfDayStamp, setDayKey, toLocalDateKey } from './dates'
import { loadJSON, isPlainObject } from './storage'
import { APP_BUNDLE_ID } from './appMeta'

/** Device-local localStorage key. Never synced (see module doc). */
export const HEALTH_SYNC_STATE_KEY = 'health-sync-state'

/** The app-wide lbs→kg factor (`useWeightUnit`, `bodyweightExport`, `plateCalculator`). */
export const KG_PER_LB = 0.453592

/**
 * Custom HealthKit metadata key stamped on every sample Logbook writes, carrying
 * the entry id. Reverse-DNS so it can never collide with an `HKMetadataKey*`.
 * Not read back today (the plugin drops metadata on read) — it documents
 * provenance in the store for a future plugin that can.
 */
export const HEALTH_ENTRY_ID_KEY = `${APP_BUNDLE_ID}.entryId`

/** Two samples closer than this (kg) are the same weigh-in for read-back matching. */
const MATCH_TOLERANCE_KG = 0.01

const DAY_MS = 86_400_000

export interface HealthSyncState {
  /** The user (or the `guest-local` sentinel) that switched sync on — the ledger is theirs. */
  ownerId: string | null
  enabled: boolean
  /** Entry ids already written to (or matched in) Health. Write-once. */
  written: Record<string, true>
  /** ISO instant of the last successful sync run, for the Settings status line. */
  lastSyncedAt: string | null
}

export function defaultHealthSyncState(): HealthSyncState {
  return { ownerId: null, enabled: false, written: {}, lastSyncedAt: null }
}

function isHealthSyncState(value: unknown): value is HealthSyncState {
  if (!isPlainObject(value)) return false
  const s = value as Record<string, unknown>
  return (
    (s.ownerId === null || typeof s.ownerId === 'string') &&
    typeof s.enabled === 'boolean' &&
    isPlainObject(s.written) &&
    (s.lastSyncedAt === null || typeof s.lastSyncedAt === 'string')
  )
}

/**
 * The ledger for `ownerId`. A missing, corrupt, or differently-owned payload
 * reads as the disabled default — corrupt storage must never throw into
 * composable init (LIFT-946), and another user's switch must not carry over.
 */
export function readHealthSyncState(ownerId: string | null): HealthSyncState {
  const stored = loadJSON<unknown>(HEALTH_SYNC_STATE_KEY, null)
  if (!isHealthSyncState(stored) || stored.ownerId !== ownerId) return defaultHealthSyncState()
  // Keep only genuine `true` marks — a tampered map holding other values would
  // otherwise be trusted as "already written".
  const written: Record<string, true> = {}
  for (const [id, mark] of Object.entries(stored.written as Record<string, unknown>)) {
    if (mark === true) written[id] = true
  }
  return { ownerId, enabled: stored.enabled, written, lastSyncedAt: stored.lastSyncedAt }
}

export function writeHealthSyncState(state: HealthSyncState): void {
  try {
    localStorage.setItem(HEALTH_SYNC_STATE_KEY, JSON.stringify(state))
  } catch {
    // Quota / private mode: the next run re-derives what is already in Health
    // through the read-back match, so a lost ledger costs a query, not a duplicate.
  }
}

/** Storage-lbs → kilograms, 3 dp (Health itself displays 1). */
export function lbsToKg(lbs: number): number {
  return Math.round(lbs * KG_PER_LB * 1000) / 1000
}

/**
 * The instant a weigh-in is filed under in Health.
 *
 * `entry.date` carries two conventions (#746). A UI-logged entry is an
 * `endOfDayISO` stamp whose UTC prefix IS the chosen local day and whose time
 * of day is meaningless — handing that stamp to HealthKit verbatim files a
 * Tokyo user's Sept 14 weigh-in under Sept 15 (`…T23:59Z` is 08:59 the next
 * morning there). It is mapped to LOCAL NOON of that day instead: the same
 * "noon suffix" `formatShortDate`'s doc prescribes for date-only keys, and an
 * hour that exists in every DST transition. A real-time stamp (`addEntry` with
 * no date, legacy rows) is a genuine instant and passes through unchanged.
 *
 * Invariant pinned by the tests: `toLocalDateKey(healthSampleInstant(d)) ===
 * setDayKey(d)` for both conventions on both sides of UTC.
 */
export function healthSampleInstant(entryDate: string): string {
  if (isEndOfDayStamp(entryDate)) {
    const [y, m, d] = entryDate.slice(0, 10).split('-').map(Number)
    return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString()
  }
  return new Date(entryDate).toISOString()
}

/** The plugin's `WriteSampleOptions`, narrowed to what a weigh-in needs. */
export interface WeightSample {
  dataType: 'weight'
  value: number
  unit: 'kilogram'
  startDate: string
  endDate: string
  metadata: Record<string, string>
}

export function buildWeightSample(entry: BodyweightEntry): WeightSample {
  const instant = healthSampleInstant(entry.date)
  return {
    dataType: 'weight',
    value: lbsToKg(entry.weight),
    unit: 'kilogram',
    startDate: instant,
    endDate: instant,
    metadata: { [HEALTH_ENTRY_ID_KEY]: entry.id },
  }
}

/**
 * Whether an entry may be written at all. Onboarding sample data (`sample:
 * true`) is never the user's weight and never reaches Supabase either; a
 * non-positive weight is a corrupt row, not a weigh-in.
 */
export function isHealthWritable(entry: BodyweightEntry): boolean {
  return !entry.sample && Number.isFinite(entry.weight) && entry.weight > 0
}

/** Writable entries not yet in the ledger, oldest first. */
export function pendingHealthEntries(entries: BodyweightEntry[], state: HealthSyncState): BodyweightEntry[] {
  return entries
    .filter(e => isHealthWritable(e) && !state.written[e.id])
    .sort((a, b) => healthSampleInstant(a.date).localeCompare(healthSampleInstant(b.date)))
}

/** The slice of the plugin's `HealthSample` the read-back match needs. */
export interface ExistingHealthSample {
  value: number
  startDate: string
  sourceId?: string
}

/**
 * Ids of `pending` entries Health ALREADY holds from Logbook — same local day and
 * the same kilograms within tolerance, from this app's own bundle id — so they
 * are marked written without a second sample. This is what keeps a reinstall
 * (fresh ledger) or a second iPhone on the same account from duplicating every
 * weigh-in; the ledger alone only protects one device across one install.
 * Samples from other sources (a smart scale) are not "already written by Logbook"
 * and are ignored, so the match never hides a genuine Logbook entry behind a
 * coincidentally-equal reading.
 */
export function matchExistingSamples(
  pending: BodyweightEntry[],
  samples: ExistingHealthSample[],
  bundleId: string = APP_BUNDLE_ID,
): string[] {
  const byDay = new Map<string, number[]>()
  for (const s of samples) {
    if (s.sourceId !== bundleId || !Number.isFinite(s.value)) continue
    const day = toLocalDateKey(s.startDate)
    const list = byDay.get(day)
    if (list) list.push(s.value)
    else byDay.set(day, [s.value])
  }
  if (byDay.size === 0) return []
  return pending
    .filter(e => {
      const kgs = byDay.get(setDayKey(e.date))
      if (!kgs) return false
      const kg = lbsToKg(e.weight)
      return kgs.some(k => Math.abs(k - kg) < MATCH_TOLERANCE_KG)
    })
    .map(e => e.id)
}

/**
 * The half-open query window covering every pending entry, padded a day on each
 * side so a read-back cannot miss a sample sitting on a day boundary. `null`
 * when there is nothing pending (no query needed).
 */
export function readBackWindow(pending: BodyweightEntry[]): { startDate: string; endDate: string } | null {
  if (pending.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const e of pending) {
    const t = new Date(healthSampleInstant(e.date)).getTime()
    if (t < min) min = t
    if (t > max) max = t
  }
  return { startDate: new Date(min - DAY_MS).toISOString(), endDate: new Date(max + DAY_MS).toISOString() }
}

/** A new state with `ids` marked written and the sync stamp advanced. Never mutates. */
export function markWritten(state: HealthSyncState, ids: string[], now: string): HealthSyncState {
  const written = { ...state.written }
  for (const id of ids) written[id] = true
  return { ...state, written, lastSyncedAt: now }
}
