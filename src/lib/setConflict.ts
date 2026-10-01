/**
 * Per-set last-write-wins for the workout fetch merge (LIFT-1523).
 *
 * `_fetchFromSupabase` resolves EXERCISES by last-write-wins (`mergeEntities`),
 * and it used to let that one comparison decide every set inside them as well:
 * the winning exercise's array was kept, and on a local win every set whose
 * weight, reps or date differed from the server's copy was re-upserted. But a
 * set edit never moves its exercise's timestamp on the server — `updateSet`
 * upserts the `sets` row and nothing else — so the exercise comparison cannot
 * see one:
 *
 *   1. Devices A and B both hold set S (100 × 5) under exercise E, and both
 *      adopted E's server stamp T0.
 *   2. B corrects S to 105. B's upsert writes the `sets` row, whose own
 *      `updated_at` the trigger moves to T1. The `exercises` row is untouched
 *      and stays at T0.
 *   3. A fetches. E ties at T0, a tie is a LOCAL win, and S differs from the
 *      server's copy, so A re-upserts its stale 100 over B's 105. A's
 *      unconditional exercise upsert also moves E's server stamp past B's, so
 *      B's next fetch adopts the reverted copy. The correction is gone from
 *      both devices and from the server, and nothing errored.
 *
 * A device that had logged anything on E since its last fetch reverted the
 * correction just the same — `logSet` bumped its exercise stamp past the
 * server's, so it won outright instead of on a tie. And when E's REMOTE row won
 * instead (a rename on another device), the losing copy was the local one: an
 * unflushed local edit was replaced by the server's older copy.
 *
 * So a set is resolved by the SET's stamp. `WorkoutSet.updated_at` is written by
 * every local edit of a set's synced columns, and `mapRemoteSet` reads the
 * server's from the `sets.updated_at` column that `trg_sets_updated_at` moves on
 * every write. The exercise comparison keeps deciding the exercise's own fields
 * and nothing else.
 *
 * Mixing the two clocks is the same posture the exercise merge already takes,
 * and it holds for the same reason: the server stamps AFTER the device did, so
 * a copy that has round-tripped is at or ahead of the local edit it carries.
 * And because identical copies always resolve to the server's (below), the
 * local stamp is re-anchored to the server's clock on the first fetch after its
 * write lands — a device clock running ahead can only matter between an edit
 * and the next fetch, not for the life of the set.
 */
import type { Exercise, WorkoutSet } from '../stores/workout'

/** One server row, with the exercise the server files it under. */
export interface ServerSetCopy {
  set: WorkoutSet
  /**
   * `sets.exercise_id` as the server holds it. A push must keep this parent,
   * not the one the set is displayed under: a set shown inside a merged
   * duplicate (LIFT-1335) still belongs to its own row server-side, and a sync
   * has no authority to re-parent it (2026-04-12 SEV1).
   */
  exerciseId: string
}

/** Two `real` (float4) values are the same column value if they round to the same float4. */
function sameReal(a: number, b: number): boolean {
  return Math.fround(a) === Math.fround(b)
}

/** Two timestamps are the same if they name the same instant, whatever their rendering. */
function sameInstant(a: string, b: string): boolean {
  if (a === b) return true
  const ta = Date.parse(a)
  return Number.isFinite(ta) && ta === Date.parse(b)
}

/**
 * Whether two copies of one set agree on every `sets` column a write can change.
 *
 * Compared as column VALUES, never as JSON. The server renders `date` the way
 * Postgres renders a timestamptz (`…+00:00`, trailing fractional zeros dropped)
 * where the device wrote `…Z`, and `weight` / `estimated_1rm` are `real`
 * columns, so a weight the device holds at double precision — any kg entry,
 * converted to canonical lbs — comes back rounded to float4. A string or `===`
 * comparison calls every set this device logged a conflict until it happens to
 * adopt the server's rendering, which is what the old `remote.date !== set.date`
 * check did.
 *
 * `createdAt` is deliberately left out: it is written on insert and never
 * edited, so it cannot carry a conflict. Neither are the local-only fields
 * (`LOCAL_ONLY_SET_FIELDS`), which the server has no column for at all.
 */
export function sameSyncedSet(a: WorkoutSet, b: WorkoutSet): boolean {
  return a.reps === b.reps
    && sameReal(a.weight, b.weight)
    && sameReal(a.estimated1RM, b.estimated1RM)
    && sameInstant(a.date, b.date)
    && !!a.attemptedNextRep === !!b.attemptedNextRep
}

/** A stamp as epoch ms; absent or unparseable reads as older than everything. */
function stampMs(stamp: string | undefined): number {
  if (!stamp) return -Infinity
  const ms = Date.parse(stamp)
  return Number.isFinite(ms) ? ms : -Infinity
}

/**
 * Which copy of a set that both this device and the server hold should stand.
 *
 *  - **Same synced values → the server's.** Nothing is lost either way, and
 *    taking the server's copy takes its stamp, which re-anchors this device to
 *    the server's clock (see the module header).
 *  - **Different values → the strictly newer stamp.** A local copy wins only
 *    when this device wrote it after the server last accepted a write of it,
 *    and that win is a write the server has not seen, so the caller pushes it.
 *  - **A tie, or no local stamp → the server's.** The opposite of
 *    `mergeEntities`, which gives ties to local, and deliberately so. Every
 *    local edit of a set stamps it, so a tie with different values means the
 *    SERVER's values changed without its stamp moving: a database missing
 *    `trg_sets_updated_at` (production's catalog is not the migration history —
 *    LIFT-1401), or a backfill that suppressed the trigger on purpose (the
 *    LIFT-1398 shape). The server holds the newer values in both. A set with no
 *    local stamp is one this device logged and never edited, or one persisted
 *    before stamps existed; neither is a local edit, so it has no claim either.
 */
export function pickSetCopy(local: WorkoutSet, remote: WorkoutSet): 'local' | 'remote' {
  if (sameSyncedSet(local, remote)) return 'remote'
  return stampMs(local.updated_at) > stampMs(remote.updated_at) ? 'local' : 'remote'
}

/**
 * Index every set currently in local state by id. Call it BEFORE the merge: the
 * set-union step pushes server copies into the local exercises' arrays in
 * place, and an index taken afterwards would mistake those for local copies.
 */
export function indexSetsById(exercises: readonly Exercise[]): Map<string, WorkoutSet> {
  const byId = new Map<string, WorkoutSet>()
  for (const exercise of exercises) {
    for (const set of exercise.sets) byId.set(set.id, set)
  }
  return byId
}

/**
 * Put the winning copy of every set both sides hold into its slot, in place,
 * and return the local copies that won, paired with the parent the server files
 * them under. Each returned copy is a local edit the server has not seen, so
 * the caller pushes exactly these and nothing else for sets the server already
 * has.
 *
 * Keyed by set id across ALL exercises rather than exercise-by-exercise, so it
 * also reaches a set the device shows under a different exercise than the
 * server does — the merged-duplicate case, where a per-exercise comparison sees
 * the set as missing from the server and the server's copy is never consulted.
 * Run it after both dedup passes, like `restoreLocalOnlySetFields`, so it
 * covers every set about to be committed rather than one path's worth.
 */
export function resolveSetConflicts(
  exercises: readonly Exercise[],
  local: ReadonlyMap<string, WorkoutSet>,
  server: ReadonlyMap<string, ServerSetCopy>,
): ServerSetCopy[] {
  const localWinners = new Map<string, ServerSetCopy>()
  for (const exercise of exercises) {
    exercise.sets = exercise.sets.map(slot => {
      const mine = local.get(slot.id)
      const theirs = server.get(slot.id)
      if (!mine || !theirs) return slot
      if (pickSetCopy(mine, theirs.set) === 'remote') return theirs.set
      localWinners.set(slot.id, { set: mine, exerciseId: theirs.exerciseId })
      return mine
    })
  }
  return [...localWinners.values()]
}
