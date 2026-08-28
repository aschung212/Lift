/**
 * Per-gym exercise filtering (#961).
 *
 * Gyms are plain string names (like tags): the synced gym LIST lives in the
 * preferences JSONB blob, per-exercise membership lives in `Exercise.gyms`
 * (synced via the additive `gyms text[]` column). The ACTIVE filter is
 * device-local ("which gym am I at today" is per-device state, like the
 * overload-nudge cooldowns) and deliberately not synced.
 */
import { loadJSON } from './storage'

export const MAX_GYMS = 10
export const GYM_NAME_MAX_LENGTH = 30
/** Device-local localStorage key for the active gym filter. NOT synced. */
export const ACTIVE_GYM_STORAGE_KEY = 'active-gym-filter'

/** Normalize a single gym name; null when unusable (empty/non-string). */
export function sanitizeGymName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, GYM_NAME_MAX_LENGTH).trim()
  return trimmed || null
}

/**
 * Sanitize the gym LIST from the preferences blob: strings only, trimmed,
 * case-preserving dedupe, capped at MAX_GYMS. Non-array input degrades to [].
 */
export function sanitizeGymList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    const name = sanitizeGymName(entry)
    if (name && !out.includes(name)) out.push(name)
    if (out.length >= MAX_GYMS) break
  }
  return out
}

/**
 * Sanitize `Exercise.gyms` at every boundary (store setter, localStorage
 * load, remote fetch). Same shape rules as the list; membership is not
 * capped at MAX_GYMS references because orphaned names (a gym renamed or
 * removed on another device) are legal and degrade to "unassigned".
 */
export function sanitizeExerciseGyms(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    const name = sanitizeGymName(entry)
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/**
 * The single source of truth for gym-filter semantics:
 *  - no active gym → pass
 *  - exercise has no gyms → pass (unassigned = shows everywhere)
 *  - exercise's gyms ∩ known gym list is empty → pass (orphan safety net:
 *    a rename/delete raced from another device must degrade to "too
 *    visible", never to an invisibly hidden exercise)
 *  - otherwise pass iff the intersection includes the active gym
 */
export function matchesGymFilter(
  exerciseGyms: readonly string[] | undefined,
  activeGym: string | null,
  knownGyms: readonly string[],
): boolean {
  if (!activeGym) return true
  if (!exerciseGyms || exerciseGyms.length === 0) return true
  const effective = exerciseGyms.filter(g => knownGyms.includes(g))
  if (effective.length === 0) return true
  return effective.includes(activeGym)
}

/** Guarded read of the device-local active gym filter. */
export function loadActiveGymFilter(): string | null {
  const stored = loadJSON<string | null>(
    ACTIVE_GYM_STORAGE_KEY,
    null,
    parsed => typeof parsed === 'string',
  )
  return stored ? sanitizeGymName(stored) : null
}

/** Persist (or clear, with null) the device-local active gym filter. */
export function saveActiveGymFilter(gym: string | null): void {
  try {
    if (gym === null) localStorage.removeItem(ACTIVE_GYM_STORAGE_KEY)
    else localStorage.setItem(ACTIVE_GYM_STORAGE_KEY, JSON.stringify(gym))
  } catch { /* storage unavailable — filter just won't persist */ }
}
