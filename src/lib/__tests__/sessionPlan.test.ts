import { describe, it, expect } from 'vitest'
import { buildSessionPlan } from '../sessionPlan'
import type { Exercise, WorkoutSet } from '../../stores/workout'

/**
 * Guided session plan (#1256) — pure derivation tests.
 *
 * All dates are explicit and `todayKey` is passed in, so nothing here reads
 * the clock. Real-time-convention fixtures use local-noon timestamps
 * (`T12:00:00`, no Z) so the derived local day matches the prefix in every
 * timezone; end-of-day-convention fixtures (`T23:59:59Z`) exercise the
 * `setDayKey` slice path (#746).
 */

const TODAY = '2026-08-28'

let setSeq = 0
function makeSet(date: string, weight = 100, reps = 5): WorkoutSet {
  return { id: `s-${++setSeq}`, date, weight, reps, estimated1RM: weight * (1 + reps / 30) }
}

function makeExercise(id: string, name: string, sets: WorkoutSet[]): Exercise {
  return { id, name, tags: [], sets }
}

describe('buildSessionPlan', () => {
  it('returns null when the scope is empty or has no sets', () => {
    expect(buildSessionPlan([], TODAY)).toBeNull()
    expect(buildSessionPlan([makeExercise('a', 'Bench', [])], TODAY)).toBeNull()
  })

  it('returns null when the only training day is today (nothing to repeat)', () => {
    const ex = makeExercise('a', 'Bench', [makeSet('2026-08-28T12:00:00')])
    expect(buildSessionPlan([ex], TODAY)).toBeNull()
  })

  it('picks the most recent prior day and includes only exercises trained that day', () => {
    const bench = makeExercise('a', 'Bench', [
      makeSet('2026-08-20T12:00:00', 135, 10),
      makeSet('2026-08-25T12:00:00', 135, 10),
      makeSet('2026-08-25T12:00:00', 185, 5),
    ])
    const ohp = makeExercise('b', 'OHP', [makeSet('2026-08-25T12:00:00', 95, 8)])
    const squat = makeExercise('c', 'Squat', [makeSet('2026-08-20T12:00:00', 225, 5)])
    const fresh = makeExercise('d', 'Curl', [])

    const plan = buildSessionPlan([bench, ohp, squat, fresh], TODAY)!
    expect(plan.day).toBe('2026-08-25')
    expect(plan.items.map(i => i.exerciseId)).toEqual(['a', 'b'])
    expect(plan.plannedTotal).toBe(3)
    expect(plan.doneTotal).toBe(0)
  })

  it('reports per-exercise planned counts and the heaviest set as topSet', () => {
    const bench = makeExercise('a', 'Bench', [
      makeSet('2026-08-25T12:00:00', 135, 10),
      makeSet('2026-08-25T12:00:00', 185, 5),
      makeSet('2026-08-25T12:00:00', 155, 8),
    ])
    const plan = buildSessionPlan([bench], TODAY)!
    expect(plan.items[0].plannedSets).toBe(3)
    expect(plan.items[0].topSet).toEqual({ weightLbs: 185, reps: 5 })
  })

  it("counts today's sets as progress, capping the total per item at planned", () => {
    const bench = makeExercise('a', 'Bench', [
      makeSet('2026-08-25T12:00:00', 135, 10),
      makeSet('2026-08-25T12:00:00', 185, 5),
      // 3 sets today against 2 planned — item reports raw, total caps at 2.
      makeSet('2026-08-28T12:00:00', 135, 10),
      makeSet('2026-08-28T12:00:00', 185, 5),
      makeSet('2026-08-28T12:00:00', 185, 4),
    ])
    const ohp = makeExercise('b', 'OHP', [
      makeSet('2026-08-25T12:00:00', 95, 8),
      makeSet('2026-08-28T12:00:00', 95, 8),
    ])
    const plan = buildSessionPlan([bench, ohp], TODAY)!
    expect(plan.items[0].doneSets).toBe(3)
    expect(plan.items[1].doneSets).toBe(1)
    expect(plan.plannedTotal).toBe(3)
    expect(plan.doneTotal).toBe(3) // min(3,2) + min(1,1)
  })

  it('buckets end-of-day UI-logged dates via setDayKey (#746) in every timezone', () => {
    // A UI-logged set is stamped `…T23:59:ssZ` where the PREFIX is the chosen
    // local day; toLocalDateKey would shift it +1 east of UTC and a raw
    // toLocalDateKey of a real-time evening instant rolls back west of UTC.
    const bench = makeExercise('a', 'Bench', [
      { id: 'eod', date: '2026-08-25T23:59:42Z', weight: 185, reps: 5, estimated1RM: 216 },
    ])
    const plan = buildSessionPlan([bench], TODAY)!
    expect(plan.day).toBe('2026-08-25')
  })

  it('preserves the input list order for plan items', () => {
    const day = '2026-08-25T12:00:00'
    const list = [
      makeExercise('c', 'Squat', [makeSet(day)]),
      makeExercise('a', 'Bench', [makeSet(day)]),
      makeExercise('b', 'OHP', [makeSet(day)]),
    ]
    const plan = buildSessionPlan(list, TODAY)!
    expect(plan.items.map(i => i.name)).toEqual(['Squat', 'Bench', 'OHP'])
  })

  it('treats todayKey as a strict bound — a future-dated stray set never becomes the plan', () => {
    const bench = makeExercise('a', 'Bench', [
      makeSet('2026-08-25T12:00:00', 185, 5),
      makeSet('2026-09-01T12:00:00', 185, 5), // clock skew / manual redating
    ])
    const plan = buildSessionPlan([bench], TODAY)!
    expect(plan.day).toBe('2026-08-25')
  })
})
