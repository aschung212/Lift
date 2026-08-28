import { describe, it, expect } from 'vitest'
import { searchExerciseDatabase, EXERCISE_DB_COUNT } from '../exerciseDatabase'

describe('exerciseDatabase', () => {
  describe('searchExerciseDatabase', () => {
    it('returns empty array for empty query', () => {
      expect(searchExerciseDatabase('', [])).toEqual([])
      expect(searchExerciseDatabase('   ', [])).toEqual([])
    })

    it('matches exercises by substring (case-insensitive)', () => {
      const results = searchExerciseDatabase('bench', [])
      expect(results.length).toBeGreaterThan(0)
      expect(results.every(r => r.name.toLowerCase().includes('bench'))).toBe(true)
    })

    it('prioritizes prefix matches over substring matches', () => {
      const results = searchExerciseDatabase('bench', [])
      // "Bench Press" should come before "Incline Bench Press"
      const benchIdx = results.findIndex(r => r.name === 'Bench Press')
      const inclineIdx = results.findIndex(r => r.name === 'Incline Bench Press')
      expect(benchIdx).toBeLessThan(inclineIdx)
    })

    it('excludes exercises the user already has', () => {
      const results = searchExerciseDatabase('bench', ['Bench Press'])
      expect(results.find(r => r.name === 'Bench Press')).toBeUndefined()
    })

    it('excludes existing exercises case-insensitively', () => {
      const results = searchExerciseDatabase('bench', ['bench press'])
      expect(results.find(r => r.name === 'Bench Press')).toBeUndefined()
    })

    it('respects the limit parameter', () => {
      const results = searchExerciseDatabase('curl', [], 2)
      expect(results.length).toBeLessThanOrEqual(2)
    })

    it('returns entries with tags and optional inputMode', () => {
      const results = searchExerciseDatabase('squat', [])
      const squat = results.find(r => r.name === 'Squat')
      expect(squat).toBeDefined()
      expect(squat!.tags).toContain('Legs')
      expect(squat!.inputMode).toBe('plates')
      expect(squat!.barWeight).toBe(45)
    })

    it('returns entries without inputMode for non-plate exercises', () => {
      const results = searchExerciseDatabase('pull-up', [])
      const pullups = results.find(r => r.name === 'Pull-ups')
      expect(pullups).toBeDefined()
      expect(pullups!.inputMode).toBeUndefined()
    })
  })

  describe('EXERCISE_DB_COUNT', () => {
    it('has a reasonable number of exercises (80-120)', () => {
      expect(EXERCISE_DB_COUNT).toBeGreaterThanOrEqual(80)
      expect(EXERCISE_DB_COUNT).toBeLessThanOrEqual(120)
    })
  })
})
