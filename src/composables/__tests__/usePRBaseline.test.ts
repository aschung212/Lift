import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePRBaseline } from '../usePRBaseline'
import { usePreferencesStore } from '../../stores/preferences'
import { getLocalStorageMock } from '../../__tests__/helpers'

vi.mock('../../lib/supabase', () => ({ supabase: null }))

const localStorageMock = getLocalStorageMock()

describe('usePRBaseline', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  it('defaults to null (legacy all-time behavior)', () => {
    const { prBaselineDate } = usePRBaseline()
    expect(prBaselineDate.value).toBeNull()
  })

  it('setPRBaseline persists a valid ISO date', () => {
    const { setPRBaseline, prBaselineDate } = usePRBaseline()
    setPRBaseline('2026-01-01')
    expect(prBaselineDate.value).toBe('2026-01-01')
    const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
    expect(stored.prBaselineDate).toBe('2026-01-01')
  })

  it('rejects malformed dates without touching state', () => {
    const { setPRBaseline, prBaselineDate } = usePRBaseline()
    setPRBaseline('2026-01-01')
    setPRBaseline('not-a-date')
    expect(prBaselineDate.value).toBe('2026-01-01')
  })

  it('clearPRBaseline reverts to null', () => {
    const { setPRBaseline, clearPRBaseline, prBaselineDate } = usePRBaseline()
    setPRBaseline('2026-01-01')
    clearPRBaseline()
    expect(prBaselineDate.value).toBeNull()
    const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
    expect(stored.prBaselineDate).toBeNull()
  })

  it('startNewTrainingBlock sets today', () => {
    const { startNewTrainingBlock, prBaselineDate } = usePRBaseline()
    startNewTrainingBlock()
    const today = new Date()
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(prBaselineDate.value).toBe(expected)
  })

  it('migrates from old pr-baseline-date localStorage key on init', async () => {
    localStorageMock.setItem('pr-baseline-date', '2026-03-15')
    const store = usePreferencesStore()
    await store.init('test-user')

    const { prBaselineDate } = usePRBaseline()
    expect(prBaselineDate.value).toBe('2026-03-15')
    // Old key should be cleaned up
    expect(localStorageMock.getItem('pr-baseline-date')).toBeNull()
  })

  it('does not migrate invalid legacy values', async () => {
    localStorageMock.setItem('pr-baseline-date', 'garbage')
    const store = usePreferencesStore()
    await store.init('test-user')

    const { prBaselineDate } = usePRBaseline()
    expect(prBaselineDate.value).toBeNull()
  })

  it('loads prBaselineDate from preferences localStorage', async () => {
    localStorageMock.setItem('user-preferences', JSON.stringify({
      features: { workouts: true, calendar: true, weight: true },
      prBaselineDate: '2026-04-01',
    }))
    const store = usePreferencesStore()
    await store.init('test-user')

    const { prBaselineDate } = usePRBaseline()
    expect(prBaselineDate.value).toBe('2026-04-01')
  })

  it('syncs prBaselineDate in Supabase payload', () => {
    const { setPRBaseline } = usePRBaseline()
    setPRBaseline('2026-02-14')
    const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
    expect(stored.prBaselineDate).toBe('2026-02-14')
    expect(stored.features).toBeDefined()
    expect(stored.weightGoal).toBeDefined()
    expect(stored.experience).toBeDefined()
  })
})
