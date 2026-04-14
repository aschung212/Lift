import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// Import after mocks are set up (module runs side effects at import)
const { usePRBaseline } = await import('../usePRBaseline')

describe('usePRBaseline', () => {
  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.setItem.mockClear()
    localStorageMock.getItem.mockClear()
  })

  it('defaults to null (legacy all-time behavior)', () => {
    const { prBaselineDate } = usePRBaseline()
    expect(prBaselineDate.value).toBeNull()
  })

  it('setPRBaseline persists a valid ISO date to localStorage', async () => {
    const { setPRBaseline, prBaselineDate } = usePRBaseline()
    setPRBaseline('2026-01-01')
    await nextTick()
    expect(prBaselineDate.value).toBe('2026-01-01')
    expect(localStorageMock.setItem).toHaveBeenCalledWith('pr-baseline-date', '2026-01-01')
  })

  it('rejects malformed dates without touching state', async () => {
    const { setPRBaseline, prBaselineDate } = usePRBaseline()
    setPRBaseline('2026-01-01')
    await nextTick()
    setPRBaseline('not-a-date')
    await nextTick()
    expect(prBaselineDate.value).toBe('2026-01-01')
  })

  it('clearPRBaseline removes persistence and reverts to null', async () => {
    const { setPRBaseline, clearPRBaseline, prBaselineDate } = usePRBaseline()
    setPRBaseline('2026-01-01')
    await nextTick()
    clearPRBaseline()
    await nextTick()
    expect(prBaselineDate.value).toBeNull()
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('pr-baseline-date')
  })

  it('startNewTrainingBlock sets today', async () => {
    const { startNewTrainingBlock, prBaselineDate } = usePRBaseline()
    startNewTrainingBlock()
    await nextTick()
    const today = new Date()
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(prBaselineDate.value).toBe(expected)
  })
})
