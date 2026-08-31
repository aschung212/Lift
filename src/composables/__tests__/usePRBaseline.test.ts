import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePRBaseline } from '../usePRBaseline'
import { usePreferencesStore } from '../../stores/preferences'
import { getLocalStorageMock } from '../../__tests__/helpers'
import { DEFAULT_RECENT_BASELINE_WEEKS, MIN_RECENT_BASELINE_WEEKS } from '../../lib/strengthBaseline'

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

/**
 * #1272 — `prBaselineDate` is now the mode-RESOLVED baseline, not the raw stored
 * anchor. Everything downstream (getExercisePR, scoreSet, the intensity anchor,
 * PR badges) reads it, so this is the one seam where lifetime vs recent is
 * decided. `prBaselineAnchor` keeps exposing the raw value for Settings.
 *
 * Clock-pinned per the frozen-clock invariant: the composable derives the recent
 * window from `todayISO()`, so an unpinned test would assert against the calendar.
 */
describe('usePRBaseline — strength baseline mode', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T12:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults to lifetime mode, so the resolved baseline is the anchor', () => {
    const { strengthBaselineMode, recentBaselineWeeks, prBaselineDate, prBaselineAnchor } = usePRBaseline()
    expect(strengthBaselineMode.value).toBe('lifetime')
    expect(recentBaselineWeeks.value).toBe(DEFAULT_RECENT_BASELINE_WEEKS)
    expect(prBaselineDate.value).toBeNull()
    expect(prBaselineAnchor.value).toBeNull()
  })

  it('recent mode resolves to the rolling window while the anchor stays untouched', () => {
    const { setStrengthBaselineMode, prBaselineDate, prBaselineAnchor } = usePRBaseline()
    setStrengthBaselineMode('recent')
    expect(prBaselineDate.value).toBe('2026-07-05') // 8 weeks before 2026-08-30
    expect(prBaselineAnchor.value).toBeNull()
  })

  it('recent mode keeps a newer anchor (a fresh training block still wins)', () => {
    const { setStrengthBaselineMode, setPRBaseline, prBaselineDate, prBaselineAnchor } = usePRBaseline()
    setPRBaseline('2026-08-20')
    setStrengthBaselineMode('recent')
    expect(prBaselineDate.value).toBe('2026-08-20')
    expect(prBaselineAnchor.value).toBe('2026-08-20')
  })

  it('recent mode supersedes a stale anchor', () => {
    const { setStrengthBaselineMode, setPRBaseline, prBaselineDate, prBaselineAnchor } = usePRBaseline()
    setPRBaseline('2025-01-01')
    setStrengthBaselineMode('recent')
    expect(prBaselineDate.value).toBe('2026-07-05')
    // The anchor is preserved verbatim, so switching back restores it exactly.
    expect(prBaselineAnchor.value).toBe('2025-01-01')
    setStrengthBaselineMode('lifetime')
    expect(prBaselineDate.value).toBe('2025-01-01')
  })

  it('changing the window length re-resolves the baseline', () => {
    const { setStrengthBaselineMode, setRecentBaselineWeeks, prBaselineDate } = usePRBaseline()
    setStrengthBaselineMode('recent')
    setRecentBaselineWeeks(2)
    expect(prBaselineDate.value).toBe('2026-08-16')
    setRecentBaselineWeeks(26)
    expect(prBaselineDate.value).toBe('2026-03-01')
  })

  it('clamps an out-of-range window length', () => {
    const { setRecentBaselineWeeks, recentBaselineWeeks } = usePRBaseline()
    setRecentBaselineWeeks(0)
    expect(recentBaselineWeeks.value).toBe(MIN_RECENT_BASELINE_WEEKS)
  })

  it('ignores an unrecognized mode instead of stranding the user off-mode', () => {
    const { setStrengthBaselineMode, strengthBaselineMode } = usePRBaseline()
    setStrengthBaselineMode('recent')
    setStrengthBaselineMode('sideways' as never)
    expect(strengthBaselineMode.value).toBe('lifetime')
  })

  it('syncs both fields in the persisted payload', () => {
    const { setStrengthBaselineMode, setRecentBaselineWeeks } = usePRBaseline()
    setStrengthBaselineMode('recent')
    setRecentBaselineWeeks(4)
    const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
    expect(stored.strengthBaselineMode).toBe('recent')
    expect(stored.recentBaselineWeeks).toBe(4)
  })

  it('hydrates both fields from localStorage at store construction', () => {
    localStorageMock.setItem('user-preferences', JSON.stringify({
      features: { workouts: true, calendar: true, weight: true },
      strengthBaselineMode: 'recent',
      recentBaselineWeeks: 4,
    }))
    setActivePinia(createPinia())
    const { strengthBaselineMode, recentBaselineWeeks, prBaselineDate } = usePRBaseline()
    expect(strengthBaselineMode.value).toBe('recent')
    expect(recentBaselineWeeks.value).toBe(4)
    expect(prBaselineDate.value).toBe('2026-08-02')
  })

  it('sanitizes a corrupt persisted payload back to safe values', () => {
    localStorageMock.setItem('user-preferences', JSON.stringify({
      features: { workouts: true, calendar: true, weight: true },
      strengthBaselineMode: 'all-time',
      recentBaselineWeeks: null,
    }))
    setActivePinia(createPinia())
    const { strengthBaselineMode, recentBaselineWeeks } = usePRBaseline()
    expect(strengthBaselineMode.value).toBe('lifetime')
    expect(recentBaselineWeeks.value).toBe(DEFAULT_RECENT_BASELINE_WEEKS)
  })

  it('$reset wipes the mode back to the default on sign-out', () => {
    const { setStrengthBaselineMode, setRecentBaselineWeeks } = usePRBaseline()
    setStrengthBaselineMode('recent')
    setRecentBaselineWeeks(4)
    const prefs = usePreferencesStore()
    prefs.$reset()
    expect(prefs.strengthBaselineMode).toBe('lifetime')
    expect(prefs.recentBaselineWeeks).toBe(DEFAULT_RECENT_BASELINE_WEEKS)
    const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
    expect(stored.strengthBaselineMode).toBe('lifetime')
  })
})
