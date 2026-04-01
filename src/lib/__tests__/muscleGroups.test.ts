import { describe, it, expect } from 'vitest'
import { getMuscleGroups, MUSCLE_GROUPS } from '../muscleGroups'

describe('muscleGroups', () => {
  describe('getMuscleGroups', () => {
    it('maps direct muscle group tags', () => {
      expect(getMuscleGroups(['Chest'])).toEqual(['Chest'])
      expect(getMuscleGroups(['Back'])).toEqual(['Back'])
      expect(getMuscleGroups(['Shoulders'])).toEqual(['Shoulders'])
      expect(getMuscleGroups(['Legs'])).toEqual(['Legs'])
      expect(getMuscleGroups(['Core'])).toEqual(['Core'])
    })

    it('maps case-insensitively', () => {
      expect(getMuscleGroups(['CHEST'])).toEqual(['Chest'])
      expect(getMuscleGroups(['back'])).toEqual(['Back'])
      expect(getMuscleGroups(['Legs'])).toEqual(['Legs'])
    })

    it('maps movement pattern tags to multiple groups', () => {
      const push = getMuscleGroups(['Push'])
      expect(push).toContain('Chest')
      expect(push).toContain('Shoulders')
      expect(push).toContain('Triceps')

      const pull = getMuscleGroups(['Pull'])
      expect(pull).toContain('Back')
      expect(pull).toContain('Biceps')
    })

    it('deduplicates groups from multiple tags', () => {
      // Push includes Chest, plus explicit Chest tag — should not duplicate
      const groups = getMuscleGroups(['Push', 'Chest'])
      const chestCount = groups.filter(g => g === 'Chest').length
      expect(chestCount).toBe(1)
    })

    it('maps leg-specific tags to Legs', () => {
      expect(getMuscleGroups(['Quads'])).toEqual(['Legs'])
      expect(getMuscleGroups(['Hamstrings'])).toEqual(['Legs'])
      expect(getMuscleGroups(['Glutes'])).toEqual(['Legs'])
      expect(getMuscleGroups(['Calves'])).toEqual(['Legs'])
    })

    it('maps Arms tag to Biceps and Triceps', () => {
      const groups = getMuscleGroups(['Arms'])
      expect(groups).toContain('Biceps')
      expect(groups).toContain('Triceps')
    })

    it('maps Abs tag to Core', () => {
      expect(getMuscleGroups(['Abs'])).toEqual(['Core'])
    })

    it('ignores unrecognized tags', () => {
      expect(getMuscleGroups(['Custom Tag', 'My Exercise'])).toEqual([])
    })

    it('returns empty array for no tags', () => {
      expect(getMuscleGroups([])).toEqual([])
    })

    it('handles mixed recognized and unrecognized tags', () => {
      const groups = getMuscleGroups(['PPL', 'Chest', 'Custom'])
      expect(groups).toEqual(['Chest'])
    })
  })

  describe('MUSCLE_GROUPS constant', () => {
    it('has 7 muscle groups', () => {
      expect(MUSCLE_GROUPS).toHaveLength(7)
    })

    it('includes expected groups', () => {
      expect(MUSCLE_GROUPS).toContain('Chest')
      expect(MUSCLE_GROUPS).toContain('Back')
      expect(MUSCLE_GROUPS).toContain('Legs')
      expect(MUSCLE_GROUPS).toContain('Core')
    })
  })
})
