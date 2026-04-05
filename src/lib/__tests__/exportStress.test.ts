/**
 * Stress tests for data export (CSV & JSON generation).
 *
 * Validates that export functions remain performant with large
 * datasets — 500 exercises, thousands of sets, and edge-case data.
 */
import { describe, it, expect } from 'vitest'

// ── Inline export logic (mirrors App.vue export) ─────────────────
// We test the pure computation, not the DOM download trigger.

interface WorkoutSet {
  id: string
  date: string
  weight: number
  reps: number
  estimated1RM: number
}

interface Exercise {
  id: string
  name: string
  tags: string[]
  sets: WorkoutSet[]
}

interface BodyweightEntry {
  id: string
  date: string
  weight: number
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function generateCSV(exercises: Exercise[], bodyweight: BodyweightEntry[]): string {
  const lines = ['Exercise,Date,Weight,Reps,Estimated 1RM,Tags']
  for (const ex of exercises) {
    for (const s of ex.sets) {
      const date = s.date.slice(0, 10)
      const tags = ex.tags.join(';')
      lines.push(`${csvEscape(ex.name)},${date},${s.weight},${s.reps},${s.estimated1RM},${csvEscape(tags)}`)
    }
  }
  if (bodyweight.length > 0) {
    lines.push('')
    lines.push('Date,Body Weight')
    for (const e of bodyweight) {
      lines.push(`${e.date.slice(0, 10)},${e.weight}`)
    }
  }
  return lines.join('\n')
}

function generateJSON(exercises: Exercise[], bodyweight: BodyweightEntry[]): string {
  const data = {
    exportDate: new Date().toISOString(),
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
    progression: {
      totalXP: 500000,
      epoch: 1,
      streakWeeks: 52,
      weeklyTarget: 4,
      starterTheme: 'fire',
      unlockedThemes: [{ id: 'pearl', unlockedAt: '2025-01-01T00:00:00Z' }],
      xpPerSet: {},
    },
  }
  return JSON.stringify(data, null, 2)
}

// ── Test data generators ─────────────────────────────────────────

function makeExercises(count: number, setsPerExercise: number): Exercise[] {
  const exercises: Exercise[] = []
  for (let i = 0; i < count; i++) {
    const sets: WorkoutSet[] = []
    for (let j = 0; j < setsPerExercise; j++) {
      sets.push({
        id: `set-${i}-${j}`,
        date: `2026-${String(Math.floor(j / 28) % 12 + 1).padStart(2, '0')}-${String((j % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
        weight: 100 + (j % 20) * 5,
        reps: 3 + (j % 10),
        estimated1RM: Math.round((100 + (j % 20) * 5) * (1 + (3 + (j % 10)) / 30)),
      })
    }
    exercises.push({
      id: `exercise-${i}`,
      name: `Exercise ${i}`,
      tags: [`Tag${i % 10}`, `Group${i % 5}`],
      sets,
    })
  }
  return exercises
}

function makeBodyweight(count: number): BodyweightEntry[] {
  const entries: BodyweightEntry[] = []
  const base = new Date('2024-01-01T12:00:00.000Z')
  for (let i = 0; i < count; i++) {
    entries.push({
      id: `bw-${i}`,
      date: new Date(base.getTime() + i * 86400000).toISOString(),
      weight: 170 + Math.sin(i / 30) * 10,
    })
  }
  return entries
}

function measure(fn: () => void): number {
  const start = performance.now()
  fn()
  return performance.now() - start
}

// ── Tests ────────────────────────────────────────────────────────

describe('data export — stress tests', () => {
  describe('CSV generation', () => {
    it('generates CSV for 500 exercises × 20 sets (10,000 rows) under 100ms', () => {
      const exercises = makeExercises(500, 20)
      let csv = ''

      const elapsed = measure(() => {
        csv = generateCSV(exercises, [])
      })

      const lines = csv.split('\n')
      // 1 header + 10,000 data rows
      expect(lines.length).toBe(10_001)
      expect(elapsed).toBeLessThan(100)
    })

    it('generates CSV for 100 exercises × 100 sets + 730 bodyweight entries under 100ms', () => {
      const exercises = makeExercises(100, 100)
      const bodyweight = makeBodyweight(730)
      let csv = ''

      const elapsed = measure(() => {
        csv = generateCSV(exercises, bodyweight)
      })

      const lines = csv.split('\n')
      // 1 header + 10,000 sets + 1 blank + 1 bw header + 730 bw entries = 10,733
      expect(lines.length).toBe(10_733)
      expect(elapsed).toBeLessThan(100)
    })

    it('handles exercises with commas and quotes in names during CSV export', () => {
      const exercises: Exercise[] = [{
        id: 'tricky-1',
        name: 'Bench Press, Flat',
        tags: ['Chest, Front Delts'],
        sets: [{
          id: 's-1',
          date: '2026-01-01T12:00:00.000Z',
          weight: 225,
          reps: 5,
          estimated1RM: 253,
        }],
      }, {
        id: 'tricky-2',
        name: 'Squat "ATG"',
        tags: ['Legs'],
        sets: [{
          id: 's-2',
          date: '2026-01-01T12:00:00.000Z',
          weight: 315,
          reps: 3,
          estimated1RM: 347,
        }],
      }]

      const csv = generateCSV(exercises, [])
      const lines = csv.split('\n')
      // Quoted fields for names/tags with commas or quotes
      expect(lines[1]).toContain('"Bench Press, Flat"')
      expect(lines[1]).toContain('"Chest, Front Delts"')
      expect(lines[2]).toContain('"Squat ""ATG"""')
    })
  })

  describe('JSON generation', () => {
    it('generates JSON for 500 exercises × 20 sets under 200ms', () => {
      const exercises = makeExercises(500, 20)
      const bodyweight = makeBodyweight(365)
      let json = ''

      const elapsed = measure(() => {
        json = generateJSON(exercises, bodyweight)
      })

      const parsed = JSON.parse(json)
      expect(parsed.exercises.length).toBe(500)
      expect(parsed.bodyweight.length).toBe(365)
      expect(elapsed).toBeLessThan(200)
    })

    it('generates valid JSON with 1000 exercises × 50 sets (50,000 sets) under 1000ms', () => {
      const exercises = makeExercises(1000, 50)
      let json = ''

      const elapsed = measure(() => {
        json = generateJSON(exercises, [])
      })

      // Verify it's valid JSON
      const parsed = JSON.parse(json)
      expect(parsed.exercises.length).toBe(1000)
      // Total sets across all exercises
      const totalSets = parsed.exercises.reduce(
        (sum: number, e: { sets: unknown[] }) => sum + e.sets.length, 0
      )
      expect(totalSets).toBe(50_000)
      expect(elapsed).toBeLessThan(1000)
    })
  })

  describe('CSV output size', () => {
    it('estimates export size for large datasets stays under 5MB', () => {
      const exercises = makeExercises(500, 50) // 25,000 sets
      const bodyweight = makeBodyweight(730)
      const csv = generateCSV(exercises, bodyweight)
      const sizeBytes = new Blob([csv]).size
      const sizeMB = sizeBytes / (1024 * 1024)

      // 25,000 rows + 730 bodyweight should be well under 5MB
      expect(sizeMB).toBeLessThan(5)
    })
  })
})
