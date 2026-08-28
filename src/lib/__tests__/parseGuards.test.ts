/**
 * Unit tests for the element-level parse guards (LIFT-946).
 *
 * These validate that corrupt persisted JSON degrades to its valid subset —
 * malformed elements are dropped (and logged), not cast blindly into domain
 * types where they would poison 1RM math, charts, and sync payloads.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  parseStringArray,
  parseNumberRecord,
  parseWorkoutSet,
  parseExercise,
  parseExercises,
  parseBodyweightEntry,
  parseBodyweightEntries,
  sanitizePlateCountMode,
} from '../parseGuards'
import { matchesGymFilter } from '../gyms'

vi.mock('../logger', () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
}))

describe('parseStringArray', () => {
  it('keeps only string elements', () => {
    expect(parseStringArray(['Push', 1, 'Pull', null, { x: 1 }, 'Legs'])).toEqual(['Push', 'Pull', 'Legs'])
  })

  it('returns [] for non-array input', () => {
    expect(parseStringArray('Push')).toEqual([])
    expect(parseStringArray({ 0: 'Push' })).toEqual([])
    expect(parseStringArray(null)).toEqual([])
    expect(parseStringArray(undefined)).toEqual([])
  })
})

describe('parseNumberRecord', () => {
  it('keeps only finite-number values', () => {
    expect(parseNumberRecord({ Push: 3, Pull: '4', Legs: 2, Bad: NaN, Inf: Infinity })).toEqual({
      Push: 3,
      Legs: 2,
    })
  })

  it('returns {} for non-object input', () => {
    expect(parseNumberRecord(['Push'])).toEqual({})
    expect(parseNumberRecord(null)).toEqual({})
    expect(parseNumberRecord(42)).toEqual({})
  })
})

describe('parseWorkoutSet', () => {
  it('accepts a well-formed set and preserves createdAt', () => {
    const set = parseWorkoutSet({
      id: 's-1',
      date: '2026-05-01T23:59:59.000Z',
      weight: 185,
      reps: 5,
      estimated1RM: 216,
      createdAt: '2026-05-01T12:00:00.000Z',
    })
    expect(set).toEqual({
      id: 's-1',
      date: '2026-05-01T23:59:59.000Z',
      weight: 185,
      reps: 5,
      estimated1RM: 216,
      createdAt: '2026-05-01T12:00:00.000Z',
    })
  })

  it('repairs a missing estimated1RM from weight/reps via Epley', () => {
    const set = parseWorkoutSet({ id: 's-1', date: '2026-05-01', weight: 100, reps: 10 })
    // epley(100, 10) = round(100 * (1 + 10/30)) = 133
    expect(set?.estimated1RM).toBe(133)
  })

  it('repairs a non-numeric estimated1RM', () => {
    const set = parseWorkoutSet({ id: 's-1', date: '2026-05-01', weight: 100, reps: 1, estimated1RM: 'oops' })
    expect(set?.estimated1RM).toBe(100)
  })

  it('rejects a set missing weight or reps', () => {
    expect(parseWorkoutSet({ id: 's-1', date: '2026-05-01', reps: 5 })).toBeNull()
    expect(parseWorkoutSet({ id: 's-1', date: '2026-05-01', weight: 100 })).toBeNull()
    expect(parseWorkoutSet({ id: 's-1', date: '2026-05-01', weight: '100', reps: 5 })).toBeNull()
  })

  it('rejects a set missing id or date', () => {
    expect(parseWorkoutSet({ date: '2026-05-01', weight: 100, reps: 5 })).toBeNull()
    expect(parseWorkoutSet({ id: 's-1', weight: 100, reps: 5 })).toBeNull()
  })

  it('rejects non-object input', () => {
    expect(parseWorkoutSet(null)).toBeNull()
    expect(parseWorkoutSet('set')).toBeNull()
    expect(parseWorkoutSet([])).toBeNull()
  })
})

describe('parseExercise', () => {
  it('accepts a well-formed exercise and normalizes optional config', () => {
    const ex = parseExercise({
      id: 'ex-1',
      name: 'Bench Press',
      tags: ['Push', 2, 'Chest'],
      sets: [{ id: 's-1', date: '2026-05-01', weight: 185, reps: 5, estimated1RM: 216 }],
      inputMode: 'plates',
      barWeight: 45,
      plateCountMode: 'per-side',
      intensityMaxReps: 12,
      updated_at: '2026-05-01T00:00:00.000Z',
    })
    expect(ex).not.toBeNull()
    expect(ex!.name).toBe('Bench Press')
    expect(ex!.tags).toEqual(['Push', 'Chest'])
    expect(ex!.sets).toHaveLength(1)
    expect(ex!.inputMode).toBe('plates')
    expect(ex!.barWeight).toBe(45)
    expect(ex!.plateCountMode).toBe('per-side')
    expect(ex!.intensityMaxReps).toBe(12)
    expect(ex!.updated_at).toBe('2026-05-01T00:00:00.000Z')
  })

  it('drops malformed sets but keeps the exercise', () => {
    const ex = parseExercise({
      id: 'ex-1',
      name: 'Squat',
      tags: [],
      sets: [
        { id: 's-1', date: '2026-05-01', weight: 225, reps: 5, estimated1RM: 253 },
        { id: 's-2', date: '2026-05-01', reps: 5 }, // missing weight → dropped
        'not-a-set', // dropped
      ],
    })
    expect(ex!.sets).toHaveLength(1)
    expect(ex!.sets[0].id).toBe('s-1')
  })

  it('sanitizes an out-of-range intensityMaxReps instead of trusting it', () => {
    const ex = parseExercise({ id: 'ex-1', name: 'Row', tags: [], sets: [], intensityMaxReps: 9999 })
    // sanitizeIntensityMaxReps clamps to MAX (100)
    expect(ex!.intensityMaxReps).toBe(100)
  })

  it('drops an unrecognized equipment value', () => {
    const ex = parseExercise({ id: 'ex-1', name: 'Row', tags: [], sets: [], equipment: 'laser-beam' })
    expect(ex!.equipment).toBeUndefined()
  })

  it('drops an unrecognized plateCountMode value (LIFT-1039)', () => {
    const ex = parseExercise({ id: 'ex-1', name: 'Row', tags: [], sets: [], plateCountMode: 'sideways' })
    expect(ex!.plateCountMode).toBeUndefined()
  })

  it('keeps a valid plateCountMode value', () => {
    const ex = parseExercise({ id: 'ex-1', name: 'Row', tags: [], sets: [], plateCountMode: 'total' })
    expect(ex!.plateCountMode).toBe('total')
  })

  // parseExercise builds a fresh object from an allowlist of known fields, so any
  // field it forgets is silently dropped on every hydration. `gyms` (#961) landed
  // on master while this guard was in review and was nearly lost in the merge —
  // these pin the round-trip so a future Exercise field can't vanish the same way.
  it('preserves and sanitizes gym membership', () => {
    const ex = parseExercise({ id: 'ex-1', name: 'Row', tags: [], sets: [], gyms: ['Home', 'Home', '  Gold\'s  ', 42] })
    expect(ex!.gyms).toEqual(['Home', "Gold's"])
  })

  it('leaves gyms unset when membership sanitizes to empty, so the exercise still shows under every gym filter', () => {
    const ex = parseExercise({ id: 'ex-1', name: 'Row', tags: [], sets: [], gyms: [42, null] })
    expect(ex!.gyms).toBeUndefined()
    expect(matchesGymFilter(ex!.gyms, 'Home', ['Home'])).toBe(true)
  })

  // notes (#619) — same allowlist-drop hazard as gyms above.
  it('preserves and sanitizes a durable note', () => {
    const ex = parseExercise({ id: 'ex-1', name: 'Row', tags: [], sets: [], notes: '  brace hard  ' })
    expect(ex!.notes).toBe('brace hard')
  })

  it('leaves notes unset when the note is empty or non-string', () => {
    expect(parseExercise({ id: 'ex-1', name: 'Row', tags: [], sets: [], notes: '   ' })!.notes).toBeUndefined()
    expect(parseExercise({ id: 'ex-1', name: 'Row', tags: [], sets: [], notes: 42 })!.notes).toBeUndefined()
  })

  it('defaults tags/sets to empty when absent or wrong-typed', () => {
    const ex = parseExercise({ id: 'ex-1', name: 'Row', tags: 'Push', sets: { bad: true } })
    expect(ex!.tags).toEqual([])
    expect(ex!.sets).toEqual([])
  })

  it('rejects an exercise missing id or name', () => {
    expect(parseExercise({ name: 'Row', tags: [], sets: [] })).toBeNull()
    expect(parseExercise({ id: 'ex-1', tags: [], sets: [] })).toBeNull()
  })
})

describe('sanitizePlateCountMode', () => {
  it('accepts the two valid modes', () => {
    expect(sanitizePlateCountMode('per-side')).toBe('per-side')
    expect(sanitizePlateCountMode('total')).toBe('total')
  })

  it('returns undefined for anything else', () => {
    for (const bad of ['', 'PER-SIDE', 'both', 0, null, undefined, {}, ['total']]) {
      expect(sanitizePlateCountMode(bad)).toBeUndefined()
    }
  })
})

describe('parseExercises', () => {
  it('drops malformed exercises and keeps valid ones', () => {
    const result = parseExercises([
      { id: 'ex-1', name: 'Bench', tags: [], sets: [] },
      { id: 'ex-2' }, // missing name → dropped
      null, // dropped
      { id: 'ex-3', name: 'Squat', tags: [], sets: [] },
    ])
    expect(result.map(e => e.id)).toEqual(['ex-1', 'ex-3'])
  })

  it('returns [] for non-array input', () => {
    expect(parseExercises('nope')).toEqual([])
    expect(parseExercises(null)).toEqual([])
  })
})

describe('parseBodyweightEntry', () => {
  it('accepts a well-formed entry and preserves updated_at/sample', () => {
    const entry = parseBodyweightEntry({
      id: 'bw-1',
      date: '2026-05-01T23:59:59.000Z',
      weight: 185,
      updated_at: '2026-05-01T00:00:00.000Z',
      sample: true,
    })
    expect(entry).toEqual({
      id: 'bw-1',
      date: '2026-05-01T23:59:59.000Z',
      weight: 185,
      updated_at: '2026-05-01T00:00:00.000Z',
      sample: true,
    })
  })

  it('rejects an entry with a non-numeric weight', () => {
    expect(parseBodyweightEntry({ id: 'bw-1', date: '2026-05-01', weight: '185' })).toBeNull()
    expect(parseBodyweightEntry({ id: 'bw-1', date: '2026-05-01', weight: NaN })).toBeNull()
  })

  it('rejects an entry missing id or date', () => {
    expect(parseBodyweightEntry({ date: '2026-05-01', weight: 185 })).toBeNull()
    expect(parseBodyweightEntry({ id: 'bw-1', weight: 185 })).toBeNull()
  })
})

describe('parseBodyweightEntries', () => {
  it('drops malformed entries and keeps valid ones', () => {
    const result = parseBodyweightEntries([
      { id: 'bw-1', date: '2026-05-01', weight: 185 },
      { id: 'bw-2', date: '2026-05-02', weight: 'heavy' }, // dropped
      { id: 'bw-3', date: '2026-05-03', weight: 184 },
    ])
    expect(result.map(e => e.id)).toEqual(['bw-1', 'bw-3'])
  })

  it('returns [] for non-array input', () => {
    expect(parseBodyweightEntries({ id: 'bw-1' })).toEqual([])
  })
})
