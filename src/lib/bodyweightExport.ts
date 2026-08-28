/**
 * Bodyweight CSV export for Apple Health import (#1159).
 *
 * Apple Health has no native CSV import, but the mainstream import paths —
 * the Health CSV Importer app and an Apple Shortcuts "Log Health Sample"
 * automation — both consume a two-column `Date,Weight` CSV with yyyy-MM-dd
 * dates. This module builds that file from bodyweight entries: one row per
 * calendar day (the same latest-entry-per-day rule the tracker chart uses),
 * sorted ascending, weights converted to the user's display unit. The import
 * tools ask for (or assume) a unit rather than reading one from the file, so
 * the filename carries it (`lift-bodyweight-lbs-2026-08-17.csv`) and the
 * columns stay strictly `Date,Weight` for maximum importer compatibility.
 */

import type { BodyweightEntry } from '../stores/bodyweight'
import type { WeightUnit } from './themes'
import { setDayKey } from './dates'

export interface DailyBodyweight {
  /** Local calendar day, yyyy-MM-dd (via setDayKey — handles both storage conventions, #746). */
  date: string
  /** Weight in lbs (storage unit), NOT display units. */
  weight: number
}

/**
 * Latest entry per calendar day, ascending. Single source of truth for the
 * "what does a day weigh" question — the tracker chart renders exactly this,
 * so the exported file always matches what the user sees on screen.
 */
export function dailyLatestBodyweight(entries: BodyweightEntry[]): DailyBodyweight[] {
  const byDate: Record<string, BodyweightEntry> = {}
  for (const e of entries) {
    const day = setDayKey(e.date)
    if (!byDate[day] || e.id > byDate[day].id) byDate[day] = e
  }
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, e]) => ({ date, weight: e.weight }))
}

/**
 * Storage-lbs → display unit, matching useWeightUnit.displayWeight's rounding
 * exactly so the exported numbers are the ones the user sees in the app.
 */
export function toDisplayWeight(lbs: number, unit: WeightUnit): number {
  if (unit === 'kg') return +(lbs * 0.453592).toFixed(1)
  return +lbs.toFixed(1)
}

/** Build the `Date,Weight` CSV. Empty entries yield just the header row. */
export function buildBodyweightCsv(entries: BodyweightEntry[], unit: WeightUnit): string {
  const lines = ['Date,Weight']
  for (const { date, weight } of dailyLatestBodyweight(entries)) {
    lines.push(`${date},${toDisplayWeight(weight, unit)}`)
  }
  return lines.join('\n')
}

/** `todayKey` is a yyyy-MM-dd local day key (todayISO()). */
export function bodyweightCsvFilename(unit: WeightUnit, todayKey: string): string {
  return `lift-bodyweight-${unit}-${todayKey}.csv`
}
