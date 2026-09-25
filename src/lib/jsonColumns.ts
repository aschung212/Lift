/**
 * Typed JSON column helpers for Supabase.
 *
 * Replaces the double-cast pattern (`as unknown as Json`) with functions
 * that validate shape on read and produce `Json` on write without unsafe casts.
 * If a column value doesn't match the expected shape, the fallback is returned
 * instead of silently accepting corrupt data.
 */
import type { Json } from './database.types'
import { resolveThemeId } from './themes'
import type { StreakWeekEntry, SetXPEntry, ThemeUnlock } from '../stores/progression'
import { logWarn } from './logger'

// ── Write helpers (domain → Json) ─────────────────────────────────

/** Convert ThemeUnlock[] to a Json-compatible value. */
export function themeUnlocksToJson(themes: ThemeUnlock[]): Json {
  return themes.map(t => ({
    id: t.id,
    unlockedAt: t.unlockedAt,
    ...(t.totalXPAtUnlock !== undefined ? { totalXPAtUnlock: t.totalXPAtUnlock } : {}),
    ...(t.totalSetsAtUnlock !== undefined ? { totalSetsAtUnlock: t.totalSetsAtUnlock } : {}),
  }))
}

/** Convert StreakWeekEntry[] to a Json-compatible value. */
export function streakHistoryToJson(history: StreakWeekEntry[]): Json {
  return history.map(e => ({
    weekStart: e.weekStart,
    streakCount: e.streakCount,
    weeklyTarget: e.weeklyTarget,
    combinedMultiplier: e.combinedMultiplier,
  }))
}

/** Convert xpPerSet record to a Json-compatible value. */
export function xpPerSetToJson(xpPerSet: Record<string, SetXPEntry | number>): Json {
  const result: { [key: string]: Json | undefined } = {}
  for (const [key, entry] of Object.entries(xpPerSet)) {
    if (typeof entry === 'number') {
      result[key] = entry
    } else {
      result[key] = {
        xp: entry.xp,
        theme: entry.theme,
        epoch: entry.epoch,
        zone: entry.zone,
        isPR: entry.isPR,
        isRepPR: entry.isRepPR,
      }
    }
  }
  return result
}

/** Convert bodyweightXPDates to a Json-compatible value. */
export function bodyweightDatesToJson(dates: string[]): Json {
  return [...dates]
}

// ── Read helpers (Json → domain) ──────────────────────────────────

/** Parse a Json value as StreakWeekEntry[], skipping invalid entries. */
export function parseStreakHistory(value: Json | undefined, fallback: StreakWeekEntry[]): StreakWeekEntry[] {
  if (!Array.isArray(value)) return fallback
  // Empty array is a valid remote state (cleared history) — return it, don't use fallback
  if (value.length === 0) return []
  const result: StreakWeekEntry[] = []
  for (const item of value) {
    if (!isPlainObject(item)) {
      logWarn('Invalid streak history entry, skipping', { item })
      continue
    }
    const obj = item as { [key: string]: Json | undefined }
    if (typeof obj.weekStart !== 'string') {
      logWarn('Invalid streak history entry (missing weekStart), skipping', { item })
      continue
    }
    result.push({
      weekStart: obj.weekStart,
      streakCount: typeof obj.streakCount === 'number' ? obj.streakCount : 0,
      weeklyTarget: typeof obj.weeklyTarget === 'number' ? obj.weeklyTarget : 3,
      combinedMultiplier: typeof obj.combinedMultiplier === 'number' ? obj.combinedMultiplier : 1.0,
    })
  }
  return result.length > 0 ? result : fallback
}

/**
 * Parse a Json value as ThemeUnlock[] (handles legacy string[] format).
 *
 * Every `id` goes through `resolveThemeId` (LIFT-1503) rather than an `as
 * ThemeId` cast: this column is user-writable JSONB, and an entry naming no
 * current theme is unspendable — `isThemeUnlocked` answers by equality, so it
 * reads as locked — while still counting toward `unlockedThemes.length`. It is
 * dropped with a `logWarn`, the same treatment an entry with a non-string id
 * already got; a legacy id is migrated onto its current theme instead, so an
 * earned entitlement survives a rename.
 *
 * The result is deduplicated by id, keeping the EARLIEST unlock — the rule
 * `mergeUnlockedThemes` already applies, and now load-bearing here too, since
 * migration can collapse two legacy ids onto one theme (`tina` and `bloom` are
 * both `love`) and a duplicate would inflate the same count.
 */
export function parseUnlockedThemes(value: Json | undefined): ThemeUnlock[] | null {
  if (!Array.isArray(value)) return null
  if (value.length === 0) return null

  // Check if already new format (objects with id field)
  if (isPlainObject(value[0]) && 'id' in (value[0] as Record<string, unknown>)) {
    const result: ThemeUnlock[] = []
    for (const item of value) {
      if (!isPlainObject(item)) {
        logWarn('Invalid theme unlock entry, skipping', { item })
        continue
      }
      const obj = item as { [key: string]: Json | undefined }
      if (typeof obj.id !== 'string' || typeof obj.unlockedAt !== 'string') {
        logWarn('Invalid theme unlock entry, skipping', { item })
        continue
      }
      const id = resolveThemeId(obj.id)
      if (id === null) {
        logWarn('Theme unlock entry names no known theme, skipping', { item })
        continue
      }
      result.push({
        id,
        unlockedAt: obj.unlockedAt,
        ...(typeof obj.totalXPAtUnlock === 'number' ? { totalXPAtUnlock: obj.totalXPAtUnlock } : {}),
        ...(typeof obj.totalSetsAtUnlock === 'number' ? { totalSetsAtUnlock: obj.totalSetsAtUnlock } : {}),
      })
    }
    return dedupeUnlocks(result)
  }

  // Legacy string[] format
  if (typeof value[0] === 'string') {
    const unlockedAt = new Date().toISOString()
    const result: ThemeUnlock[] = []
    for (const item of value) {
      const id = resolveThemeId(item)
      if (id === null) {
        logWarn('Legacy theme unlock entry names no known theme, skipping', { item })
        continue
      }
      result.push({ id, unlockedAt })
    }
    return dedupeUnlocks(result)
  }

  return null
}

/** Parse a Json value as Record<string, SetXPEntry | number>. */
export function parseXpPerSet(
  value: Json | undefined,
  fallback: Record<string, SetXPEntry | number>,
): Record<string, SetXPEntry | number> {
  if (!isPlainObject(value)) return fallback
  const obj = value as { [key: string]: Json | undefined }
  const result: Record<string, SetXPEntry | number> = {}
  for (const [key, entry] of Object.entries(obj)) {
    if (entry === undefined) continue
    if (typeof entry === 'number') {
      result[key] = entry
    } else if (isPlainObject(entry)) {
      const e = entry as { [key: string]: Json | undefined }
      // xp is the only required field; other fields may be absent in legacy data
      if (typeof e.xp !== 'number') {
        logWarn('Invalid xpPerSet entry (missing xp), skipping', { key, entry })
        continue
      }
      result[key] = {
        xp: e.xp,
        theme: typeof e.theme === 'string' ? e.theme : '',
        epoch: typeof e.epoch === 'number' ? e.epoch : 1,
        zone: typeof e.zone === 'string' ? e.zone : '',
        isPR: typeof e.isPR === 'boolean' ? e.isPR : false,
        isRepPR: typeof e.isRepPR === 'boolean' ? e.isRepPR : false,
      }
    }
  }
  return result
}

/** Parse a Json value as string[] (bodyweight XP dates), skipping invalid entries. */
export function parseBodyweightDates(value: Json | undefined, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  // Empty array is a valid remote state — return it, don't use fallback
  if (value.length === 0) return []
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      logWarn('Invalid bodyweight date entry, skipping', { item })
      continue
    }
    result.push(item)
  }
  return result.length > 0 ? result : fallback
}

// ── Internal ──────────────────────────────────────────────────────

/**
 * Collapse repeated theme ids, keeping the earliest unlock (and its stat
 * snapshot) — the same rule `mergeUnlockedThemes` applies across devices.
 * Returns null for an empty list so the caller's "nothing usable here" branch
 * still fires.
 */
function dedupeUnlocks(unlocks: ThemeUnlock[]): ThemeUnlock[] | null {
  const byId = new Map<string, ThemeUnlock>()
  for (const unlock of unlocks) {
    const existing = byId.get(unlock.id)
    if (!existing || unlock.unlockedAt < existing.unlockedAt) byId.set(unlock.id, unlock)
  }
  return byId.size > 0 ? Array.from(byId.values()) : null
}

function isPlainObject(v: unknown): v is { [key: string]: Json | undefined } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
