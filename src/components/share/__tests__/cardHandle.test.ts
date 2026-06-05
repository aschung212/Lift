import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { SQUARE_CARDS, STORY_CARDS } from '../cardRegistry'
import { SHARE_CARD_HANDLE } from '../../../lib/shareImage'
import type { SessionSummary } from '../../../lib/sessionSummary'

/**
 * Regression guard for the share-card acquisition loop (issue #714).
 *
 * Every share card must stamp the app's public handle so a viewer who sees a
 * card on social has a path to find and install the app — the link is the
 * conversion mechanism that closes the loop. Before #714 the cards rendered a
 * "LIFT" wordmark but zero links, so the funnel leaked at the final step.
 *
 * Mounting every registered card (rather than asserting on source text) means
 * a card added later that forgets the handle fails here, and a card whose
 * `v-if`'d brand block stops rendering is also caught.
 */

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    rawDate: '2026-04-21',
    date: 'Tue, Apr 21',
    duration: '1h 14m',
    totalVolume: 24850,
    setsCompleted: 18,
    exercises: 5,
    prs: 1,
    repPRs: 1,
    bestSet: { exerciseId: 'ex1', name: 'Bench', weight: 225, reps: 5, e1RM: 263, isPR: true },
    highlights: [
      { exerciseId: 'ex1', name: 'Bench', weight: 225, reps: 5, e1RM: 263, badge: 'PR', volume: 1125 },
    ],
    weekVolume: [0, 24850, 0, 0, 0, 0, 0],
    priorWeekVolume: 18200,
    streak: 4,
    unitLabel: 'lbs',
    ...overrides,
  }
}

const ALL_CARDS = [...SQUARE_CARDS, ...STORY_CARDS]

describe('share-card handle (issue #714)', () => {
  it('pins the handle to the real deployment domain, never a fabricated one', () => {
    // Mirrors the metaRegression contract: the only valid domain is the real
    // Vercel deployment. A hallucinated competitor domain shipping on a share
    // card would be the SEV1 failure mode from 2026-04-02.
    expect(SHARE_CARD_HANDLE).toBe('spa-rho-sandy.vercel.app')
    expect(SHARE_CARD_HANDLE).not.toContain('liftracker')
    expect(SHARE_CARD_HANDLE).not.toMatch(/^https?:\/\//)
  })

  it.each(ALL_CARDS.map((c) => [c.id, c.component] as const))(
    'renders the app handle on the %s card',
    (_id, component) => {
      const wrapper = mount(component, { props: { summary: makeSummary() } })
      expect(wrapper.text()).toContain(SHARE_CARD_HANDLE)
    },
  )

  it('still renders the handle when there is no best set (defensive empty-day render)', () => {
    // PR Focus / Best Set bodies are v-if'd on bestSet; the handle lives
    // outside those guards so it must survive a null bestSet.
    for (const { id, component } of ALL_CARDS) {
      if (id === 'pr-focus') continue // hidden entirely when prs === 0 / no bestSet
      const wrapper = mount(component, {
        props: { summary: makeSummary({ bestSet: null, prs: 0, repPRs: 0, highlights: [] }) },
      })
      expect(wrapper.text()).toContain(SHARE_CARD_HANDLE)
    }
  })
})
