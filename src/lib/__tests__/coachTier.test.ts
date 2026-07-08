import { describe, it, expect } from 'vitest'
import {
  FREE_WEEKLY_LIMIT,
  SUPPORTER_WEEKLY_LIMIT,
  weeklyReviewLimit,
} from '../coachTier'

describe('coach tier model (LIFT-904)', () => {
  it('the supporter allowance is strictly greater than the free baseline', () => {
    // The whole value prop: supporters get *more-frequent* coach runs. If these were
    // equal the paid tier would anchor on nothing.
    expect(SUPPORTER_WEEKLY_LIMIT).toBeGreaterThan(FREE_WEEKLY_LIMIT)
  })

  it('keeps a non-trivial free baseline so the core loop is never paywalled', () => {
    expect(FREE_WEEKLY_LIMIT).toBeGreaterThanOrEqual(1)
  })

  it('weeklyReviewLimit resolves the free baseline for non-supporters', () => {
    expect(weeklyReviewLimit(false)).toBe(FREE_WEEKLY_LIMIT)
  })

  it('weeklyReviewLimit resolves the supporter allowance for supporters', () => {
    expect(weeklyReviewLimit(true)).toBe(SUPPORTER_WEEKLY_LIMIT)
  })

  it('re-exports the same tier symbols from the aiCoach contract module', async () => {
    // The server proxy imports these from aiCoach; assert they are the identical values
    // so the server's p_default_limit and the client display can never drift.
    const aiCoach = await import('../aiCoach')
    expect(aiCoach.FREE_WEEKLY_LIMIT).toBe(FREE_WEEKLY_LIMIT)
    expect(aiCoach.SUPPORTER_WEEKLY_LIMIT).toBe(SUPPORTER_WEEKLY_LIMIT)
    expect(aiCoach.weeklyReviewLimit(true)).toBe(SUPPORTER_WEEKLY_LIMIT)
  })
})
