import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { RECAP_CARDS, SQUARE_CARDS, STORY_CARDS, loadCardComponent } from '../cardRegistry'
import { SHARE_CARD_HANDLE } from '../../../lib/shareImage'
import type { SessionSummary } from '../../../lib/sessionSummary'
import type { YearRecap } from '../../../lib/yearRecap'

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
    progress: null,
    unitLabel: 'lbs',
    ...overrides,
  }
}

/**
 * A recap card (#1018) renders a `YearRecap`, not a `SessionSummary`, so it
 * cannot ride the `it.each` below — but the handle rule is about every card the
 * app can export, and the recap sheet exports these two. Iterating the bucket
 * (rather than naming the two ids) keeps the guard total if a third recap
 * format is added.
 */
function makeRecap(overrides: Partial<YearRecap> = {}): YearRecap {
  return {
    year: 2026,
    totalVolume: 1_250_400,
    workouts: 148,
    sets: 2140,
    exercises: 22,
    prs: 31,
    bestLift: {
      exerciseId: 'ex1',
      name: 'Deadlift',
      loadLabel: '405 lbs',
      reps: 3,
      e1RM: 446,
      dateKey: '2026-08-14',
    },
    topTag: { tag: 'Push', sets: 620 },
    longestStreakWeeks: 19,
    monthlyVolume: [90_000, 102_000, 118_000, 96_000, 130_000, 108_000, 99_000, 141_000, 88_000, 92_000, 84_000, 2_400],
    busiestMonth: 7,
    unitLabel: 'lbs',
    ...overrides,
  }
}

/** A year with nothing in it — every optional field null, every month zero. */
function emptyRecap(): YearRecap {
  return makeRecap({
    totalVolume: 0,
    workouts: 0,
    sets: 0,
    exercises: 0,
    prs: 0,
    bestLift: null,
    topTag: null,
    longestStreakWeeks: 0,
    monthlyVolume: new Array(12).fill(0),
    busiestMonth: null,
  })
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

  it.each(ALL_CARDS.map((c) => c.id))(
    'renders the app handle on the %s card',
    async (id) => {
      // Cards are code-split behind a dynamic import (#937); resolve the real
      // component before mounting so we still assert on rendered card content.
      const component = (await loadCardComponent(id))!
      const wrapper = mount(component, { props: { summary: makeSummary() } })
      expect(wrapper.text()).toContain(SHARE_CARD_HANDLE)
    },
  )

  it.each(RECAP_CARDS.map((c) => c.id))(
    'renders the app handle on the %s recap card',
    async (id) => {
      const component = (await loadCardComponent(id))!
      const wrapper = mount(component, { props: { recap: makeRecap() } })
      expect(wrapper.text()).toContain(SHARE_CARD_HANDLE)
    },
  )

  it('still renders the handle on a recap of an untrained year', async () => {
    // bestLift/topTag/busiestMonth are all v-if'd or null-branched; the handle
    // sits outside them, same contract as the empty-day case below.
    for (const { id } of RECAP_CARDS) {
      const component = (await loadCardComponent(id))!
      const wrapper = mount(component, { props: { recap: emptyRecap() } })
      expect(wrapper.text()).toContain(SHARE_CARD_HANDLE)
    }
  })

  it('still renders the handle when there is no best set (defensive empty-day render)', async () => {
    // PR Focus / Best Set bodies are v-if'd on bestSet; the handle lives
    // outside those guards so it must survive a null bestSet.
    for (const { id } of ALL_CARDS) {
      if (id === 'pr-focus') continue // hidden entirely when prs === 0 / no bestSet
      const component = (await loadCardComponent(id))!
      const wrapper = mount(component, {
        props: { summary: makeSummary({ bestSet: null, prs: 0, repPRs: 0, highlights: [] }) },
      })
      expect(wrapper.text()).toContain(SHARE_CARD_HANDLE)
    }
  })
})
