/**
 * Typed JSON column helpers for Supabase.
 *
 * Replaces the double-cast pattern (`as unknown as Json`) with functions
 * that validate shape on read and produce `Json` on write without unsafe casts.
 * If a column value doesn't match the expected shape, the fallback is returned
 * instead of silently accepting corrupt data.
 */
import type { Json } from './database.types'
import type { ThemeId } from './themes'
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
  const result: StreakWeekEntry[] = []
  for (const item of value) {
    if (!isPlainObject(item)) {
      logWarn('Invalid streak history entry, skipping', { item })
      continue
    }
    const obj = item as { [key: string]: Json | undefined }
    if (
      typeof obj.weekStart !== 'string' ||
      typeof obj.streakCount !== 'number' ||
      typeof obj.weeklyTarget !== 'number' ||
      typeof obj.combinedMultiplier !== 'number'
    ) {
      logWarn('Invalid streak history entry, skipping', { item })
      continue
    }
    result.push({
      weekStart: obj.weekStart,
      streakCount: obj.streakCount,
      weeklyTarget: obj.weeklyTarget,
      combinedMultiplier: obj.combinedMultiplier,
    })
  }
  return result.length > 0 ? result : fallback
}

/** Parse a Json value as ThemeUnlock[] (handles legacy string[] format). */
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
      result.push({
        id: obj.id as ThemeId,
        unlockedAt: obj.unlockedAt,
        ...(typeof obj.totalXPAtUnlock === 'number' ? { totalXPAtUnlock: obj.totalXPAtUnlock } : {}),
        ...(typeof obj.totalSetsAtUnlock === 'number' ? { totalSetsAtUnlock: obj.totalSetsAtUnlock } : {}),
      })
    }
    return result.length > 0 ? result : null
  }

  // Legacy string[] format
  if (typeof value[0] === 'string') {
    return (value as string[]).map(id => ({
      id: id as ThemeId,
      unlockedAt: new Date().toISOString(),
    }))
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

function isPlainObject(v: unknown): v is { [key: string]: Json | undefined } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
