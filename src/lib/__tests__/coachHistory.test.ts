import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadCoachHistory,
  appendCoachInsight,
  clearCoachHistory,
  COACH_HISTORY_KEY,
  COACH_HISTORY_LIMIT,
} from '../coachHistory'
import type { CoachReview } from '../aiCoach'

function review(headline: string): CoachReview {
  return {
    headline,
    sections: [
      { type: 'progress', title: 'Bench up', body: 'You added 10 lb on bench this week.' },
    ],
    focusNext: 'Hit squats twice next week.',
  }
}

describe('coach insight history', () => {
  beforeEach(() => {
    localStorage.removeItem(COACH_HISTORY_KEY)
  })

  it('defaults to an empty list', () => {
    expect(loadCoachHistory()).toEqual([])
  })

  it('appends and re-reads a review (re-open is free — no quota involved)', () => {
    appendCoachInsight(review('Strong week'), 1000)
    const history = loadCoachHistory()
    expect(history).toHaveLength(1)
    expect(history[0].review.headline).toBe('Strong week')
    expect(history[0].createdAt).toBe(1000)
    expect(history[0].id).toBeTruthy()
  })

  it('orders newest-first', () => {
    appendCoachInsight(review('oldest'), 1000)
    appendCoachInsight(review('middle'), 2000)
    appendCoachInsight(review('newest'), 3000)
    expect(loadCoachHistory().map((e) => e.review.headline)).toEqual([
      'newest',
      'middle',
      'oldest',
    ])
  })

  it('caps the ring at COACH_HISTORY_LIMIT, dropping the oldest', () => {
    for (let i = 0; i < COACH_HISTORY_LIMIT + 5; i++) {
      appendCoachInsight(review(`review-${i}`), 1000 + i)
    }
    const history = loadCoachHistory()
    expect(history).toHaveLength(COACH_HISTORY_LIMIT)
    // newest is the last appended; the 5 oldest were evicted
    expect(history[0].review.headline).toBe(`review-${COACH_HISTORY_LIMIT + 4}`)
    expect(history[history.length - 1].review.headline).toBe('review-5')
  })

  it('assigns a unique id per insight', () => {
    appendCoachInsight(review('a'), 1000)
    appendCoachInsight(review('b'), 1000)
    const ids = loadCoachHistory().map((e) => e.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('clears the whole ring', () => {
    appendCoachInsight(review('a'), 1000)
    appendCoachInsight(review('b'), 2000)
    clearCoachHistory()
    expect(loadCoachHistory()).toEqual([])
    expect(localStorage.getItem(COACH_HISTORY_KEY)).toBeNull()
  })

  it('returns an empty list on corrupt storage', () => {
    localStorage.setItem(COACH_HISTORY_KEY, '{not json')
    expect(loadCoachHistory()).toEqual([])
  })

  it('returns an empty list when the stored value is not an array', () => {
    localStorage.setItem(COACH_HISTORY_KEY, JSON.stringify({ not: 'an array' }))
    expect(loadCoachHistory()).toEqual([])
  })

  it('drops malformed entries but keeps valid ones', () => {
    localStorage.setItem(
      COACH_HISTORY_KEY,
      JSON.stringify([
        { id: 'ok', createdAt: 1000, review: review('valid') },
        { id: 'no-review', createdAt: 2000 },
        { id: 42, createdAt: 3000, review: review('bad id') },
        { id: 'bad-review-shape', createdAt: 4000, review: { headline: 'x' } },
        { id: 'bad-section', createdAt: 5000, review: { headline: 'h', focusNext: 'f', sections: [{ type: 'nope', title: 't', body: 'b' }] } },
      ]),
    )
    const history = loadCoachHistory()
    expect(history).toHaveLength(1)
    expect(history[0].id).toBe('ok')
  })

  it('defensively caps an over-long persisted ring on read', () => {
    const tooMany = Array.from({ length: COACH_HISTORY_LIMIT + 3 }, (_, i) => ({
      id: `id-${i}`,
      createdAt: 1000 + i,
      review: review(`r-${i}`),
    }))
    localStorage.setItem(COACH_HISTORY_KEY, JSON.stringify(tooMany))
    expect(loadCoachHistory()).toHaveLength(COACH_HISTORY_LIMIT)
  })

  it('persists a metric on a section round-trip', () => {
    const withMetric: CoachReview = {
      headline: 'PR week',
      sections: [
        {
          type: 'progress',
          title: 'Squat PR',
          body: 'New estimated 1RM.',
          metric: { label: 'Squat e1RM', value: '315 lb' },
        },
      ],
      focusNext: 'Deload next week.',
    }
    appendCoachInsight(withMetric, 1000)
    expect(loadCoachHistory()[0].review.sections[0].metric).toEqual({
      label: 'Squat e1RM',
      value: '315 lb',
    })
  })
})
