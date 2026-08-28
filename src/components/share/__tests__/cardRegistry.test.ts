import { describe, it, expect } from 'vitest'
import { eligibleSquareCards, eligibleStoryCards, findCard, resolveInitialCard, SQUARE_CARDS, STORY_CARDS } from '../cardRegistry'
import type { SessionSummary, SessionProgress } from '../../../lib/sessionSummary'

function makeProgress(overrides: Partial<SessionProgress> = {}): SessionProgress {
  return {
    exerciseId: 'ex1',
    name: 'Bench',
    startE1RM: 135,
    currentE1RM: 175,
    delta: 40,
    spanDays: 92,
    spanLabel: '3 months',
    ...overrides,
  }
}

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    rawDate: '2026-04-21',
    date: 'Tue, Apr 21',
    duration: '1h 14m',
    totalVolume: 24850,
    setsCompleted: 18,
    exercises: 5,
    prs: 0,
    repPRs: 0,
    bestSet: { exerciseId: 'ex1', name: 'Bench', weight: 225, reps: 5, e1RM: 263, isPR: false },
    highlights: [],
    weekVolume: [0, 24850, 0, 0, 0, 0, 0],
    priorWeekVolume: 18200,
    streak: 4,
    progress: null,
    unitLabel: 'lbs',
    ...overrides,
  }
}

describe('cardRegistry', () => {
  it('exposes 9 square cards and 3 story cards', () => {
    expect(SQUARE_CARDS).toHaveLength(9)
    expect(STORY_CARDS).toHaveLength(3)
  })

  it('hides PR Focus when no PRs were set', () => {
    const cards = eligibleSquareCards(makeSummary({ prs: 0 }))
    expect(cards.find((c) => c.id === 'pr-focus')).toBeUndefined()
  })

  it('shows AND promotes PR Focus to first when prs > 0', () => {
    const cards = eligibleSquareCards(makeSummary({ prs: 2 }))
    expect(cards[0].id).toBe('pr-focus')
  })

  it('hides PR Focus when prs > 0 but bestSet is null (defensive)', () => {
    const cards = eligibleSquareCards(makeSummary({ prs: 1, bestSet: null }))
    expect(cards.find((c) => c.id === 'pr-focus')).toBeUndefined()
  })

  it('returns 7 squares when no PR and no progress (PR Focus + Progress hidden)', () => {
    const cards = eligibleSquareCards(makeSummary({ prs: 0, progress: null }))
    expect(cards).toHaveLength(7)
  })

  it('returns 8 squares when there is a PR but no progress', () => {
    const cards = eligibleSquareCards(makeSummary({ prs: 1, progress: null }))
    expect(cards).toHaveLength(8)
  })

  it('hides Progress when there is no progress story', () => {
    const cards = eligibleSquareCards(makeSummary({ progress: null }))
    expect(cards.find((c) => c.id === 'progress')).toBeUndefined()
  })

  it('shows Progress when a progress story is present', () => {
    const cards = eligibleSquareCards(makeSummary({ progress: makeProgress() }))
    expect(cards.find((c) => c.id === 'progress')).toBeDefined()
  })

  it('returns all 9 squares when both a PR and a progress story exist', () => {
    const cards = eligibleSquareCards(makeSummary({ prs: 1, progress: makeProgress() }))
    expect(cards).toHaveLength(9)
  })

  it('preserves the original ordering of the non-PR cards when promoting', () => {
    const withoutPR = eligibleSquareCards(makeSummary({ prs: 0 })).map((c) => c.id)
    const withPR = eligibleSquareCards(makeSummary({ prs: 1 })).map((c) => c.id)
    expect(withPR[0]).toBe('pr-focus')
    expect(withPR.slice(1)).toEqual(withoutPR)
  })

  it('returns all 3 story cards regardless of PR state', () => {
    expect(eligibleStoryCards(makeSummary({ prs: 0 }))).toHaveLength(3)
    expect(eligibleStoryCards(makeSummary({ prs: 5 }))).toHaveLength(3)
  })

  it('findCard locates entries by id from either bucket', () => {
    expect(findCard('bold-flood')?.format).toBe('square')
    expect(findCard('best-set-story')?.format).toBe('story')
    expect(findCard('does-not-exist')).toBeNull()
  })

  describe('resolveInitialCard (#716)', () => {
    it('resolves pr-focus to square format at index 0 when a PR is present', () => {
      // PR Focus is promoted to the front of the eligible square list.
      const res = resolveInitialCard(makeSummary({ prs: 1 }), 'pr-focus')
      expect(res).toEqual({ format: 'square', index: 0 })
    })

    it('resolves a non-promoted square card to its eligible index', () => {
      const res = resolveInitialCard(makeSummary({ prs: 0 }), 'receipt')
      const expectedIdx = eligibleSquareCards(makeSummary({ prs: 0 })).findIndex((c) => c.id === 'receipt')
      expect(res).toEqual({ format: 'square', index: expectedIdx })
    })

    it('resolves a story card to its story-bucket index', () => {
      const res = resolveInitialCard(makeSummary(), 'best-set-story')
      const expectedIdx = eligibleStoryCards(makeSummary()).findIndex((c) => c.id === 'best-set-story')
      expect(res).toEqual({ format: 'story', index: expectedIdx })
    })

    it('returns null for an unknown card id', () => {
      expect(resolveInitialCard(makeSummary({ prs: 1 }), 'does-not-exist')).toBeNull()
    })

    it('returns null when the card exists but is ineligible for this summary', () => {
      // pr-focus is hidden when there are no PRs — caller should fall back.
      expect(resolveInitialCard(makeSummary({ prs: 0 }), 'pr-focus')).toBeNull()
    })
  })
})
