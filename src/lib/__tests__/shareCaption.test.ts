import { describe, it, expect } from 'vitest'
import { workoutShareCaption } from '../shareCaption'
import { SHARE_HASHTAG, APP_NAME } from '../appMeta'
import type { SessionSummary } from '../sessionSummary'

/**
 * Pins the suggested-caption builder (#1020). The caption seeds shared cards
 * with ready-to-post copy and the constant branded hashtag so cross-posts
 * cluster into one searchable UGC tag.
 */
function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    rawDate: '2026-05-20',
    date: 'Wed, May 20',
    duration: '1h 5m',
    totalVolume: 8450,
    setsCompleted: 12,
    exercises: 5,
    prs: 0,
    repPRs: 0,
    bestSet: null,
    highlights: [],
    weekVolume: [0, 0, 8450, 0, 0, 0, 0],
    priorWeekVolume: 8000,
    streak: 3,
    unitLabel: 'lbs',
    ...overrides,
  }
}

describe('workoutShareCaption', () => {
  it('always ends with the constant branded hashtag', () => {
    expect(workoutShareCaption(makeSummary())).toContain(SHARE_HASHTAG)
    expect(workoutShareCaption(makeSummary({ prs: 2 }))).toContain(SHARE_HASHTAG)
    expect(workoutShareCaption(makeSummary({ setsCompleted: 0, totalVolume: 0 }))).toContain(SHARE_HASHTAG)
  })

  it('leads with a PR call-out when the session set a PR', () => {
    expect(workoutShareCaption(makeSummary({ prs: 1 }))).toContain(`New PR on ${APP_NAME}!`)
  })

  it('uses a neutral logged-a-workout headline when there is no PR', () => {
    const caption = workoutShareCaption(makeSummary({ prs: 0 }))
    expect(caption).toContain(`Logged a workout on ${APP_NAME}.`)
    expect(caption).not.toContain('New PR')
  })

  it('folds in the set count and grouped volume with unit label', () => {
    const caption = workoutShareCaption(makeSummary({ setsCompleted: 12, totalVolume: 8450, unitLabel: 'lbs' }))
    expect(caption).toContain('12 sets')
    expect(caption).toContain('8,450 lbs lifted')
  })

  it('honors the kg unit label', () => {
    const caption = workoutShareCaption(makeSummary({ totalVolume: 3800, unitLabel: 'kg' }))
    expect(caption).toContain('3,800 kg lifted')
  })

  it('singularizes a one-set session', () => {
    const caption = workoutShareCaption(makeSummary({ setsCompleted: 1 }))
    expect(caption).toContain('1 set')
    expect(caption).not.toContain('1 sets')
  })

  it('omits the stat line entirely for a degenerate/empty summary', () => {
    const caption = workoutShareCaption(makeSummary({ setsCompleted: 0, totalVolume: 0 }))
    expect(caption).toBe(`Logged a workout on ${APP_NAME}. ${SHARE_HASHTAG}`)
    expect(caption).not.toContain('0 sets')
    expect(caption).not.toContain('0 lbs')
  })

  it('rounds fractional volume to a whole number', () => {
    const caption = workoutShareCaption(makeSummary({ totalVolume: 8449.6 }))
    expect(caption).toContain('8,450 lbs lifted')
  })
})
