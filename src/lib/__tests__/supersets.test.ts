import { describe, it, expect } from 'vitest'
import type { Exercise } from '../../stores/workout'
import {
  sanitizeSupersetId,
  inSuperset,
  groupBySuperset,
  orderWithSupersets,
  annotateSupersetRows,
  nextSupersetExerciseId,
  planSupersetChange,
  MAX_SUPERSET_ID_LENGTH,
} from '../supersets'

function ex(id: string, supersetId?: string): Exercise {
  return { id, name: id, tags: [], sets: [], ...(supersetId ? { supersetId } : {}) }
}

describe('sanitizeSupersetId', () => {
  it('accepts a non-empty trimmed string', () => {
    expect(sanitizeSupersetId('  abc  ')).toBe('abc')
  })

  it('rejects non-strings, empty, and over-long values', () => {
    expect(sanitizeSupersetId(undefined)).toBeUndefined()
    expect(sanitizeSupersetId(null)).toBeUndefined()
    expect(sanitizeSupersetId(42)).toBeUndefined()
    expect(sanitizeSupersetId('   ')).toBeUndefined()
    expect(sanitizeSupersetId('x'.repeat(MAX_SUPERSET_ID_LENGTH + 1))).toBeUndefined()
  })
})

describe('inSuperset', () => {
  it('reflects a valid id', () => {
    expect(inSuperset(ex('a', 'g1'))).toBe(true)
    expect(inSuperset(ex('a'))).toBe(false)
    expect(inSuperset({ supersetId: '   ' })).toBe(false)
  })
})

describe('groupBySuperset', () => {
  it('groups shared ids and drops singletons', () => {
    const list = [ex('a', 'g1'), ex('b', 'g1'), ex('c', 'g2'), ex('d')]
    const groups = groupBySuperset(list)
    expect([...groups.keys()]).toEqual(['g1'])
    expect(groups.get('g1')!.map(e => e.id)).toEqual(['a', 'b'])
  })

  it('preserves first-appearance member order', () => {
    const list = [ex('b', 'g1'), ex('a', 'g1'), ex('c', 'g1')]
    expect(groupBySuperset(list).get('g1')!.map(e => e.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('orderWithSupersets', () => {
  it('pulls scattered members contiguous at the first member position', () => {
    const list = [ex('a', 'g1'), ex('x'), ex('b', 'g1'), ex('y')]
    expect(orderWithSupersets(list).map(e => e.id)).toEqual(['a', 'b', 'x', 'y'])
  })

  it('leaves a list with no supersets untouched', () => {
    const list = [ex('a'), ex('b'), ex('c')]
    expect(orderWithSupersets(list).map(e => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('treats a lone visible member as solo (no reordering)', () => {
    // g1 has only one member present (the other was filtered out) → stays in place
    const list = [ex('z'), ex('a', 'g1'), ex('y')]
    expect(orderWithSupersets(list).map(e => e.id)).toEqual(['z', 'a', 'y'])
  })

  it('does not mutate the input', () => {
    const list = [ex('a', 'g1'), ex('x'), ex('b', 'g1')]
    const copy = list.map(e => e.id)
    orderWithSupersets(list)
    expect(list.map(e => e.id)).toEqual(copy)
  })

  it('handles two interleaved groups', () => {
    const list = [ex('a', 'g1'), ex('c', 'g2'), ex('b', 'g1'), ex('d', 'g2')]
    expect(orderWithSupersets(list).map(e => e.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('annotateSupersetRows', () => {
  it('marks start/inner/end across a contiguous run', () => {
    const list = orderWithSupersets([ex('a', 'g1'), ex('b', 'g1'), ex('c', 'g1'), ex('d')])
    const rows = annotateSupersetRows(list)
    expect(rows.map(r => r.position)).toEqual(['start', 'inner', 'end', 'solo'])
    expect(rows.slice(0, 3).every(r => r.supersetId === 'g1')).toBe(true)
    expect(rows.slice(0, 3).map(r => r.ordinal)).toEqual([1, 2, 3])
    expect(rows[0].size).toBe(3)
    expect(rows[3].supersetId).toBeUndefined()
  })

  it('treats a lone member as solo even with an id', () => {
    const rows = annotateSupersetRows([ex('a', 'g1'), ex('b')])
    expect(rows.map(r => r.position)).toEqual(['solo', 'solo'])
  })

  it('handles two adjacent groups', () => {
    const list = orderWithSupersets([ex('a', 'g1'), ex('b', 'g1'), ex('c', 'g2'), ex('d', 'g2')])
    const rows = annotateSupersetRows(list)
    expect(rows.map(r => r.position)).toEqual(['start', 'end', 'start', 'end'])
    expect(rows.map(r => r.supersetId)).toEqual(['g1', 'g1', 'g2', 'g2'])
  })
})

describe('nextSupersetExerciseId', () => {
  const members = [ex('a', 'g1'), ex('b', 'g1')]

  it('returns null for a degenerate group', () => {
    expect(nextSupersetExerciseId([ex('a', 'g1')], new Map([['a', 3]]))).toBeNull()
  })

  it('returns null before any set is logged', () => {
    expect(nextSupersetExerciseId(members, new Map())).toBeNull()
  })

  it('picks the member with the fewest sets this session', () => {
    expect(nextSupersetExerciseId(members, new Map([['a', 2], ['b', 1]]))).toBe('b')
  })

  it('breaks ties toward the earliest member (deterministic rotation)', () => {
    expect(nextSupersetExerciseId(members, new Map([['a', 1], ['b', 1]]))).toBe('a')
  })

  it('handles a tri-set', () => {
    const tri = [ex('a', 'g1'), ex('b', 'g1'), ex('c', 'g1')]
    expect(nextSupersetExerciseId(tri, new Map([['a', 2], ['b', 2], ['c', 1]]))).toBe('c')
  })
})

describe('planSupersetChange', () => {
  let counter = 0
  const newId = () => `new-${++counter}`

  it('forms a fresh superset from two unassigned exercises', () => {
    counter = 0
    const list = [ex('a'), ex('b'), ex('c')]
    const changes = planSupersetChange(list, ['a', 'b'], newId)
    expect(changes).toEqual([
      { id: 'a', supersetId: 'new-1' },
      { id: 'b', supersetId: 'new-1' },
    ])
  })

  it('is a no-op when the exact group is re-saved', () => {
    const list = [ex('a', 'g1'), ex('b', 'g1'), ex('c')]
    expect(planSupersetChange(list, ['a', 'b'], newId)).toEqual([])
  })

  it('clears membership when fewer than two members remain', () => {
    const list = [ex('a', 'g1'), ex('b', 'g1')]
    // Removing b leaves a alone → both dissolve.
    const changes = planSupersetChange(list, ['a'], newId)
    const map = new Map(changes.map(c => [c.id, c.supersetId]))
    expect(map.get('a')).toBeUndefined()
    expect(map.get('b')).toBeUndefined()
  })

  it('dissolves the remnant when a member is dropped from a tri-set of two', () => {
    // g1 = {a, b, y}. Editing a to keep only b removes y; but that leaves y a
    // singleton → y dissolves, a & b get a fresh shared id.
    counter = 100
    const list = [ex('a', 'g1'), ex('b', 'g1'), ex('y', 'g1')]
    const changes = planSupersetChange(list, ['a', 'b'], newId)
    const map = new Map(changes.map(c => [c.id, c.supersetId]))
    expect(map.get('a')).toBe('new-101')
    expect(map.get('b')).toBe('new-101')
    expect(map.get('y')).toBeUndefined()
  })

  it('keeps a three-member group intact when all three are re-declared', () => {
    const list = [ex('a', 'g1'), ex('b', 'g1'), ex('c', 'g1')]
    expect(planSupersetChange(list, ['a', 'b', 'c'], newId)).toEqual([])
  })

  it('pulls a member out of its old group when joining a new one', () => {
    counter = 200
    // b currently in g2 alone-with-d; a is unassigned. Group {a, b}.
    const list = [ex('a'), ex('b', 'g2'), ex('d', 'g2')]
    const changes = planSupersetChange(list, ['a', 'b'], newId)
    const map = new Map(changes.map(c => [c.id, c.supersetId]))
    expect(map.get('a')).toBe('new-201')
    expect(map.get('b')).toBe('new-201')
    // d was left alone in g2 → dissolved.
    expect(map.get('d')).toBeUndefined()
  })

  it('ignores unknown and duplicate member ids', () => {
    counter = 300
    const list = [ex('a'), ex('b')]
    const changes = planSupersetChange(list, ['a', 'a', 'ghost', 'b'], newId)
    expect(changes).toEqual([
      { id: 'a', supersetId: 'new-301' },
      { id: 'b', supersetId: 'new-301' },
    ])
  })

  it('returns no changes when a single unassigned exercise is passed', () => {
    const list = [ex('a'), ex('b')]
    expect(planSupersetChange(list, ['a'], newId)).toEqual([])
  })
})
