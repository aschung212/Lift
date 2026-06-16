import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn() },
}))
vi.mock('../../lib/conflictResolver', () => ({
  mergeEntities: vi.fn(() => ({ merged: [], localOnly: [] })),
}))

const mockLogEvent = vi.fn()
vi.mock('../useAnalytics', () => ({
  useAnalytics: () => ({
    logEvent: mockLogEvent,
    tabSwitch: vi.fn(),
    flushEngagement: vi.fn(),
  }),
}))

import { useCsvImport } from '../useCsvImport'
import { useWorkoutStore } from '../../stores/workout'

const STRONG_CSV = `Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2026-04-01,Morning,Bench Press,1,185,5,,,,,
2026-04-01,Morning,Bench Press,2,185,5,,,,,
2026-04-01,Morning,Squat,1,225,3,,,,,`

describe('useCsvImport', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
    mockLogEvent.mockReset()
  })

  it('writes parsed exercises and sets into the workout store', () => {
    const { importFromText } = useCsvImport()
    const summary = importFromText(STRONG_CSV)

    expect(summary).toEqual({ exercises: 2, sets: 3, format: 'strong' })

    const store = useWorkoutStore()
    expect(store.exercises).toHaveLength(2)
    const bench = store.exercises.find(e => e.name === 'Bench Press')!
    expect(bench.sets).toHaveLength(2)
    expect(bench.sets[0].weight).toBe(185)
  })

  it('logs a data_import analytics event tagged with the source', () => {
    const { importFromText } = useCsvImport()
    importFromText(STRONG_CSV, 'share_target')

    expect(mockLogEvent).toHaveBeenCalledWith('data_import', {
      format: 'strong',
      exercises: 2,
      sets: 3,
      source: 'share_target',
    })
  })

  it("defaults the source to 'file' when not specified", () => {
    const { importFromText } = useCsvImport()
    importFromText(STRONG_CSV)
    expect(mockLogEvent).toHaveBeenCalledWith(
      'data_import',
      expect.objectContaining({ source: 'file' }),
    )
  })

  it('returns an error summary for unrecognized formats without writing or logging', () => {
    const { importFromText } = useCsvImport()
    const summary = importFromText('foo,bar,baz\n1,2,3')

    expect(summary.format).toBe('unknown')
    expect(summary.error).toBeTruthy()
    expect(useWorkoutStore().exercises).toHaveLength(0)
    expect(mockLogEvent).not.toHaveBeenCalled()
  })

  it('returns an error summary for empty input', () => {
    const { importFromText } = useCsvImport()
    const summary = importFromText('')
    expect(summary.error).toBeTruthy()
    expect(mockLogEvent).not.toHaveBeenCalled()
  })
})
