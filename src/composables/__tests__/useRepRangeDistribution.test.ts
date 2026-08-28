import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useRepRangeDistribution, classifyRepZone } from '../useRepRangeDistribution'
import type { Exercise } from '../../stores/workout'

function makeExercise(
  name: string,
  sets: { date: string; weight: number; reps: number }[],
): Exercise {
  return {
    id: name.toLowerCase().replace(/\s/g, '-'),
    name,
    tags: [],
    sets: sets.map((s, i) => ({
      id: `${name}-set-${i}`,
      date: s.date,
      weight: s.weight,
      reps: s.reps,
      estimated1RM: s.weight * (1 + s.reps / 30),
    })),
  }
}

describe('classifyRepZone', () => {
  it('classifies the strength band (1–5)', () => {
    expect(classifyRepZone(1)).toBe('strength')
    expect(classifyRepZone(5)).toBe('strength')
  })

  it('classifies the hypertrophy band (6–12)', () => {
    expect(classifyRepZone(6)).toBe('hypertrophy')
    expect(classifyRepZone(12)).toBe('hypertrophy')
  })

  it('classifies the endurance band (13+)', () => {
    expect(classifyRepZone(13)).toBe('endurance')
    expect(classifyRepZone(30)).toBe('endurance')
  })

  it('ignores reps below 1 and non-finite values', () => {
    expect(classifyRepZone(0)).toBeNull()
    expect(classifyRepZone(-2)).toBeNull()
    expect(classifyRepZone(NaN)).toBeNull()
  })
})

describe('useRepRangeDistribution', () => {
  it('returns three zeroed zones when there are no sets', () => {
    const exercises = ref<Exercise[]>([makeExercise('Bench', [])])
    const { zones, totalSets, dominant } = useRepRangeDistribution(exercises)
    expect(zones.value.map(z => z.id)).toEqual(['strength', 'hypertrophy', 'endurance'])
    expect(zones.value.every(z => z.sets === 0)).toBe(true)
    expect(totalSets.value).toBe(0)
    expect(dominant.value).toBeNull()
  })

  it('buckets sets into the correct zones', () => {
    const exercises = ref([
      makeExercise('Squat', [
        { date: '2026-03-23T10:00:00', weight: 225, reps: 3 },  // strength
        { date: '2026-03-23T10:05:00', weight: 185, reps: 8 },  // hypertrophy
        { date: '2026-03-23T10:10:00', weight: 185, reps: 10 }, // hypertrophy
        { date: '2026-03-23T10:15:00', weight: 95, reps: 20 },  // endurance
      ]),
    ])
    const { zones, totalSets } = useRepRangeDistribution(exercises)
    const byId = Object.fromEntries(zones.value.map(z => [z.id, z.sets]))
    expect(byId).toEqual({ strength: 1, hypertrophy: 2, endurance: 1 })
    expect(totalSets.value).toBe(4)
  })

  it('aggregates across multiple exercises', () => {
    const exercises = ref([
      makeExercise('Bench', [{ date: '2026-03-23T10:00:00', weight: 135, reps: 5 }]),
      makeExercise('Curl', [{ date: '2026-03-24T10:00:00', weight: 30, reps: 10 }]),
    ])
    const { totalSets, dominant } = useRepRangeDistribution(exercises)
    expect(totalSets.value).toBe(2)
    // Tie broken toward the first/earlier zone in iteration (strength).
    expect(dominant.value?.id).toBe('strength')
  })

  it('reports the dominant zone', () => {
    const exercises = ref([
      makeExercise('Press', [
        { date: '2026-03-23T10:00:00', weight: 100, reps: 8 },
        { date: '2026-03-23T10:05:00', weight: 100, reps: 9 },
        { date: '2026-03-23T10:10:00', weight: 100, reps: 3 },
      ]),
    ])
    const { dominant } = useRepRangeDistribution(exercises)
    expect(dominant.value?.id).toBe('hypertrophy')
    expect(dominant.value?.label).toBe('Hypertrophy')
  })

  it('reacts to exercise changes', () => {
    const exercises = ref<Exercise[]>([])
    const { totalSets } = useRepRangeDistribution(exercises)
    expect(totalSets.value).toBe(0)

    exercises.value = [
      makeExercise('Row', [{ date: '2026-03-23T10:00:00', weight: 100, reps: 12 }]),
    ]
    expect(totalSets.value).toBe(1)
  })
})
