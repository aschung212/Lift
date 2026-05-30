import { describe, it, expect, vi, beforeEach } from 'vitest'

// Native by default so the policy logic is exercised; individual tests can
// re-mock platform as web to assert the no-op path.
vi.mock('../../lib/platform', () => ({ isNative: true, isIOS: true, platform: 'ios' }))

// Spy on the native bridge so tests stay independent of StoreKit.
const requestNativeReview = vi.fn(() => Promise.resolve(true))
vi.mock('../../lib/appReview', () => ({ requestNativeReview }))

let useAppReview: typeof import('../useAppReview').useAppReview
let canRequestReview: typeof import('../useAppReview').canRequestReview

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 4, 30) // fixed reference instant

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
  vi.doMock('../../lib/platform', () => ({ isNative: true, isIOS: true, platform: 'ios' }))
  vi.doMock('../../lib/appReview', () => ({ requestNativeReview }))
  const mod = await import('../useAppReview')
  useAppReview = mod.useAppReview
  canRequestReview = mod.canRequestReview
})

describe('useAppReview', () => {
  it('allows a review on a fresh install', () => {
    expect(canRequestReview(NOW)).toBe(true)
    const { requestReviewAtMoment } = useAppReview()
    expect(requestReviewAtMoment('pr', NOW)).toBe(true)
    expect(requestNativeReview).toHaveBeenCalledTimes(1)
  })

  it('records each prompt in history', () => {
    const { requestReviewAtMoment, getPromptHistory } = useAppReview()
    requestReviewAtMoment('pr', NOW)
    expect(getPromptHistory(NOW)).toEqual([NOW])
  })

  it('enforces a minimum spacing between prompts', () => {
    const { requestReviewAtMoment } = useAppReview()
    expect(requestReviewAtMoment('pr', NOW)).toBe(true)
    // Two days later — too soon.
    expect(requestReviewAtMoment('theme_unlock', NOW + 2 * DAY_MS)).toBe(false)
    expect(requestNativeReview).toHaveBeenCalledTimes(1)
  })

  it('allows another prompt once the spacing window passes', () => {
    const { requestReviewAtMoment } = useAppReview()
    expect(requestReviewAtMoment('pr', NOW)).toBe(true)
    expect(requestReviewAtMoment('theme_unlock', NOW + 20 * DAY_MS)).toBe(true)
    expect(requestNativeReview).toHaveBeenCalledTimes(2)
  })

  it('caps prompts at 3 per rolling year', () => {
    const { requestReviewAtMoment } = useAppReview()
    expect(requestReviewAtMoment('pr', NOW)).toBe(true)
    expect(requestReviewAtMoment('pr', NOW + 30 * DAY_MS)).toBe(true)
    expect(requestReviewAtMoment('pr', NOW + 60 * DAY_MS)).toBe(true)
    // Fourth within the year is blocked.
    expect(requestReviewAtMoment('pr', NOW + 90 * DAY_MS)).toBe(false)
    expect(requestNativeReview).toHaveBeenCalledTimes(3)
  })

  it('frees up budget once old prompts age past a year', () => {
    const { requestReviewAtMoment } = useAppReview()
    requestReviewAtMoment('pr', NOW)
    requestReviewAtMoment('pr', NOW + 30 * DAY_MS)
    requestReviewAtMoment('pr', NOW + 60 * DAY_MS)
    // 400 days after the first prompt: NOW (+400d old) and NOW+30 (+370d old)
    // are pruned, only NOW+60 (340d old) remains — so budget reopens.
    const later = NOW + 400 * DAY_MS
    expect(canRequestReview(later)).toBe(true)
    expect(requestReviewAtMoment('theme_unlock', later)).toBe(true)
  })

  it('ignores corrupt history in storage', () => {
    localStorage.setItem('app-review-history', '{not json')
    expect(canRequestReview(NOW)).toBe(true)
  })

  it('does nothing on web (no native review API)', async () => {
    vi.resetModules()
    vi.doMock('../../lib/platform', () => ({ isNative: false, isIOS: false, platform: 'web' }))
    vi.doMock('../../lib/appReview', () => ({ requestNativeReview }))
    const mod = await import('../useAppReview')
    const { requestReviewAtMoment, getPromptHistory } = mod.useAppReview()
    expect(requestReviewAtMoment('pr', NOW)).toBe(false)
    expect(requestNativeReview).not.toHaveBeenCalled()
    // Budget is untouched on web.
    expect(getPromptHistory(NOW)).toEqual([])
  })
})
