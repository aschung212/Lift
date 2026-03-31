import { describe, it, expect } from 'vitest'
import { mergeEntities, syncSummary, type Timestamped } from '../conflictResolver'

interface TestEntity extends Timestamped {
  id: string
  updated_at: string
  name: string
}

function entity(id: string, name: string, updated_at: string): TestEntity {
  return { id, name, updated_at }
}

describe('mergeEntities', () => {
  it('returns empty result for two empty arrays', () => {
    const result = mergeEntities<TestEntity>([], [])
    expect(result.merged).toEqual([])
    expect(result.localOnly).toEqual([])
    expect(result.remoteOnly).toEqual([])
    expect(result.localWins).toEqual([])
    expect(result.remoteWins).toEqual([])
  })

  it('treats all local entities as local-only when remote is empty', () => {
    const local = [entity('1', 'A', '2026-03-30T10:00:00Z')]
    const result = mergeEntities(local, [])
    expect(result.merged).toHaveLength(1)
    expect(result.localOnly).toHaveLength(1)
    expect(result.remoteOnly).toHaveLength(0)
    expect(result.merged[0].name).toBe('A')
  })

  it('treats all remote entities as remote-only when local is empty', () => {
    const remote = [entity('1', 'A', '2026-03-30T10:00:00Z')]
    const result = mergeEntities([], remote)
    expect(result.merged).toHaveLength(1)
    expect(result.remoteOnly).toHaveLength(1)
    expect(result.localOnly).toHaveLength(0)
  })

  it('keeps local version when local timestamp is newer', () => {
    const local = [entity('1', 'local-v', '2026-03-30T12:00:00Z')]
    const remote = [entity('1', 'remote-v', '2026-03-30T10:00:00Z')]
    const result = mergeEntities(local, remote)
    expect(result.merged).toHaveLength(1)
    expect(result.merged[0].name).toBe('local-v')
    expect(result.localWins).toHaveLength(1)
    expect(result.remoteWins).toHaveLength(0)
  })

  it('keeps remote version when remote timestamp is newer', () => {
    const local = [entity('1', 'local-v', '2026-03-30T10:00:00Z')]
    const remote = [entity('1', 'remote-v', '2026-03-30T12:00:00Z')]
    const result = mergeEntities(local, remote)
    expect(result.merged).toHaveLength(1)
    expect(result.merged[0].name).toBe('remote-v')
    expect(result.remoteWins).toHaveLength(1)
    expect(result.localWins).toHaveLength(0)
  })

  it('prefers local on equal timestamps (tie-break)', () => {
    const local = [entity('1', 'local-v', '2026-03-30T10:00:00Z')]
    const remote = [entity('1', 'remote-v', '2026-03-30T10:00:00Z')]
    const result = mergeEntities(local, remote)
    expect(result.merged[0].name).toBe('local-v')
    expect(result.localWins).toHaveLength(1)
  })

  it('merges mixed: local-only, remote-only, and conflicting entities', () => {
    const local = [
      entity('1', 'local-only', '2026-03-30T10:00:00Z'),
      entity('2', 'local-old', '2026-03-30T08:00:00Z'),
      entity('3', 'local-new', '2026-03-30T14:00:00Z'),
    ]
    const remote = [
      entity('2', 'remote-new', '2026-03-30T12:00:00Z'),
      entity('3', 'remote-old', '2026-03-30T10:00:00Z'),
      entity('4', 'remote-only', '2026-03-30T10:00:00Z'),
    ]
    const result = mergeEntities(local, remote)

    expect(result.merged).toHaveLength(4)
    expect(result.localOnly).toEqual([local[0]])
    expect(result.remoteOnly).toEqual([remote[2]])
    expect(result.localWins.map(e => e.id)).toEqual(['3'])
    expect(result.remoteWins.map(e => e.id)).toEqual(['2'])

    // Verify merged content
    const byId = new Map(result.merged.map(e => [e.id, e]))
    expect(byId.get('1')!.name).toBe('local-only')
    expect(byId.get('2')!.name).toBe('remote-new')   // remote won
    expect(byId.get('3')!.name).toBe('local-new')    // local won
    expect(byId.get('4')!.name).toBe('remote-only')
  })

  it('handles large datasets efficiently', () => {
    const n = 1000
    const local = Array.from({ length: n }, (_, i) =>
      entity(`${i}`, `local-${i}`, '2026-03-30T10:00:00Z')
    )
    const remote = Array.from({ length: n }, (_, i) =>
      entity(`${i + n / 2}`, `remote-${i}`, '2026-03-30T12:00:00Z')
    )
    const result = mergeEntities(local, remote)
    // 500 local-only + 500 remote-wins + 500 remote-only = 1500
    expect(result.merged).toHaveLength(1500)
    expect(result.localOnly).toHaveLength(500)
    expect(result.remoteOnly).toHaveLength(500)
    expect(result.remoteWins).toHaveLength(500)
  })

  it('handles entities with millisecond precision timestamps', () => {
    const local = [entity('1', 'local', '2026-03-30T10:00:00.500Z')]
    const remote = [entity('1', 'remote', '2026-03-30T10:00:00.499Z')]
    const result = mergeEntities(local, remote)
    expect(result.merged[0].name).toBe('local')
    expect(result.localWins).toHaveLength(1)
  })

  it('preserves order: local entities first, then remote-only appended', () => {
    const local = [
      entity('b', 'B', '2026-03-30T10:00:00Z'),
      entity('a', 'A', '2026-03-30T10:00:00Z'),
    ]
    const remote = [
      entity('c', 'C', '2026-03-30T10:00:00Z'),
      entity('a', 'A-remote', '2026-03-30T08:00:00Z'),
    ]
    const result = mergeEntities(local, remote)
    expect(result.merged.map(e => e.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('syncSummary', () => {
  it('returns "no changes" for empty result', () => {
    const result = mergeEntities<TestEntity>([], [])
    expect(syncSummary(result)).toBe('no changes')
  })

  it('describes all categories in summary', () => {
    const local = [
      entity('1', 'lo', '2026-03-30T10:00:00Z'),
      entity('2', 'lw', '2026-03-30T14:00:00Z'),
    ]
    const remote = [
      entity('2', 'rw', '2026-03-30T10:00:00Z'),
      entity('3', 'ro', '2026-03-30T10:00:00Z'),
    ]
    const result = mergeEntities(local, remote)
    const summary = syncSummary(result)
    expect(summary).toContain('1 local-only')
    expect(summary).toContain('1 remote-only')
    expect(summary).toContain('1 local-wins')
  })
})
