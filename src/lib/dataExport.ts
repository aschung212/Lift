import type { Exercise } from '../stores/workout'

interface BodyweightEntry {
  date: string
  weight: number
}

interface ProgressionSnapshot {
  totalXP: number
  epoch: number
  streakWeeks: number
  weeklyTarget: number
  starterTheme: string | null
  unlockedThemes: unknown[]
  xpPerSet: Record<string, unknown>
}

export interface ExportMetadata {
  exportDate: string
  appVersion: string
  userIdHash: string
}

export interface JsonExportData extends ExportMetadata {
  /** Unit of every weight in this file — canonical storage is lbs (LIFT-1215). */
  units: 'lbs'
  exercises: {
    name: string
    tags: string[]
    sets: { date: string; weight: number; reps: number; estimated1RM: number }[]
  }[]
  bodyweight: { date: string; weight: number }[]
  progression: ProgressionSnapshot
}

export async function hashUserId(uid: string): Promise<string> {
  const encoded = new TextEncoder().encode(uid)
  const buffer = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function buildJsonExport(
  metadata: ExportMetadata,
  exercises: Exercise[],
  bodyweight: BodyweightEntry[],
  progression: ProgressionSnapshot,
): JsonExportData {
  return {
    ...metadata,
    // All weights below are canonical lbs; label them so a re-import (ours or
    // a third-party tool's) never has to guess the unit (LIFT-1215).
    units: 'lbs',
    exercises: exercises.map(e => ({
      name: e.name,
      tags: e.tags,
      sets: e.sets.map(s => ({
        date: s.date,
        weight: s.weight,
        reps: s.reps,
        estimated1RM: s.estimated1RM,
      })),
    })),
    bodyweight: bodyweight.map(e => ({
      date: e.date,
      weight: e.weight,
    })),
    progression,
  }
}

/**
 * Trigger a client-side download of a Blob via a temporary anchor. The single
 * shared copy of this helper — SettingsSheet's data export, workout share
 * cards, and the bodyweight Health export all route through it (#1159).
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function buildCsvExport(
  metadata: ExportMetadata,
  exercises: Exercise[],
  bodyweight: BodyweightEntry[],
): string {
  const timestamp = metadata.exportDate.slice(0, 10)
  const lines = [
    // Weights are canonical lbs — labeled in the comment and the column
    // header so re-imports never guess (LIFT-1215). importLift accepts both
    // the labeled header and the legacy bare "Weight" for old exports.
    `# Lift Export — ${timestamp} — v${metadata.appVersion} — ${metadata.userIdHash} — weights in lbs`,
    'Exercise,Date,Weight (lbs),Reps,Estimated 1RM,Tags',
  ]
  for (const ex of exercises) {
    for (const s of ex.sets) {
      const date = s.date.slice(0, 10)
      const tags = ex.tags.join(';')
      lines.push(`${csvEscape(ex.name)},${date},${s.weight},${s.reps},${s.estimated1RM},${csvEscape(tags)}`)
    }
  }
  if (bodyweight.length > 0) {
    lines.push('')
    lines.push('Date,Body Weight (lbs)')
    for (const e of bodyweight) {
      lines.push(`${e.date.slice(0, 10)},${e.weight}`)
    }
  }
  return lines.join('\n')
}
