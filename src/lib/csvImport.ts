import { uuid, endOfDayISO } from './uuid'
import type { Exercise } from '../stores/workout'

export interface ImportResult {
  exercises: Exercise[]
  totalSets: number
  skippedRows: number
  format: 'strong' | 'hevy' | 'lift' | 'unknown'
}

/** Epley formula: weight × (1 + reps / 30) */
function estimated1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0
  if (reps === 1) return weight
  return Math.round(weight * (1 + reps / 30))
}

/** Convert kg to lbs */
function kgToLbs(kg: number): number {
  return Math.round(kg * 2.20462 * 10) / 10
}

/** Parse a CSV string into rows of string arrays, handling quoted fields */
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let i = 0
  while (i < text.length) {
    const row: string[] = []
    while (i < text.length) {
      if (text[i] === '"') {
        // Quoted field
        i++
        let field = ''
        while (i < text.length) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') {
              field += '"'
              i += 2
            } else {
              i++ // closing quote
              break
            }
          } else {
            field += text[i]
            i++
          }
        }
        row.push(field)
        if (text[i] === ',') i++
        else if (text[i] === '\n' || text[i] === '\r') break
      } else {
        // Unquoted field
        let field = ''
        while (i < text.length && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          field += text[i]
          i++
        }
        row.push(field)
        if (text[i] === ',') i++
        else break
      }
    }
    // Skip line endings
    if (text[i] === '\r') i++
    if (text[i] === '\n') i++
    if (row.length > 0 && row.some(f => f.trim())) rows.push(row)
  }
  return rows
}

function detectFormat(headers: string[]): 'strong' | 'hevy' | 'lift' | 'unknown' {
  const lower = headers.map(h => h.toLowerCase().trim())
  if (lower.includes('exercise name') && lower.includes('set order')) return 'strong'
  if (lower.includes('exercise_title') && lower.includes('set_index')) return 'hevy'
  if (lower.includes('exercise') && lower.includes('estimated 1rm')) return 'lift'
  return 'unknown'
}

function parseDate(dateStr: string): string {
  const trimmed = dateStr.trim()
  // ISO format: 2026-04-05 or 2026-04-05T23:59:59Z
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return endOfDayISO(trimmed.slice(0, 10))
  }
  // US format: 04/05/2026 or 4/5/2026
  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (usMatch) {
    const [, m, d, y] = usMatch
    return endOfDayISO(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`)
  }
  // Fallback: try Date.parse
  const parsed = new Date(trimmed)
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString()
  }
  return ''
}

function importStrong(rows: string[][], headers: string[]): ImportResult {
  const col = (name: string) => headers.findIndex(h => h.toLowerCase().trim() === name.toLowerCase())
  const iDate = col('date')
  const iExercise = col('exercise name')
  // Strong exports weights in the user's app unit (LIFT-1215). Two in-file
  // signals identify kg data: a "Weight (kg)" column header (regional
  // variant), or a per-row "Weight Unit" column. A bare "weight" column with
  // neither signal keeps the legacy lbs assumption. Previously kg was never
  // converted (a 100 kg squat imported as a 100 lb one) and the
  // "Weight (kg)" header variant matched nothing, silently skipping every
  // row of the file.
  const iWeightKg = col('weight (kg)')
  const iWeight = iWeightKg !== -1 ? iWeightKg : col('weight')
  const iUnit = col('weight unit')
  const iReps = col('reps')

  const exerciseMap = new Map<string, Exercise>()
  let totalSets = 0
  let skippedRows = 0

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const name = row[iExercise]?.trim()
    const rawWeight = parseFloat(row[iWeight] || '0') || 0
    const rowIsKg = iWeightKg !== -1 ||
      (iUnit !== -1 && (row[iUnit] || '').toLowerCase().includes('kg'))
    const weight = rowIsKg ? kgToLbs(rawWeight) : rawWeight
    const reps = parseInt(row[iReps] || '0') || 0
    const date = parseDate(row[iDate] || '')

    if (!name || !date || (weight === 0 && reps === 0)) {
      skippedRows++
      continue
    }

    if (!exerciseMap.has(name.toLowerCase())) {
      exerciseMap.set(name.toLowerCase(), { id: uuid(), name, tags: [], sets: [] })
    }
    const exercise = exerciseMap.get(name.toLowerCase())!
    exercise.sets.push({
      id: uuid(),
      date,
      weight,
      reps,
      estimated1RM: estimated1RM(weight, reps),
    })
    totalSets++
  }

  return { exercises: [...exerciseMap.values()], totalSets, skippedRows, format: 'strong' }
}

function importHevy(rows: string[][], headers: string[]): ImportResult {
  const col = (name: string) => headers.findIndex(h => h.toLowerCase().trim() === name.toLowerCase())
  const iDate = col('start_time')
  const iExercise = col('exercise_title')
  const iWeight = col('weight_kg')
  const iReps = col('reps')

  const exerciseMap = new Map<string, Exercise>()
  let totalSets = 0
  let skippedRows = 0

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const name = row[iExercise]?.trim()
    const weightKg = parseFloat(row[iWeight] || '0') || 0
    const weight = kgToLbs(weightKg)
    const reps = parseInt(row[iReps] || '0') || 0
    const date = parseDate(row[iDate] || '')

    if (!name || !date || (weight === 0 && reps === 0)) {
      skippedRows++
      continue
    }

    if (!exerciseMap.has(name.toLowerCase())) {
      exerciseMap.set(name.toLowerCase(), { id: uuid(), name, tags: [], sets: [] })
    }
    const exercise = exerciseMap.get(name.toLowerCase())!
    exercise.sets.push({
      id: uuid(),
      date,
      weight,
      reps,
      estimated1RM: estimated1RM(weight, reps),
    })
    totalSets++
  }

  return { exercises: [...exerciseMap.values()], totalSets, skippedRows, format: 'hevy' }
}

function importLift(rows: string[][], headers: string[]): ImportResult {
  const col = (name: string) => headers.findIndex(h => h.toLowerCase().trim() === name.toLowerCase())
  const iExercise = col('exercise')
  const iDate = col('date')
  // Exports label the column "Weight (lbs)" since LIFT-1215; older exports
  // used bare "Weight". Accept both so every Lift export round-trips.
  const iWeightLabeled = col('weight (lbs)')
  const iWeight = iWeightLabeled !== -1 ? iWeightLabeled : col('weight')
  const iReps = col('reps')
  const iTags = col('tags')

  const exerciseMap = new Map<string, Exercise>()
  let totalSets = 0
  let skippedRows = 0

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const name = row[iExercise]?.trim()
    const weight = parseFloat(row[iWeight] || '0') || 0
    const reps = parseInt(row[iReps] || '0') || 0
    const date = parseDate(row[iDate] || '')
    const tags = row[iTags]?.split(';').map(t => t.trim()).filter(Boolean) || []

    if (!name || !date || (weight === 0 && reps === 0)) {
      skippedRows++
      continue
    }

    const key = name.toLowerCase()
    if (!exerciseMap.has(key)) {
      exerciseMap.set(key, { id: uuid(), name, tags, sets: [] })
    }
    const exercise = exerciseMap.get(key)!
    // Merge tags from multiple rows
    for (const tag of tags) {
      if (!exercise.tags.includes(tag)) exercise.tags.push(tag)
    }
    exercise.sets.push({
      id: uuid(),
      date,
      weight,
      reps,
      estimated1RM: estimated1RM(weight, reps),
    })
    totalSets++
  }

  return { exercises: [...exerciseMap.values()], totalSets, skippedRows, format: 'lift' }
}

/**
 * Parse a CSV file and return exercises with sets.
 * Auto-detects Strong, Hevy, and Lift formats.
 */
export function importCSV(text: string): ImportResult {
  // Skip comment lines (Lift export starts with #)
  const lines = text.split('\n')
  const dataStart = lines.findIndex(l => !l.startsWith('#') && l.trim())
  const cleanText = lines.slice(dataStart).join('\n')

  const rows = parseCSV(cleanText)
  if (rows.length < 2) {
    return { exercises: [], totalSets: 0, skippedRows: 0, format: 'unknown' }
  }

  const headers = rows[0]
  const format = detectFormat(headers)

  switch (format) {
    case 'strong': return importStrong(rows, headers)
    case 'hevy': return importHevy(rows, headers)
    case 'lift': return importLift(rows, headers)
    default:
      return { exercises: [], totalSets: 0, skippedRows: rows.length - 1, format: 'unknown' }
  }
}
