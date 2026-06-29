import { describe, it, expect } from 'vitest'
import { buildCoachPayload, type ExerciseOverload } from '../coachDigest'
import { validateCoachPayload, MAX_SETS } from '../aiCoach'
import type { Exercise } from '../../stores/workout'
import type { BodyweightEntry } from '../../stores/bodyweight'

// 2026-06-27 is a Saturday (week = Mon 06-22 .. Sat 06-27). Noon-UTC set stamps
// bucket to the same calendar day in every common timezone, keeping tests stable.
const NOW = new Date('2026-06-27T12:00:00')

function ex(id: string, name: string, tags: string[], sets: Exercise['sets']): Exercise {
  return { id, name, tags, sets }
}

function baseExercises(): Exercise[] {
  return [
    ex('e1', 'Bench Press', ['Chest', 'Push'], [
      { id: 'b1', date: '2026-01-05T12:00:00.000Z', weight: 185, reps: 5, estimated1RM: 216 }, // out of window
      { id: 'b0', date: '2026-06-20T12:00:00.000Z', weight: 215, reps: 5, estimated1RM: 251 }, // in-window early PR (not current week)
      { id: 'b2', date: '2026-06-23T12:00:00.000Z', weight: 225, reps: 5, estimated1RM: 263 }, // all-time PR
      { id: 'b3', date: '2026-06-27T12:00:00.000Z', weight: 205, reps: 8, estimated1RM: 260 },
    ]),
    ex('e2', 'Squat', ['Legs'], [
      { id: 'q1', date: '2026-06-27T12:00:00.000Z', weight: 315, reps: 3, estimated1RM: 347 },
    ]),
  ]
}

const overloads: ExerciseOverload[] = [
  { exerciseName: 'Bench Press', suggestion: { type: 'increase_weight', weight: 230, reps: 5, reason: 'consistent top sets', confidence: 'high' } },
  { exerciseName: 'Squat', suggestion: { type: 'increase_reps', weight: 315, reps: 4, reason: 'rep progression', confidence: 'low' } },
  { exerciseName: 'Deadlift', suggestion: null },
]

const bodyweight: BodyweightEntry[] = [
  { id: 'w1', date: '2026-06-01T12:00:00.000Z', weight: 200 },
  { id: 'w2', date: '2026-06-23T12:00:00.000Z', weight: 196 },
]

function build(overrides: Partial<Parameters<typeof buildCoachPayload>[0]> = {}) {
  return buildCoachPayload({
    exercises: baseExercises(),
    bodyweightEntries: bodyweight,
    overloads,
    weightUnit: 'lbs',
    weeklyTarget: 4,
    streakWeeks: 5,
    now: NOW,
    ...overrides,
  })
}

describe('buildCoachPayload — sets', () => {
  it('windows out old sets but keeps them for lifetime PRs', () => {
    const p = build()
    expect(p.sets.every((s) => s.date !== '2026-01-05')).toBe(true)
    expect(p.sets).toHaveLength(4) // b0, b2, b3, q1 — b1 is out of window
  })

  it('computes per-set intensity against the best e1RM AT THE TIME, not the lifetime best', () => {
    const p = build()
    // Early PR set: 215 / 251 (its own at-the-time best) = 86. Against the lifetime
    // best (263) it would read 82 — that regression is exactly what this guards.
    const earlyBench = p.sets.find((s) => s.weight === 215)
    expect(earlyBench?.intensityPct).toBe(86)
    const topBench = p.sets.find((s) => s.exerciseName === 'Bench Press' && s.weight === 225)
    expect(topBench?.intensityPct).toBe(86) // 225 / 263
    const repBench = p.sets.find((s) => s.exerciseName === 'Bench Press' && s.weight === 205)
    expect(repBench?.intensityPct).toBe(78) // 205 / 263 (263 is the best as of this set)
  })

  it('flags sets that were a PR at the time they were performed', () => {
    const p = build()
    const earlyPr = p.sets.find((s) => s.weight === 215) // PR when performed, later beaten
    const pr = p.sets.find((s) => s.exerciseName === 'Bench Press' && s.weight === 225)
    const notPr = p.sets.find((s) => s.exerciseName === 'Bench Press' && s.weight === 205)
    expect(earlyPr?.isPR).toBe(true)
    expect(pr?.isPR).toBe(true)
    expect(notPr?.isPR).toBeUndefined()
  })

  it('caps the set log at MAX_SETS, keeping the most recent', () => {
    const many = Array.from({ length: MAX_SETS + 25 }, (_, i) => ({
      id: `s${i}`,
      date: '2026-06-27T12:00:00.000Z',
      weight: 100,
      reps: 5,
      estimated1RM: 116,
    }))
    const p = build({ exercises: [ex('big', 'Rows', ['Back'], many)] })
    expect(p.sets).toHaveLength(MAX_SETS)
  })
})

describe('buildCoachPayload — personalRecords', () => {
  it('reports lifetime bests, highest e1RM first', () => {
    const p = build()
    expect(p.personalRecords[0]).toMatchObject({ exerciseName: 'Squat', bestE1rm: 347, bestReps: 3 })
    const bench = p.personalRecords.find((r) => r.exerciseName === 'Bench Press')
    expect(bench).toMatchObject({ bestE1rm: 263, bestWeight: 225, bestReps: 5, date: '2026-06-23' })
  })
})

describe('buildCoachPayload — volume & consistency', () => {
  it('counts current-week sets per tag', () => {
    const p = build()
    const chest = p.volume.find((v) => v.tagName === 'Chest')
    const legs = p.volume.find((v) => v.tagName === 'Legs')
    expect(chest?.weeklyVolume).toBe(2) // b2 + b3 this week
    expect(legs?.weeklyVolume).toBe(1) // q1
  })

  it('builds the consistency block from the weekly goal + streak', () => {
    const p = build()
    expect(p.consistency).toEqual({
      workoutDaysThisWeek: 2, // trained Tue + Sat
      weeklyTarget: 4,
      streakWeeks: 5,
      goalMet: false,
    })
  })

  it('omits consistency when there is no weekly target', () => {
    expect(build({ weeklyTarget: 0 }).consistency).toBeNull()
  })
})

describe('buildCoachPayload — focus & bodyweight', () => {
  it('keeps only high-confidence overload suggestions', () => {
    const p = build()
    expect(p.focus).toHaveLength(1)
    expect(p.focus[0]).toMatchObject({ exerciseName: 'Bench Press', type: 'increase_weight', suggestedWeight: 230 })
  })

  it('computes bodyweight trend and delta over the window', () => {
    const p = build()
    expect(p.bodyweight).toEqual({ trendDirection: 'down', deltaLbs: -4 })
  })
})

describe('buildCoachPayload — sessions (cadence + split)', () => {
  it('summarizes each training day with its tags and set count, oldest first', () => {
    const p = build()
    expect(p.sessions.map((s) => s.date)).toEqual(['2026-06-20', '2026-06-23', '2026-06-27'])
    const last = p.sessions.find((s) => s.date === '2026-06-27')
    expect(last?.setCount).toBe(2) // bench + squat on the same day
    expect(last?.tags.slice().sort()).toEqual(['Chest', 'Legs', 'Push'])
  })
})

describe('buildCoachPayload — time of day (forward-ready)', () => {
  it('omits timeOfDay when no real timestamp is captured', () => {
    const p = build()
    expect(p.sets.every((s) => s.timeOfDay === undefined)).toBe(true)
  })

  it('emits HH:MM and orders within a day by real timestamp when createdAt is present', () => {
    const sets = [
      { id: 'm2', date: '2026-06-25T12:00:00.000Z', weight: 100, reps: 5, estimated1RM: 116, createdAt: '2026-06-25T17:30:00Z' },
      { id: 'm1', date: '2026-06-25T12:00:00.000Z', weight: 95, reps: 5, estimated1RM: 110, createdAt: '2026-06-25T17:00:00Z' },
    ]
    const p = build({ exercises: [ex('e1', 'Bench Press', ['Chest'], sets)] })
    const bench = p.sets.filter((s) => s.exerciseName === 'Bench Press')
    // ordered by createdAt asc despite reversed input order: m1 (95, 17:00) before m2 (100, 17:30)
    expect(bench.map((s) => s.weight)).toEqual([95, 100])
    expect(bench[0].timeOfDay).toMatch(/^\d{2}:\d{2}$/)
    expect(bench[1].timeOfDay).toMatch(/^\d{2}:\d{2}$/)
    expect(bench[0].timeOfDay).not.toBe(bench[1].timeOfDay)
  })

  it('orders untimestamped (legacy) sets after timestamped ones within the same day', () => {
    // A day that mixes a pre-#846 set (no createdAt) with a freshly timestamped
    // one: the timestamped set must not land behind the unknown-time set just
    // because '' sorts before any real ISO string.
    const sets = [
      { id: 'u1', date: '2026-06-25T12:00:00.000Z', weight: 200, reps: 5, estimated1RM: 233 }, // legacy: no createdAt
      { id: 't1', date: '2026-06-25T12:00:00.000Z', weight: 100, reps: 5, estimated1RM: 116, createdAt: '2026-06-25T08:00:00Z' },
    ]
    const p = build({ exercises: [ex('e1', 'Bench Press', ['Chest'], sets)] })
    const bench = p.sets.filter((s) => s.exerciseName === 'Bench Press')
    expect(bench.map((s) => s.weight)).toEqual([100, 200]) // timestamped first, legacy last
    expect(bench[0].timeOfDay).toMatch(/^\d{2}:\d{2}$/)
    expect(bench[1].timeOfDay).toBeUndefined()
  })
})

describe('buildCoachPayload — unit conversion', () => {
  it('converts stored pounds to the display unit, leaving ratios intact', () => {
    const p = build({ weightUnit: 'kg', toDisplayUnits: (lb) => lb * 0.453592 })
    expect(p.unit).toBe('kg')
    const topBench = p.sets.find((s) => s.date === '2026-06-23') // the 225 lb PR set
    expect(topBench?.weight).toBe(102.1) // 225 lb -> kg
    expect(topBench?.intensityPct).toBe(86) // ratio unchanged
    expect(p.bodyweight?.deltaLbs).toBe(-1.8) // -4 lb -> kg
  })
})

// A realistic payload needs >= MIN_SETS_FOR_REVIEW (8) sets to pass the spend gate.
function richExercises(): Exercise[] {
  const sets = Array.from({ length: 10 }, (_, i) => ({
    id: `setid-${i}`,
    date: `2026-06-${String(18 + (i % 9)).padStart(2, '0')}T12:00:00.000Z`, // all in-window, <= now
    weight: 135 + i,
    reps: 5,
    estimated1RM: 160 + i,
  }))
  return [ex('exid-bench', 'Bench Press', ['Chest'], sets)]
}

describe('buildCoachPayload — contract & minimization', () => {
  it('produces a payload that passes server-side validation', () => {
    const p = build({ exercises: richExercises() })
    expect(p.sets.length).toBeGreaterThanOrEqual(8)
    expect(validateCoachPayload(p).ok).toBe(true)
  })

  it('emits no identifiers (no ids, no user/email keys)', () => {
    const json = JSON.stringify(build({ exercises: richExercises() }))
    expect(json).not.toContain('"id"')
    expect(json).not.toContain('exid-bench') // exercise id
    expect(json).not.toContain('setid-') // set ids
    expect(json.toLowerCase()).not.toContain('email')
  })
})
