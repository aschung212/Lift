/**
 * Unit tests for per-set last-write-wins (LIFT-1523).
 *
 * The store-level regression lives in `workoutSetRemoteEdit.test.ts`; these pin
 * the rules themselves — above all the two that are easy to get subtly wrong:
 * "the same set" has to mean the same COLUMN VALUES (the server renders dates
 * and `real` columns differently from how the device wrote them), and a tie
 * goes to the server, the opposite of `mergeEntities`.
 */
import { describe, it, expect } from 'vitest'
import type { Exercise, WorkoutSet } from '../../stores/workout'
import {
  sameSyncedSet,
  pickSetCopy,
  indexSetsById,
  resolveSetConflicts,
  type ServerSetCopy,
} from '../setConflict'

const T0 = '2026-09-28T17:00:01.000Z'
const T1 = '2026-09-29T08:00:00.000Z'
const T2 = '2026-09-29T12:00:00.000Z'

function set(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    id: 's1', date: '2026-09-28T23:59:12.345Z', weight: 100, reps: 5, estimated1RM: 116.67,
    ...overrides,
  }
}

function exercise(id: string, sets: WorkoutSet[]): Exercise {
  return { id, name: id, tags: [], sets }
}

describe('sameSyncedSet', () => {
  it('matches a timestamptz in Postgres rendering against the ISO string the device wrote', () => {
    expect(sameSyncedSet(set(), set({ date: '2026-09-28T23:59:12.345+00:00' }))).toBe(true)
    // Postgres drops trailing fractional zeros.
    expect(sameSyncedSet(set({ date: '2026-09-28T23:59:12.300Z' }), set({ date: '2026-09-28T23:59:12.3+00:00' }))).toBe(true)
  })

  it('matches a real (float4) column against the double the device holds', () => {
    // 100 kg in canonical lbs, and what a `real` column hands back for it.
    const kgInLbs = 220.46226218487757
    expect(sameSyncedSet(set({ weight: kgInLbs }), set({ weight: 220.46227 }))).toBe(true)
    expect(sameSyncedSet(set({ estimated1RM: 257.2059725490238 }), set({ estimated1RM: Math.fround(257.2059725490238) }))).toBe(true)
  })

  it('tells genuinely different values apart', () => {
    expect(sameSyncedSet(set(), set({ weight: 105 }))).toBe(false)
    expect(sameSyncedSet(set(), set({ weight: 100.25 }))).toBe(false)
    expect(sameSyncedSet(set(), set({ reps: 6 }))).toBe(false)
    expect(sameSyncedSet(set(), set({ estimated1RM: 120 }))).toBe(false)
    expect(sameSyncedSet(set(), set({ date: '2026-09-27T23:59:12.345Z' }))).toBe(false)
    expect(sameSyncedSet(set(), set({ attemptedNextRep: true }))).toBe(false)
  })

  it('reads an absent attemptedNextRep as false, the column default', () => {
    expect(sameSyncedSet(set(), set({ attemptedNextRep: false }))).toBe(true)
  })

  it('ignores fields that cannot carry a conflict', () => {
    // createdAt is write-once; rpe / bodyweight have no column at all.
    expect(sameSyncedSet(
      set({ createdAt: T0, rpe: 8, bodyweight: 170, updated_at: T2 }),
      set({ createdAt: '2026-09-28T17:00:01+00:00', updated_at: T0 }),
    )).toBe(true)
  })

  it('falls back to exact comparison for a date that does not parse', () => {
    expect(sameSyncedSet(set({ date: 'garbage' }), set({ date: 'garbage' }))).toBe(true)
    expect(sameSyncedSet(set({ date: 'garbage' }), set({ date: 'rubbish' }))).toBe(false)
  })
})

describe('pickSetCopy', () => {
  it('takes the server copy when the values match, whatever the stamps say', () => {
    // A local stamp AHEAD of the server's — a skewed device clock — must not
    // survive a copy the server already agrees with.
    expect(pickSetCopy(set({ updated_at: T2 }), set({ updated_at: T0 }))).toBe('remote')
  })

  it('takes the strictly newer copy when the values differ', () => {
    expect(pickSetCopy(set({ weight: 110, updated_at: T2 }), set({ weight: 105, updated_at: T1 }))).toBe('local')
    expect(pickSetCopy(set({ weight: 100, updated_at: T0 }), set({ weight: 105, updated_at: T1 }))).toBe('remote')
  })

  it('gives a tie to the server — the opposite of mergeEntities, on purpose', () => {
    expect(pickSetCopy(set({ weight: 100, updated_at: T1 }), set({ weight: 105, updated_at: T1 }))).toBe('remote')
  })

  it('compares stamps as instants, not strings', () => {
    // 09:00+01:00 is 08:00Z: lexically it sorts AFTER 08:30Z, as an instant
    // it is half an hour before it.
    expect(pickSetCopy(
      set({ weight: 100, updated_at: '2026-09-29T09:00:00+01:00' }),
      set({ weight: 105, updated_at: '2026-09-29T08:30:00.000Z' }),
    )).toBe('remote')
  })

  it('a copy with no local stamp — logged here, never edited, or persisted before stamps — defers', () => {
    expect(pickSetCopy(set({ weight: 100 }), set({ weight: 105, updated_at: T0 }))).toBe('remote')
    expect(pickSetCopy(set({ weight: 100, updated_at: 'not a date' }), set({ weight: 105, updated_at: T0 }))).toBe('remote')
  })

  it('a local edit beats a server row whose stamp is missing', () => {
    // Not reachable against the real column (NOT NULL), but the honest reading
    // of "no stamp" is "older than anything", never "now".
    expect(pickSetCopy(set({ weight: 110, updated_at: T2 }), set({ weight: 105 }))).toBe('local')
  })
})

describe('indexSetsById', () => {
  it('indexes every set across exercises', () => {
    const a = set({ id: 'a' })
    const b = set({ id: 'b' })
    const index = indexSetsById([exercise('e1', [a]), exercise('e2', [b])])
    expect([...index.keys()]).toEqual(['a', 'b'])
    expect(index.get('b')).toBe(b)
  })
})

describe('resolveSetConflicts', () => {
  it('puts the winning copy in each slot and returns only the local winners, with the server parent', () => {
    const stale = set({ id: 'stale', weight: 100, updated_at: T0 })
    const edited = set({ id: 'edited', weight: 110, updated_at: T2 })
    const newOnly = set({ id: 'new-only' })
    const ex = exercise('e1', [stale, edited, newOnly])

    const local = indexSetsById([ex])
    const server = new Map<string, ServerSetCopy>([
      ['stale', { set: set({ id: 'stale', weight: 105, updated_at: T1 }), exerciseId: 'e1' }],
      ['edited', { set: set({ id: 'edited', weight: 105, updated_at: T1 }), exerciseId: 'e-server' }],
    ])

    const winners = resolveSetConflicts([ex], local, server)

    expect(ex.sets.map(s => s.weight)).toEqual([105, 110, 100])
    expect(ex.sets[0]).toBe(server.get('stale')!.set)
    expect(ex.sets[1]).toBe(edited)
    // A set only this device holds is not a conflict and is left alone.
    expect(ex.sets[2]).toBe(newOnly)
    expect(winners).toEqual([{ set: edited, exerciseId: 'e-server' }])
  })

  it('resolves a set by id even when the device shows it under a different exercise', () => {
    // A merged duplicate (LIFT-1335): displayed under uuid-a, filed under uuid-b.
    const absorbed = set({ id: 'b-0', weight: 135, updated_at: T0 })
    const ex = exercise('uuid-a', [absorbed])
    const server = new Map<string, ServerSetCopy>([
      ['b-0', { set: set({ id: 'b-0', weight: 140, updated_at: T1 }), exerciseId: 'uuid-b' }],
    ])

    expect(resolveSetConflicts([ex], indexSetsById([ex]), server)).toEqual([])
    expect(ex.sets[0].weight).toBe(140)
  })

  it('reports a winner once even if the same set id sits in two slots', () => {
    const edited = set({ id: 'twice', weight: 110, updated_at: T2 })
    const exercises = [exercise('e1', [edited]), exercise('e2', [edited])]
    const server = new Map<string, ServerSetCopy>([
      ['twice', { set: set({ id: 'twice', weight: 105, updated_at: T1 }), exerciseId: 'e1' }],
    ])

    expect(resolveSetConflicts(exercises, indexSetsById(exercises), server)).toHaveLength(1)
  })

  it('compares against the copy the device held, not the one the merge left in the slot', () => {
    // The union can put the server's copy in a local exercise's array before
    // this runs. The index taken beforehand still knows the local edit.
    const edited = set({ id: 's', weight: 110, updated_at: T2 })
    const local = indexSetsById([exercise('e1', [edited])])
    const serverCopy = set({ id: 's', weight: 105, updated_at: T1 })
    const ex = exercise('e1', [serverCopy])

    const winners = resolveSetConflicts([ex], local, new Map([['s', { set: serverCopy, exerciseId: 'e1' }]]))

    expect(ex.sets[0]).toBe(edited)
    expect(winners).toHaveLength(1)
  })
})
