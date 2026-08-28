import { describe, it, expect, vi } from 'vitest'
import { importCSV } from '../csvImport'

vi.mock('../uuid', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return { ...actual, uuid: () => 'test-uuid' }
})

describe('csvImport', () => {
  describe('Strong format', () => {
    it('parses basic Strong CSV', () => {
      const csv = `Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2026-04-01,Morning,Bench Press,1,185,5,,,,,
2026-04-01,Morning,Bench Press,2,185,5,,,,,
2026-04-01,Morning,Squat,1,225,3,,,,,`

      const result = importCSV(csv)
      expect(result.format).toBe('strong')
      expect(result.exercises).toHaveLength(2)
      expect(result.totalSets).toBe(3)
      expect(result.skippedRows).toBe(0)

      const bench = result.exercises.find(e => e.name === 'Bench Press')!
      expect(bench.sets).toHaveLength(2)
      expect(bench.sets[0].weight).toBe(185)
      expect(bench.sets[0].reps).toBe(5)
      expect(bench.sets[0].estimated1RM).toBe(216) // 185 * (1 + 5/30)
    })

    // Regression LIFT-1215: Strong kg data imported as raw numbers (a 100 kg
    // squat became a 100 lb one), and the "Weight (kg)" header variant matched
    // no column at all — every row silently skipped.
    it('converts a "Weight (kg)" column to lbs (LIFT-1215)', () => {
      const csv = `Date,Workout Name,Exercise Name,Set Order,Weight (kg),Reps,Distance,Seconds
2026-04-01,Morning,Squat,1,100,5,,`

      const result = importCSV(csv)
      expect(result.format).toBe('strong')
      expect(result.totalSets).toBe(1)
      expect(result.skippedRows).toBe(0)
      // 100 kg → 220.5 lbs (same rounding as the Hevy path)
      expect(result.exercises[0].sets[0].weight).toBe(220.5)
    })

    it('converts per-row kg via a "Weight Unit" column (LIFT-1215)', () => {
      const csv = `Date,Workout Name,Exercise Name,Set Order,Weight,Weight Unit,Reps
2026-04-01,Morning,Squat,1,100,kg,5
2026-04-01,Morning,Bench Press,1,185,lbs,5`

      const result = importCSV(csv)
      expect(result.format).toBe('strong')
      const squat = result.exercises.find(e => e.name === 'Squat')!
      const bench = result.exercises.find(e => e.name === 'Bench Press')!
      expect(squat.sets[0].weight).toBe(220.5)
      expect(bench.sets[0].weight).toBe(185)
    })

    it('keeps the legacy lbs assumption for a bare Weight column (LIFT-1215)', () => {
      const csv = `Date,Workout Name,Exercise Name,Set Order,Weight,Reps
2026-04-01,Morning,Bench Press,1,185,5`

      const result = importCSV(csv)
      expect(result.exercises[0].sets[0].weight).toBe(185)
    })

    it('skips rows with no weight and no reps', () => {
      const csv = `Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2026-04-01,Morning,Bench Press,1,185,5,,,,,
2026-04-01,Morning,Bench Press,2,0,0,,,,,`

      const result = importCSV(csv)
      expect(result.totalSets).toBe(1)
      expect(result.skippedRows).toBe(1)
    })

    it('handles US date format', () => {
      const csv = `Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
04/01/2026,Morning,Bench Press,1,185,5,,,,,`

      const result = importCSV(csv)
      expect(result.exercises[0].sets[0].date).toContain('2026-04-01')
    })

    it('deduplicates exercises by name (case-insensitive)', () => {
      const csv = `Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2026-04-01,Morning,Bench Press,1,185,5,,,,,
2026-04-01,Morning,bench press,2,185,5,,,,,`

      const result = importCSV(csv)
      expect(result.exercises).toHaveLength(1)
      expect(result.exercises[0].sets).toHaveLength(2)
    })
  })

  describe('Hevy format', () => {
    it('parses basic Hevy CSV and converts kg to lbs', () => {
      const csv = `title,start_time,end_time,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe
Morning,2026-04-01T08:00:00Z,2026-04-01T09:00:00Z,Bench Press,,,,normal,84,5,,,,
Morning,2026-04-01T08:00:00Z,2026-04-01T09:00:00Z,Squat,,,,normal,100,3,,,,`

      const result = importCSV(csv)
      expect(result.format).toBe('hevy')
      expect(result.exercises).toHaveLength(2)
      expect(result.totalSets).toBe(2)

      const bench = result.exercises.find(e => e.name === 'Bench Press')!
      // 84 kg * 2.20462 = 185.2 → rounded to 185.2
      expect(bench.sets[0].weight).toBeCloseTo(185.2, 0)
      expect(bench.sets[0].reps).toBe(5)
    })
  })

  describe('Lift format', () => {
    it('round-trips the labeled "Weight (lbs)" header from current exports (LIFT-1215)', () => {
      const csv = `# Lift Export — 2026-04-05 — v1.0.0 — abc123 — weights in lbs
Exercise,Date,Weight (lbs),Reps,Estimated 1RM,Tags
Bench Press,2026-04-05,225,5,253,chest;push`

      const result = importCSV(csv)
      expect(result.format).toBe('lift')
      expect(result.totalSets).toBe(1)
      expect(result.exercises[0].sets[0].weight).toBe(225)
      expect(result.exercises[0].tags).toEqual(['chest', 'push'])
    })

    it('parses Lift CSV with tags', () => {
      const csv = `# Lift Export — 2026-04-05 — v1.0.0
Exercise,Date,Weight,Reps,Estimated 1RM,Tags
Bench Press,2026-04-01,185,5,216,Push;Chest
Bench Press,2026-04-01,185,5,216,Push;Chest
Squat,2026-04-01,225,3,248,Legs`

      const result = importCSV(csv)
      expect(result.format).toBe('lift')
      expect(result.exercises).toHaveLength(2)

      const bench = result.exercises.find(e => e.name === 'Bench Press')!
      expect(bench.tags).toEqual(['Push', 'Chest'])
      expect(bench.sets).toHaveLength(2)
    })
  })

  describe('unknown format', () => {
    it('returns unknown for unrecognized headers', () => {
      const csv = `foo,bar,baz
1,2,3`

      const result = importCSV(csv)
      expect(result.format).toBe('unknown')
      expect(result.exercises).toHaveLength(0)
    })
  })

  describe('edge cases', () => {
    it('handles empty input', () => {
      const result = importCSV('')
      expect(result.exercises).toHaveLength(0)
      expect(result.format).toBe('unknown')
    })

    it('handles quoted fields with commas', () => {
      const csv = `Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2026-04-01,"My, Workout","Bench Press",1,185,5,,,,,`

      const result = importCSV(csv)
      expect(result.exercises[0].name).toBe('Bench Press')
    })
  })
})
