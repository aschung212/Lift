import { ref } from 'vue'
import { supabase, isPreviewMode } from './supabase'
import type { Database } from './database.types'
import { logError, logWarn } from './logger'
import { broadcastSyncStatus } from './crossTabSync'
import { backupToIDB, restoreFromIDB } from './durableStorage'
import { isAuthError, ensureFreshSession } from './sessionHealth'

type SyncOperation = () => PromiseLike<unknown>

/** The public schema's writable tables, keyed by name (LIFT-948). */
type PublicTables = Database['public']['Tables']

/**
 * Table names a journaled descriptor may target — bound to the generated
 * Supabase schema (LIFT-948). Modeling this as `keyof PublicTables` instead of
 * a bare `string` means a descriptor built with a misspelled or stale table name
 * fails typechecking at the producer instead of at runtime against the server.
 */
export type SyncTable = keyof PublicTables

/**
 * Serializable description of a single-table Supabase mutation, with its `row`
 * / `values` / `match` typed against that table's generated Insert / Update /
 * Row shapes (LIFT-948). Generic over the specific table `T` so the table
 * literal is linked to the column names allowed in the payload — a descriptor
 * carrying a column that doesn't exist on `T` no longer compiles.
 */
export type SyncDescriptorFor<T extends SyncTable> =
  | { op: 'upsert'; table: T; row: PublicTables[T]['Insert'] }
  | {
      op: 'update'
      table: T
      values: PublicTables[T]['Update']
      match: Partial<PublicTables[T]['Row']>
    }

/**
 * Serializable description of a Supabase mutation (LIFT-706, hardened in
 * LIFT-948).
 *
 * The in-memory queue holds closures, which cannot survive a tab close or
 * app restart. To harden offline writes — where every logged set is hard-won
 * data — a closure may be accompanied by a `SyncDescriptor`: a plain,
 * JSON-serializable record of the same mutation. Descriptors are journaled to
 * IndexedDB so that pending writes can be rehydrated and replayed after the
 * app reopens, even if the original closure (and its captured scope) is gone.
 *
 * Only idempotent shapes are modeled (upsert / update), matching the
 * idempotency invariant enforced in architecturalInvariants.test.ts — replay
 * is safe because re-running an upsert or a targeted update is a no-op once the
 * server already holds the value.
 *
 * The union is distributed over every known table so the discriminating `table`
 * literal is tied to the payload columns for that specific table, rather than
 * modeling rows as an untyped `Record<string, unknown>`.
 */
export type SyncDescriptor = { [T in SyncTable]: SyncDescriptorFor<T> }[SyncTable]

interface JournalEntry {
  descriptor: SyncDescriptor
  isDelete: boolean
}

/** One journaled entry as persisted on disk. */
interface PersistedEntry extends JournalEntry {
  key: string
}

/**
 * On-disk shape of the durable journal (LIFT-1132). The entry list is wrapped in
 * a versioned envelope so a journal written under an older schema generation can
 * be detected and discarded on rehydrate rather than replayed with stale column
 * names. Pre-LIFT-1132 journals were persisted as a bare `PersistedEntry[]`;
 * `rehydrate()` still reads that legacy shape (see below).
 */
interface PersistedJournal {
  version: number
  entries: PersistedEntry[]
}

/** IndexedDB key (in the shared durable-storage keyval store) for the queue journal. */
const JOURNAL_KEY = 'lift-sync-journal'

/**
 * Schema generation of journaled descriptors (LIFT-1132).
 *
 * Journaled writes are replayed after an app auto-update — potentially across a
 * schema migration that renamed or removed a column. The per-column allowlist
 * (LIFT-785) already drops a descriptor carrying a column the app no longer
 * knows, but that is a field-level check; this version tag is a coarser,
 * whole-journal guard. `rehydrate()` discards any journal whose stamped version
 * doesn't match, rather than replaying descriptors built against a schema this
 * build no longer speaks — which would otherwise surface as silent PostgREST
 * failures that TypeScript can't catch on a runtime-rebuilt query.
 *
 * BUMP THIS only for a BREAKING descriptor change — a column rename, a table
 * drop, or a changed key/match shape — where replaying an old descriptor is
 * unsafe. Do NOT bump for a purely additive column: an old descriptor that
 * simply omits a new column still upserts cleanly, and bumping would needlessly
 * drop legitimate pending offline writes.
 */
export const JOURNAL_SCHEMA_VERSION = 1

/**
 * Allowlist of tables (and their writable columns) that a journaled descriptor
 * is permitted to target on replay (LIFT-785).
 *
 * The journal lives in IndexedDB, which is user-writable. `rehydrate()` replays
 * whatever was persisted, and `executeDescriptor` casts the typed client to a
 * loose surface to target a dynamic table name — so without validation a
 * tampered (or corrupted) journal entry could issue an upsert/update against an
 * arbitrary table or column, with RLS as the only backstop. This allowlist is a
 * client-side defense-in-depth layer: only the tables the app actually journals
 * and only their real columns are replayable; anything else is dropped before a
 * query is ever built.
 *
 * Keep this in sync with the descriptor producers — `src/stores/workout.ts`
 * (`_buildExerciseUpsert`, `_enqueueSetUpsert`, `_enqueueSoftDelete`,
 * `_enqueueRestore`), `src/stores/bodyweight.ts` (`_enqueueEntryUpsert`,
 * `_enqueueEntrySoftDelete`, `_enqueueEntryRestore`), `preferences._persist`
 * and `progression._syncToSupabase` (LIFT-1239).
 */
const REPLAYABLE_COLUMNS: Record<string, ReadonlySet<string>> = {
  exercises: new Set([
    'id', 'user_id', 'name', 'tags', 'archived_at',
    'input_mode', 'bar_weight', 'intensity_max_reps', 'deleted_at',
    // Retired in #770 but the DB column still exists (left dormant, never
    // dropped). Tolerated so an offline write journaled by a pre-#770 client
    // still replays after an upgrade instead of being silently dropped.
    'warmup_scheme',
  ]),
  sets: new Set([
    'id', 'user_id', 'exercise_id', 'date', 'weight', 'reps',
    'estimated_1rm', 'deleted_at',
    // Real log-time timestamp sent by _enqueueSetUpsert (#846) so an offline set
    // logged at 6pm keeps its training time when replayed after a reload rather
    // than inheriting the later sync time. Must be allowlisted or the journaled
    // descriptor is dropped on rehydrate() — defeating the durable queue for the
    // exact offline-then-sync case it exists for.
    'created_at',
  ]),
  // LIFT-1239: the three tables below journal too, so a bodyweight entry / XP
  // total / settings change made offline survives a close before the flush.
  bodyweight_entries: new Set([
    'id', 'user_id', 'date', 'weight', 'deleted_at',
  ]),
  user_preferences: new Set(['user_id', 'preferences', 'updated_at']),
  user_progression: new Set([
    'user_id', 'total_xp', 'streak_weeks', 'weekly_target',
    'pending_target_change', 'show_progression', 'progression_enabled',
    'unlocked_themes', 'starter_theme', 'starter_confirmed', 'epoch',
    'streak_history', 'xp_per_set', 'bodyweight_xp_dates', 'updated_at',
  ]),
}

/**
 * Upsert conflict targets for tables whose upsert key is NOT the primary key
 * (LIFT-1239).
 *
 * `user_preferences` has a surrogate `id uuid primary key` plus a separate
 * `unique(user_id)` constraint, and the app upserts a row with no `id`. Without
 * an explicit conflict target Postgres resolves against the PK, generates a new
 * `id`, and then violates `unique(user_id)` — so a replayed preferences write
 * would fail forever. Every other journaled table upserts on its primary key,
 * where PostgREST's default conflict target is already correct.
 *
 * Deliberately a client-side constant rather than a field on the descriptor:
 * the journal is user-writable IndexedDB, and a conflict target supplied by a
 * tampered entry would let a replay resolve against an attacker-chosen column.
 * MUST match the `onConflict` option used at the call site in
 * `src/stores/preferences.ts` (asserted structurally in syncQueueJournal.test.ts).
 */
const UPSERT_CONFLICT_TARGET: Record<string, string> = {
  user_preferences: 'user_id',
}

/** True when `obj` is a non-empty plain map whose keys are all in `allowed`. */
function isAllowedColumnMap(obj: unknown, allowed: ReadonlySet<string>): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const keys = Object.keys(obj)
  // Empty maps are rejected: an empty upsert row is meaningless, and an empty
  // update `match` would target EVERY row in the table — exactly the kind of
  // unbounded write this allowlist exists to prevent.
  if (keys.length === 0) return false
  return keys.every(col => allowed.has(col))
}

/**
 * Validate that a descriptor is safe to replay (LIFT-785): a known op, an
 * allowlisted table, and only writable columns of that table in its row /
 * values / match. Used both as the gate in `rehydrate()` (drop + warn) and as
 * the final guard inside `executeDescriptor` (no-op) so a bad descriptor can
 * never reach Supabase regardless of how it was enqueued.
 */
export function isReplayableDescriptor(descriptor: unknown): descriptor is SyncDescriptor {
  if (!descriptor || typeof descriptor !== 'object') return false
  const d = descriptor as Record<string, unknown>
  if (typeof d.table !== 'string') return false
  const allowed = REPLAYABLE_COLUMNS[d.table]
  if (!allowed) return false
  if (d.op === 'upsert') return isAllowedColumnMap(d.row, allowed)
  if (d.op === 'update') {
    return isAllowedColumnMap(d.values, allowed) && isAllowedColumnMap(d.match, allowed)
  }
  return false
}

/**
 * The one place the dynamically-dispatched table name defeats the strongly-typed
 * client surface (LIFT-948). A descriptor's `table` is only known at runtime, so
 * `supabase.from(table)` can't be resolved to a single table's builder type —
 * this helper isolates that single `any` cast rather than letting it leak across
 * `executeDescriptor`. Callers reach it only after `isReplayableDescriptor` has
 * bounded `table` to the known allowlist.
 */
function fromTable(table: SyncTable) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from(table)
}

/**
 * Rebuild a runnable Supabase operation from its serializable descriptor.
 * Used to replay journaled writes after a reload. Returns a no-op promise when
 * Supabase is unavailable so replay degrades gracefully offline, or when the
 * descriptor falls outside the replay allowlist (LIFT-785).
 */
export function executeDescriptor(descriptor: SyncDescriptor): PromiseLike<unknown> {
  if (!supabase) return Promise.resolve()
  if (!isReplayableDescriptor(descriptor)) {
    logWarn('Refusing to execute sync descriptor outside the replay allowlist', {
      op: (descriptor as { op?: unknown } | null)?.op,
      table: (descriptor as { table?: unknown } | null)?.table,
    })
    return Promise.resolve()
  }
  if (descriptor.op === 'upsert') {
    const onConflict = UPSERT_CONFLICT_TARGET[descriptor.table]
    return onConflict
      ? fromTable(descriptor.table).upsert(descriptor.row, { onConflict })
      : fromTable(descriptor.table).upsert(descriptor.row)
  }
  let query = fromTable(descriptor.table).update(descriptor.values)
  for (const [col, val] of Object.entries(descriptor.match)) {
    query = query.eq(col, val)
  }
  return query
}

/** Reactive sync status for UI indicators. */
export const syncStatus = ref<'synced' | 'syncing' | 'error' | 'offline'>('synced')

// Rate limiting: max operations per window
const RATE_LIMIT_MAX = 200
const RATE_LIMIT_WINDOW = 60_000 // 1 minute
let _rateCount = 0
let _rateResetTimer: ReturnType<typeof setTimeout> | null = null
// Deferred operations that exceeded the rate limit — processed in the next window
const _deferredOps = new Map<string, SyncOperation>()

// Circuit breaker: defense-in-depth against runaway delete storms.
//
// Motivation: the SEV1 on 2026-04-12 destroyed ~40-60% of one user's
// workout data because a client dedup heuristic broadcast DELETEs from
// _fetchFromSupabase every sync cycle. PR #338 removed that specific
// code path; PR #354 added behavioral regression coverage. This breaker
// is the third layer: even if a future bug reintroduces runaway deletes,
// the breaker trips after N deletes in a short window, blocks further
// deletes for a cool-down period, and raises a Sentry error so we find
// out before data is lost.
//
// Thresholds are deliberately loose — a user deleting one set at a time
// or one whole exercise (2 ops) never gets near 20/10s. Only bug-shaped
// delete patterns trip the breaker.
const CIRCUIT_BREAKER_ENABLED = true
const CIRCUIT_BREAKER_WINDOW_MS = 10_000
const CIRCUIT_BREAKER_THRESHOLD = 20
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000
let _deleteTimestamps: number[] = []
let _circuitOpenUntil = 0
let _circuitTripCount = 0

/**
 * Batches and debounces Supabase sync operations with retry.
 *
 * Enqueued operations are held for `flushDelay` ms. If more operations
 * arrive within that window the timer resets, coalescing rapid mutations
 * into a single flush. Operations sharing the same `key` are deduplicated
 * — only the latest version runs.
 *
 * Failed operations are retried with exponential backoff up to `maxRetries`.
 */
export class SyncQueue {
  private _queue = new Map<string, SyncOperation>()
  private _timer: ReturnType<typeof setTimeout> | null = null
  private _retryTimer: ReturnType<typeof setTimeout> | null = null
  private _flushDelay: number
  private _flushing = false
  private _retryQueue = new Map<string, { op: SyncOperation; attempt: number }>()
  private _maxRetries = 5
  private _attemptMap = new Map<string, number>()
  // Durable mirror of pending operations keyed identically to _queue. Only
  // operations enqueued WITH a descriptor are journaled; descriptor-less
  // callers (e.g. fire-and-forget telemetry) keep the legacy in-memory-only
  // behavior. The journal becomes "active" the first time a descriptor is
  // seen, so descriptor-less queues never touch IndexedDB.
  private _journal = new Map<string, JournalEntry>()
  private _journalActive = false

  constructor(flushDelay = 1000) {
    this._flushDelay = flushDelay
  }

  /** Persist the journal to IndexedDB (fire-and-forget). No-op until active. */
  private _persistJournal(): void {
    if (!this._journalActive) return
    try {
      const payload: PersistedJournal = {
        version: JOURNAL_SCHEMA_VERSION,
        entries: [...this._journal.entries()].map(([key, entry]) => ({ key, ...entry })),
      }
      backupToIDB(JOURNAL_KEY, JSON.stringify(payload))
    } catch {
      // Serialization/IDB failure must never break the in-memory queue.
    }
  }

  /** Record (or replace) a journal entry and persist. */
  private _journalSet(key: string, descriptor: SyncDescriptor, isDelete: boolean): void {
    this._journalActive = true
    this._journal.set(key, { descriptor, isDelete })
    this._persistJournal()
  }

  /**
   * Delete a key's journal entry only if it is still the exact entry captured
   * at flush time (LIFT-1213). _journalSet stores a fresh object per write, so
   * identity inequality means a newer same-key write replaced the entry while
   * the flush was in flight — that newer durable record must survive.
   */
  private _journalDeleteIfCurrent(key: string, snapshot: JournalEntry | undefined): boolean {
    if (this._journal.get(key) !== snapshot) return false
    return this._journal.delete(key)
  }

  /**
   * Extract a failure reason from a settled op result, or null on success.
   *
   * A rejection is always a failure. A *fulfilled* Supabase op resolves
   * `{ data, error }` even on a 401 — so an expired-token write looks like a
   * success and was silently dropped (LIFT-784). We surface a resolved AUTH
   * error as a retryable failure so the write recovers after a refresh, while
   * leaving non-auth resolved errors on the legacy fulfilled-is-success path to
   * avoid changing unrelated sync behavior.
   */
  private _resultError(result: PromiseSettledResult<unknown>): unknown {
    if (result.status === 'rejected') return result.reason
    const val = result.value as { error?: unknown } | null | undefined
    if (val && typeof val === 'object' && 'error' in val && val.error && isAuthError(val.error)) {
      return val.error
    }
    return null
  }

  /**
   * Add an operation to the queue. If `key` matches an existing entry,
   * the previous operation is replaced (last-write-wins).
   *
   * Pass a `descriptor` to make the write durable across reloads: it is
   * journaled to IndexedDB immediately and removed once the op flushes
   * successfully. If the op instead exhausts its in-session retries the
   * journal entry is RETAINED (LIFT-1229) so it replays on the next launch
   * via `rehydrate()` rather than being lost. Omit the descriptor for
   * in-memory-only writes (the legacy behavior).
   */
  enqueue(key: string, op: SyncOperation, descriptor?: SyncDescriptor): void {
    if (!supabase || isPreviewMode.value) return
    // Journal first — before rate-limit deferral — so the durable record
    // exists the instant the user acts, even if execution is deferred.
    if (descriptor) this._journalSet(key, descriptor, false)
    // Rate limiting
    _rateCount++
    if (!_rateResetTimer) {
      _rateResetTimer = setTimeout(() => {
        _rateCount = 0
        _rateResetTimer = null
        // Re-enqueue deferred operations through the rate-limited path.
        // Take a snapshot and clear first to avoid infinite deferral loops.
        if (_deferredOps.size > 0) {
          const batch = new Map(_deferredOps)
          _deferredOps.clear()
          for (const [k, v] of batch) {
            this.enqueue(k, v)
          }
        }
      }, RATE_LIMIT_WINDOW)
    }
    if (_rateCount > RATE_LIMIT_MAX) {
      logWarn('Sync rate limit exceeded, deferring operation', { key })
      _deferredOps.set(key, op)
      return
    }
    this._queue.set(key, op)
    this._retryQueue.delete(key)
    this._scheduleFlush()
  }

  /**
   * Enqueue a server-side DELETE operation. Identical to `enqueue` except
   * the call is counted against the delete circuit breaker — if more than
   * CIRCUIT_BREAKER_THRESHOLD deletes are enqueued within
   * CIRCUIT_BREAKER_WINDOW_MS, the breaker opens: subsequent deletes are
   * blocked for CIRCUIT_BREAKER_COOLDOWN_MS and a Sentry error is raised.
   *
   * All delete call sites in the app should go through this method, NOT
   * plain `enqueue`, so they are visible to the breaker. See the
   * structural test in syncQueue.test.ts that enforces this.
   */
  enqueueDelete(key: string, op: SyncOperation, descriptor?: SyncDescriptor): void {
    if (!supabase || isPreviewMode.value) return

    // Re-enqueuing a delete for a key that's already pending is the SAME logical
    // delete being refreshed (e.g. rehydrate() replays a journaled delete and
    // then _fetchFromSupabase's tombstone pass re-enqueues it before the queue
    // flushes). Those must NOT each push a fresh timestamp into the breaker, or
    // a handful of pending offline deletes would falsely trip the SEV1 guard.
    // The breaker only needs to see genuinely NEW (distinct-key) deletes — a
    // real delete storm still has distinct keys and still trips.
    const alreadyPending = this._queue.has(key) || this._retryQueue.has(key)

    if (CIRCUIT_BREAKER_ENABLED && !alreadyPending) {
      const now = Date.now()

      // Circuit is currently open (in cool-down): block the delete.
      if (now < _circuitOpenUntil) {
        logWarn('Sync delete circuit breaker open — blocking delete', {
          key,
          ms_until_reset: _circuitOpenUntil - now,
          trip_count: _circuitTripCount,
        })
        syncStatus.value = 'error'
        broadcastSyncStatus('error')
        return
      }

      // Prune timestamps outside the rolling window before counting.
      _deleteTimestamps = _deleteTimestamps.filter(
        t => now - t < CIRCUIT_BREAKER_WINDOW_MS,
      )

      // Trip the breaker if we're about to cross the threshold.
      if (_deleteTimestamps.length >= CIRCUIT_BREAKER_THRESHOLD) {
        _circuitOpenUntil = now + CIRCUIT_BREAKER_COOLDOWN_MS
        _circuitTripCount++
        logError(
          new Error(
            `Sync delete circuit breaker tripped: ${_deleteTimestamps.length} deletes in ${CIRCUIT_BREAKER_WINDOW_MS}ms (threshold ${CIRCUIT_BREAKER_THRESHOLD})`,
          ),
          {
            source: 'SyncQueue.enqueueDelete',
            count: _deleteTimestamps.length,
            window_ms: CIRCUIT_BREAKER_WINDOW_MS,
            threshold: CIRCUIT_BREAKER_THRESHOLD,
            cooldown_ms: CIRCUIT_BREAKER_COOLDOWN_MS,
            blocked_key: key,
            trip_count: _circuitTripCount,
          },
        )
        syncStatus.value = 'error'
        broadcastSyncStatus('error')
        return
      }

      _deleteTimestamps.push(now)
    }

    // Journal the delete (isDelete:true) only after the breaker has cleared it,
    // so a blocked delete is never replayed. enqueue() is then called WITHOUT a
    // descriptor so it won't overwrite this entry as a non-delete.
    if (descriptor) this._journalSet(key, descriptor, true)
    this.enqueue(key, op)
  }

  /** Immediately flush all pending operations. */
  async flush(): Promise<void> {
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
    if (this._flushing || this._queue.size === 0) return

    this._flushing = true
    syncStatus.value = 'syncing'
    broadcastSyncStatus('syncing')
    const entries = [...this._queue.entries()]
    // Identity snapshot of each key's journal entry at flush time (LIFT-1213).
    // A same-key enqueue that lands while the flush below is awaited REPLACES
    // the journal object (_journalSet always stores a fresh object). Guarding
    // the completion-time deletes on identity stops the OLD write's completion
    // from deleting the NEWER write's durable record — which would silently
    // lose the correction if the app reloaded before the next flush.
    const journalSnapshots = entries.map(([key]) => this._journal.get(key))
    this._queue.clear()

    try {
      const results = await Promise.allSettled(
        entries.map(([, op]) => op()),
      )
      let hasFailure = false
      let sawAuthError = false
      let journalChanged = false
      results.forEach((result, i) => {
        const key = entries[i][0]
        const error = this._resultError(result)
        if (!error) {
          // Clear retry counter on success so future failures get full retries
          this._attemptMap.delete(key)
          // Write durably landed on the server — drop its journal entry,
          // unless a newer same-key write superseded it mid-flight (LIFT-1213).
          if (this._journalDeleteIfCurrent(key, journalSnapshots[i])) journalChanged = true
          return
        }
        hasFailure = true
        if (isAuthError(error)) sawAuthError = true
        const op = entries[i][1]
        const prevAttempt = this._attemptMap.get(key) ?? 0
        const attempt = prevAttempt + 1
        if (attempt <= this._maxRetries) {
          this._retryQueue.set(key, { op, attempt })
          this._attemptMap.set(key, attempt)
          logWarn(`Sync failed, will retry (attempt ${attempt}/${this._maxRetries})`, { key })
        } else {
          // Retries exhausted for this session. The in-memory op is dropped,
          // but the DURABLE journal entry is deliberately RETAINED (LIFT-1229)
          // so the write replays on the next launch via rehydrate() instead of
          // being lost. Previously the entry was deleted here, leaving
          // reconciliation in the store's _fetchFromSupabase as the only
          // recovery — but that path only re-pushes missing *sets*, so an
          // exhausted exercise-metadata write (rename / tags / gyms / archive /
          // bar + intensity settings) was stranded silently until the user
          // happened to touch that exercise again. Keeping the journal entry
          // recovers every journaled table uniformly. Replay is idempotent
          // (upsert/update only), so a write the server already holds is a
          // harmless no-op next launch.
          //
          // A distinct `event: 'retry_exhausted'` marker (vs a bare logError)
          // makes exhaustion frequency measurable pre-GA, separate from generic
          // sync errors. `journalRetained` is false only for descriptor-less
          // (in-memory-only) writes, which have no durable record to keep.
          logError(error, {
            source: 'SyncQueue',
            event: 'retry_exhausted',
            key,
            attempts: attempt,
            journalRetained: this._journal.has(key),
          })
        }
      })
      // An expired/stale token surfaces identically across every queued write.
      // Refresh the session ONCE (single-flight) so the scheduled retry runs
      // with a fresh token instead of burning all five retries on a dead one
      // (LIFT-784). If the refresh fails, sessionHealth flips authNeedsReauth
      // and the UI prompts a re-sign-in.
      if (sawAuthError) void ensureFreshSession()
      if (journalChanged) this._persistJournal()
      if (this._retryQueue.size > 0) this._scheduleRetry()
      const newStatus = hasFailure ? 'error' : 'synced' as const
      syncStatus.value = newStatus
      broadcastSyncStatus(newStatus)
    } finally {
      this._flushing = false
      if (this._queue.size > 0) this._scheduleFlush()
    }
  }

  /** Number of pending (unflushed) operations. */
  get pending(): number {
    return this._queue.size + this._retryQueue.size + _deferredOps.size
  }

  /** Cancel all pending operations without executing them. */
  clear(): void {
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
    if (this._retryTimer) {
      clearTimeout(this._retryTimer)
      this._retryTimer = null
    }
    this._queue.clear()
    this._retryQueue.clear()
    this._attemptMap.clear()
    _deferredOps.clear()
    const hadJournal = this._journal.size > 0
    this._journal.clear()
    if (hadJournal) this._persistJournal()
  }

  /**
   * Replay journaled operations after an app reload (LIFT-706).
   *
   * Reads the durable journal from IndexedDB and re-enqueues each entry by
   * rebuilding its op from the serializable descriptor. Deletes are routed back
   * through enqueueDelete so the circuit breaker still sees them. Safe to call
   * once on startup; a no-op when Supabase is unavailable or the journal is
   * empty. Replay is idempotent (upsert/update only), so re-running a write the
   * server already has does no harm.
   */
  async rehydrate(): Promise<void> {
    if (!supabase || isPreviewMode.value) return
    let raw: string | null
    try {
      raw = await restoreFromIDB(JOURNAL_KEY)
    } catch {
      return
    }
    if (!raw) return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    // Two on-disk shapes coexist: the versioned envelope { version, entries }
    // (current) and the legacy bare `PersistedEntry[]` array (pre-LIFT-1132). A
    // legacy array carries no version — assume it was written under the current
    // generation, since dropping valid pending writes merely because they
    // predate versioning would be worse than replaying them (each is still
    // column-checked below).
    let version: number
    let rawEntries: unknown
    if (Array.isArray(parsed)) {
      version = JOURNAL_SCHEMA_VERSION
      rawEntries = parsed
    } else if (parsed && typeof parsed === 'object') {
      const env = parsed as Partial<PersistedJournal>
      version = typeof env.version === 'number' ? env.version : 0
      rawEntries = env.entries
    } else {
      return
    }
    if (!Array.isArray(rawEntries)) return
    // A journal stamped with a different schema generation may reference columns
    // or a key/match shape a migration has since changed — discard it wholesale
    // rather than replay stale rows into silent server failures (LIFT-1132), and
    // wipe the durable record so it isn't re-read on the next launch.
    if (version !== JOURNAL_SCHEMA_VERSION) {
      logWarn('Discarding sync journal written under a mismatched schema version', {
        journalVersion: version,
        currentVersion: JOURNAL_SCHEMA_VERSION,
        dropped: rawEntries.length,
      })
      this._journalActive = true
      this._persistJournal()
      return
    }
    const entries = rawEntries as PersistedEntry[]
    for (const entry of entries) {
      if (!entry || typeof entry.key !== 'string' || !entry.descriptor) continue
      // Drop any journaled entry whose descriptor falls outside the replay
      // allowlist (LIFT-785) — the journal is user-writable IndexedDB, so a
      // tampered or corrupted entry must never be rebuilt into a query.
      if (!isReplayableDescriptor(entry.descriptor)) {
        logWarn('Dropping journaled descriptor outside the replay allowlist', {
          key: entry.key,
          op: (entry.descriptor as { op?: unknown }).op,
          table: (entry.descriptor as { table?: unknown }).table,
        })
        continue
      }
      const { key, descriptor, isDelete } = entry
      // Don't clobber a newer in-session write: if the user acted on this key
      // while the (async) journal read was in flight, the live queue/retry entry
      // is fresher than the persisted snapshot and must win.
      if (this._queue.has(key) || this._retryQueue.has(key)) continue
      if (isDelete) {
        this.enqueueDelete(key, () => executeDescriptor(descriptor), descriptor)
      } else {
        this.enqueue(key, () => executeDescriptor(descriptor), descriptor)
      }
    }
  }

  /** Number of journaled (durable) pending operations. For tests/telemetry. */
  get journalSize(): number {
    return this._journal.size
  }

  private _scheduleFlush(): void {
    if (this._timer) clearTimeout(this._timer)
    this._timer = setTimeout(() => this.flush(), this._flushDelay)
  }

  private _scheduleRetry(): void {
    if (this._retryTimer) return // already scheduled
    // Exponential backoff based on highest attempt count
    const maxAttempt = Math.max(...[...this._retryQueue.values()].map(r => r.attempt))
    const delay = Math.min(1000 * Math.pow(2, maxAttempt - 1), 60000)
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null
      // Move retry items back to main queue with attempt metadata
      const retries = new Map(this._retryQueue)
      this._retryQueue.clear()
      for (const [key, { op }] of retries) {
        if (!this._queue.has(key)) {
          this._queue.set(key, op)
        }
      }
      this.flush()
    }, delay)
  }
}

/** Reset rate limit state (for testing only). */
export function _resetRateLimit(): void {
  _rateCount = 0
  if (_rateResetTimer) {
    clearTimeout(_rateResetTimer)
    _rateResetTimer = null
  }
  _deferredOps.clear()
}

/** Reset circuit breaker state (for testing only). */
export function _resetCircuitBreaker(): void {
  _deleteTimestamps = []
  _circuitOpenUntil = 0
  _circuitTripCount = 0
}

/** Inspect circuit breaker state (for testing / telemetry only). */
export function _getCircuitBreakerState(): {
  deleteCount: number
  openUntil: number
  tripCount: number
} {
  return {
    deleteCount: _deleteTimestamps.length,
    openUntil: _circuitOpenUntil,
    tripCount: _circuitTripCount,
  }
}

/** Shared sync queue instance used by all stores (1-second debounce). */
export const syncQueue = new SyncQueue(1000)
