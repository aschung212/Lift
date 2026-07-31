/**
 * Superset / circuit grouping (#616).
 *
 * A superset pairs 2+ exercises that are trained in alternation (push/pull,
 * tri-sets, giant sets). Membership is stored as a shared, opaque `supersetId`
 * string on each `Exercise` — every exercise carrying the same non-empty id is
 * one group. An id held by fewer than two exercises is meaningless ("a superset
 * of one") and is always dissolved.
 *
 * This module is the single source of truth for the domain logic: sanitizing
 * the id at every boundary (like gyms/equipment), grouping, laying members out
 * contiguously in an already-ordered list, deciding whose turn is next in the
 * alternation, and computing the membership change a UI edit implies. It is
 * pure and free of Vue/store concerns so it can be unit-tested exhaustively.
 */
import type { Exercise } from '../stores/workout'

/** Superset ids are uuids (36 chars); cap defensively so a corrupt blob can't bloat state. */
export const MAX_SUPERSET_ID_LENGTH = 64

/**
 * Validate a persisted/incoming superset id. Returns the trimmed id when it is
 * a non-empty string within the length cap, else `undefined` (unassigned). Used
 * at the localStorage, Supabase, and store-mutation boundaries so a single check
 * governs every entry point.
 */
export function sanitizeSupersetId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_SUPERSET_ID_LENGTH) return undefined
  return trimmed
}

/** True when the exercise belongs to a superset (carries a valid id). */
export function inSuperset(exercise: Pick<Exercise, 'supersetId'>): boolean {
  return sanitizeSupersetId(exercise.supersetId) !== undefined
}

/**
 * Group exercises by their (sanitized) superset id, preserving first-appearance
 * order both of the groups and of members within a group. Only ids shared by
 * two or more exercises in the input form a group — a lone member is omitted.
 */
export function groupBySuperset(exercises: readonly Exercise[]): Map<string, Exercise[]> {
  const groups = new Map<string, Exercise[]>()
  for (const ex of exercises) {
    const id = sanitizeSupersetId(ex.supersetId)
    if (!id) continue
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id)!.push(ex)
  }
  // Drop singletons — a superset needs at least two members to exist.
  for (const [id, members] of groups) {
    if (members.length < 2) groups.delete(id)
  }
  return groups
}

/**
 * Reorder an already-sorted list so superset members are contiguous, without
 * otherwise disturbing the order. Each group is emitted at the position of its
 * FIRST member in the input (so a recency-sorted list still floats the most
 * recent group to the top), with the remaining members pulled up to sit
 * immediately after it in their original relative order. Non-members and lone
 * members are emitted in place. The input is not mutated.
 */
export function orderWithSupersets(list: readonly Exercise[]): Exercise[] {
  const groups = groupBySuperset(list)
  const emitted = new Set<string>()
  const result: Exercise[] = []
  for (const ex of list) {
    const id = sanitizeSupersetId(ex.supersetId)
    if (id && groups.has(id)) {
      if (emitted.has(id)) continue // members already flushed with the group
      emitted.add(id)
      result.push(...groups.get(id)!)
    } else {
      result.push(ex)
    }
  }
  return result
}

export type SupersetPosition = 'solo' | 'start' | 'inner' | 'end'

export interface SupersetRow {
  exercise: Exercise
  /** Position within a contiguous run of same-superset rows. */
  position: SupersetPosition
  /** The group's shared id when part of a run of ≥2, else undefined. */
  supersetId: string | undefined
  /** 1-based ordinal within the run (1 for solo/start). */
  ordinal: number
  /** Total members in this contiguous run (1 for solo). */
  size: number
}

/**
 * Annotate an ordered list (typically the output of `orderWithSupersets`) with
 * each row's position inside its contiguous superset run. A run counts as a
 * superset only when two or more ADJACENT rows share a superset id — this is
 * what a connector/rail in the UI draws against. Rows outside a run are `solo`.
 */
export function annotateSupersetRows(list: readonly Exercise[]): SupersetRow[] {
  const rows: SupersetRow[] = []
  let i = 0
  while (i < list.length) {
    const id = sanitizeSupersetId(list[i].supersetId)
    // Measure the contiguous run sharing this id.
    let j = i + 1
    if (id) while (j < list.length && sanitizeSupersetId(list[j].supersetId) === id) j++
    const size = j - i
    if (id && size >= 2) {
      for (let k = i; k < j; k++) {
        rows.push({
          exercise: list[k],
          position: k === i ? 'start' : k === j - 1 ? 'end' : 'inner',
          supersetId: id,
          ordinal: k - i + 1,
          size,
        })
      }
    } else {
      rows.push({ exercise: list[i], position: 'solo', supersetId: undefined, ordinal: 1, size: 1 })
      j = i + 1 // solo consumes exactly one row
    }
    i = j
  }
  return rows
}

/**
 * Decide which member of a superset is up next in the alternation, given how
 * many sets each member has logged in the current session. The member with the
 * fewest sets is next; ties resolve to the earliest in `members` order so the
 * rotation is deterministic (A, B, A, B…). Returns `null` for a degenerate
 * group (<2 members) or before any set is logged (nothing to alternate yet).
 */
export function nextSupersetExerciseId(
  members: readonly Exercise[],
  setsToday: ReadonlyMap<string, number>,
): string | null {
  if (members.length < 2) return null
  const total = members.reduce((sum, m) => sum + (setsToday.get(m.id) ?? 0), 0)
  if (total === 0) return null // group not started this session — no "next" nudge
  let best: Exercise | null = null
  let bestCount = Infinity
  for (const m of members) {
    const count = setsToday.get(m.id) ?? 0
    if (count < bestCount) {
      bestCount = count
      best = m
    }
  }
  return best?.id ?? null
}

export interface SupersetChange {
  id: string
  /** New superset id, or undefined to clear membership. */
  supersetId: string | undefined
}

/**
 * Compute the membership changes implied by declaring that `memberIds` should
 * form exactly one superset together. Returns only the exercises whose id
 * actually changes (so the caller enqueues the minimum sync churn).
 *
 * Rules:
 * - Fewer than two valid members → those members leave any superset.
 * - Two or more → they share one id: the existing id is REUSED verbatim only
 *   when the current membership of that id is exactly this set (a no-op save);
 *   otherwise a fresh id is minted via `newId`, which also pulls each member
 *   out of any previous group.
 * - Any id left with fewer than two members after the reassignment (e.g. the
 *   remnant of a group a member just left) is dissolved.
 *
 * `newId` is injected so tests are deterministic.
 */
export function planSupersetChange(
  exercises: readonly Exercise[],
  memberIds: readonly string[],
  newId: () => string,
): SupersetChange[] {
  const byId = new Map(exercises.map(e => [e.id, e]))
  const current = new Map<string, string | undefined>()
  for (const e of exercises) current.set(e.id, sanitizeSupersetId(e.supersetId))

  // Valid, deduped targets in stable order.
  const seen = new Set<string>()
  const targets: string[] = []
  for (const id of memberIds) {
    if (byId.has(id) && !seen.has(id)) {
      seen.add(id)
      targets.push(id)
    }
  }

  const next = new Map(current)

  if (targets.length >= 2) {
    const candidateId = current.get(targets[0])
    // Reuse the existing id only when its CURRENT membership is exactly `targets`
    // — otherwise minting fresh avoids accidentally keeping an outsider in the
    // group or re-including a member that was just removed.
    let reuse = false
    if (candidateId) {
      const holders = exercises.filter(e => current.get(e.id) === candidateId).map(e => e.id)
      reuse = holders.length === targets.length && targets.every(id => holders.includes(id))
    }
    const assignId = reuse ? candidateId! : newId()
    for (const id of targets) next.set(id, assignId)
  } else {
    for (const id of targets) next.set(id, undefined)
  }

  // Dissolve any id now held by fewer than two exercises.
  const counts = new Map<string, number>()
  for (const sid of next.values()) if (sid) counts.set(sid, (counts.get(sid) ?? 0) + 1)
  for (const [id, sid] of next) {
    if (sid && (counts.get(sid) ?? 0) < 2) next.set(id, undefined)
  }

  const changes: SupersetChange[] = []
  for (const [id, sid] of next) {
    if (sid !== current.get(id)) changes.push({ id, supersetId: sid })
  }
  return changes
}
