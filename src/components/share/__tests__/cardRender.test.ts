import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { loadCardComponent } from '../cardRegistry'
import type { SessionSummary, SessionHighlight } from '../../../lib/sessionSummary'
import type { YearRecap } from '../../../lib/yearRecap'

/**
 * Render smoke tests for the 13 share-card components (issue #1188; the two
 * Year in Review cards joined in #1018).
 *
 * Before this file the entire `cards/` directory had 0% render coverage — only
 * the wrappers (registry, handle, picker, shareImage helpers) were tested. Each
 * card binds directly to the shared `SessionSummary` shape, so a field rename or
 * a field going null would silently produce a broken/blank export image with no
 * failing test. These cards are the growth-critical surface behind the share
 * funnel (#712/#714/#1019/#1020), and they're rasterized offscreen — a break is
 * invisible until a user sees the mangled image.
 *
 * Each test mounts the REAL card component (resolved through its code-split
 * dynamic import, per #937) and asserts the distinctive summary values it is
 * contracted to surface. The handle contract lives in cardHandle.test.ts; this
 * file pins the *data* every card renders so a prop-contract break fails fast.
 */

function makeHighlight(overrides: Partial<SessionHighlight> = {}): SessionHighlight {
  return {
    exerciseId: 'ex1',
    name: 'Bench Press',
    weight: 225,
    reps: 5,
    e1RM: 263,
    badge: 'PR',
    volume: 1125,
    ...overrides,
  }
}

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    rawDate: '2026-04-21', // a Tuesday → todayIdx 1, weekday label 'Tue'
    date: 'Tue, Apr 21',
    duration: '1h 14m',
    totalVolume: 24850,
    setsCompleted: 18,
    exercises: 5,
    prs: 2,
    repPRs: 1,
    bestSet: { exerciseId: 'ex1', name: 'Bench Press', weight: 225, reps: 5, e1RM: 263, isPR: true },
    highlights: [makeHighlight()],
    weekVolume: [0, 24850, 0, 0, 0, 0, 0],
    priorWeekVolume: 18200, // (24850-18200)/18200 ≈ +37%
    streak: 4,
    unitLabel: 'lbs',
    ...overrides,
  }
}

/** Resolve + mount a card by registry id with the given summary. */
async function mountCard(id: string, summary: SessionSummary) {
  const component = (await loadCardComponent(id))!
  return mount(component, { props: { summary } })
}

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

/** Resolve + mount a Year in Review card by registry id (#1018). */
async function mountRecapCard(id: string, recap: YearRecap) {
  const component = (await loadCardComponent(id))!
  return mount(component, { props: { recap } })
}

describe('share-card render smoke tests (issue #1188)', () => {
  describe('bold-flood (BoldFloodCard)', () => {
    it('surfaces total volume, unit noun, and the session stat trio', async () => {
      const wrapper = await mountCard('bold-flood', makeSummary())
      const text = wrapper.text()
      expect(text).toContain('24,850') // formatted totalVolume
      expect(text).toContain('Pounds moved') // lbs → "Pounds moved"
      expect(text).toContain('1h 14m') // duration
      expect(text).toContain('18') // setsCompleted
      expect(text).toContain('3') // prs + repPRs
    })

    it('labels the unit "Kilograms moved" when the summary is metric', async () => {
      const wrapper = await mountCard('bold-flood', makeSummary({ unitLabel: 'kg' }))
      expect(wrapper.text()).toContain('Kilograms moved')
    })
  })

  describe('receipt (ReceiptCard)', () => {
    it('itemizes highlights and totals the subtotal in display units', async () => {
      const wrapper = await mountCard('receipt', makeSummary())
      const text = wrapper.text()
      expect(text).toContain('APR 21') // date uppercased
      expect(text).toContain('Bench Press') // highlight name
      expect(text).toContain('225×5') // weight × reps
      expect(text).toContain('24,850 LBS') // subtotal + unit
      expect(text).toContain('2 WT') // prs
      expect(text).toContain('1 REP') // repPRs
    })

    it('truncates to a "+N more" line past 8 highlights', async () => {
      const highlights = Array.from({ length: 11 }, (_, i) =>
        makeHighlight({ exerciseId: `ex${i}`, name: `Lift ${i}` }),
      )
      const wrapper = await mountCard('receipt', makeSummary({ highlights }))
      const text = wrapper.text()
      expect(text).toContain('+3 more') // 11 - 8 = 3 hidden
      expect(text).not.toContain('Lift 8') // 9th highlight is hidden
    })
  })

  describe('week-chart (WeekChartCard)', () => {
    it('shows the week-over-week delta, weekly volume, and streak', async () => {
      const wrapper = await mountCard('week-chart', makeSummary())
      const text = wrapper.text()
      expect(text).toContain('Week Tue') // weekday-scoped eyebrow
      expect(text).toContain('+37%') // delta vs priorWeekVolume
      expect(text).toContain('24,850 lbs') // this-week total + unit
      expect(text).toContain('🔥 4wk') // streak
    })

    it('renders "NEW" when there is no prior-week baseline', async () => {
      const wrapper = await mountCard('week-chart', makeSummary({ priorWeekVolume: 0 }))
      expect(wrapper.text()).toContain('NEW')
    })
  })

  describe('best-set (BestSetCard)', () => {
    it('renders the best set and flags a personal record', async () => {
      const wrapper = await mountCard('best-set', makeSummary())
      const text = wrapper.text()
      expect(text).toContain('Bench Press')
      expect(text).toContain('225') // weight
      expect(text).toContain('5') // reps
      expect(text).toContain('~263 lbs e1RM')
      expect(text).toContain('New personal record')
    })

    it('labels a non-PR best set "Top set"', async () => {
      const summary = makeSummary({
        bestSet: { exerciseId: 'ex1', name: 'Bench Press', weight: 225, reps: 5, e1RM: 263, isPR: false },
      })
      const wrapper = await mountCard('best-set', summary)
      expect(wrapper.text()).toContain('Top set')
    })
  })

  describe('stat-grid (StatGridCard)', () => {
    it('fills the four stat cells from the summary', async () => {
      const wrapper = await mountCard('stat-grid', makeSummary())
      const text = wrapper.text()
      expect(text).toContain('24,850') // VOLUME cell
      expect(text).toContain('225×5') // BEST SET cell
      expect(text).toContain('18') // SETS cell
      expect(text).toContain('5 EXERCISES') // exercise count (plural)
      expect(text).toContain('3') // total PRs cell
    })

    it('degrades the best-set cell to a dash when there is no best set', async () => {
      const wrapper = await mountCard('stat-grid', makeSummary({ bestSet: null }))
      expect(wrapper.text()).toContain('—')
    })
  })

  describe('daily-ring (DailyRingCard)', () => {
    it('renders the goal-completion ring percent and session meta', async () => {
      // 24,850 ≥ 22,000 lbs goal → capped at 100%.
      const wrapper = await mountCard('daily-ring', makeSummary())
      const text = wrapper.text()
      expect(text).toContain('100%')
      expect(text).toContain('22,000') // formatted goal
      expect(text).toContain('24,850') // volume
      expect(text).toContain('18 sets')
      expect(text).toContain('3 PR')
    })

    it('renders a partial percent below goal', async () => {
      const wrapper = await mountCard('daily-ring', makeSummary({ totalVolume: 11000 }))
      expect(wrapper.text()).toContain('50%') // 11000 / 22000
    })
  })

  describe('ticket-stub (TicketStubCard)', () => {
    it('prints the headliner set and the volume stub', async () => {
      const wrapper = await mountCard('ticket-stub', makeSummary())
      const text = wrapper.text()
      expect(text).toContain('APR 21') // date uppercased
      expect(text).toContain('1h 14m') // duration
      expect(text).toContain('Bench Press') // headliner
      expect(text).toContain('225×5 lbs') // headliner stat
      expect(text).toContain('24,850') // volume stub
    })

    it('omits the headliner block when there is no best set but still prints the stub', async () => {
      const wrapper = await mountCard('ticket-stub', makeSummary({ bestSet: null }))
      const text = wrapper.text()
      expect(text).not.toContain('Headliner')
      expect(text).toContain('24,850')
    })
  })

  describe('pr-focus (PrFocusCard)', () => {
    it('celebrates the PR set with weight, reps and e1RM chip', async () => {
      const wrapper = await mountCard('pr-focus', makeSummary())
      const text = wrapper.text()
      expect(text).toContain('New personal record')
      expect(text).toContain('Bench Press')
      expect(text).toContain('225') // weight
      expect(text).toContain('5 reps')
      expect(text).toContain('263 lbs') // e1RM chip
    })
  })

  describe('bold-flood-story (BoldFloodStory)', () => {
    it('surfaces total volume and the session stat trio', async () => {
      const wrapper = await mountCard('bold-flood-story', makeSummary())
      const text = wrapper.text()
      expect(text).toContain('Total volume')
      expect(text).toContain('24,850')
      expect(text).toContain('Pounds moved')
      expect(text).toContain('1h 14m') // duration stat
      expect(text).toContain('18') // sets stat
      expect(text).toContain('3') // PRs stat
    })
  })

  describe('best-set-story (BestSetStory)', () => {
    it('renders the PR best set with reps and e1RM', async () => {
      const wrapper = await mountCard('best-set-story', makeSummary())
      const text = wrapper.text()
      expect(text).toContain('Personal record')
      expect(text).toContain('Bench Press')
      expect(text).toContain('225')
      expect(text).toContain('5 reps')
      expect(text).toContain('~263 lbs e1RM')
    })

    it('labels a non-PR best set "Best set"', async () => {
      const summary = makeSummary({
        bestSet: { exerciseId: 'ex1', name: 'Bench Press', weight: 225, reps: 5, e1RM: 263, isPR: false },
      })
      const wrapper = await mountCard('best-set-story', summary)
      expect(wrapper.text()).toContain('Best set')
    })
  })

  describe('week-chart-story (WeekChartStory)', () => {
    it('shows the delta, today volume, and streak', async () => {
      const wrapper = await mountCard('week-chart-story', makeSummary())
      const text = wrapper.text()
      expect(text).toContain('Week Tue')
      expect(text).toContain('+37%') // delta
      expect(text).toContain('24,850 lbs') // today total + unit
      expect(text).toContain('🔥 4wk') // streak
    })

    it('renders "NEW" when there is no prior-week baseline', async () => {
      const wrapper = await mountCard('week-chart-story', makeSummary({ priorWeekVolume: 0 }))
      expect(wrapper.text()).toContain('NEW')
    })
  })

  // ── Year in Review (#1018) ──────────────────────────────────────────
  //
  // The one bucket that doesn't consume a `SessionSummary`. Both designs read
  // the same `YearRecap` through the shared derivations in `yearRecap.ts`, so
  // a field rename breaks both at once — and unlike a session card, this one
  // is exported once a year into a social feed.

  describe('year-recap (YearRecapCard)', () => {
    it('renders the year, the volume brag, and the four headline stats', async () => {
      const wrapper = await mountRecapCard('year-recap', makeRecap())
      const text = wrapper.text()
      expect(text).toContain('2026')
      expect(text).toContain('1,250,400') // formatted totalVolume
      expect(text).toContain('lbs moved')
      expect(text).toContain('148') // workouts
      expect(text).toContain('2140') // sets
      expect(text).toContain('31') // PRs
      expect(text).toContain('19') // longest streak, weeks
    })

    it('names the best lift through the load label the aggregator decided', async () => {
      // `loadLabel` is produced by formatSetLoad at aggregation time
      // (LIFT-1373) — the card must print it verbatim rather than re-deriving
      // an ADDED weight beside a folded e1RM.
      const wrapper = await mountRecapCard(
        'year-recap',
        makeRecap({
          bestLift: { exerciseId: 'ex9', name: 'Weighted Pull-up', loadLabel: 'Bodyweight', reps: 12, e1RM: 224, dateKey: '2026-03-02' },
        }),
      )
      const text = wrapper.text()
      expect(text).toContain('Weighted Pull-up')
      expect(text).toContain('Bodyweight × 12')
      expect(text).not.toContain('0 lbs')
    })

    it('marks the busiest month on the twelve-month chart', async () => {
      const wrapper = await mountRecapCard('year-recap', makeRecap())
      // Twelve columns always render — an untrained month keeps a stub bar so
      // the axis still reads as a year.
      expect(wrapper.findAll('.yrBarCol')).toHaveLength(12)
      expect(wrapper.findAll('.yrBarPeak')).toHaveLength(1)
      expect(wrapper.find('.yrChart').attributes('aria-label')).toContain('busiest month Aug')
    })

    it('degrades to the stats alone when a year has no best lift or tagged work', async () => {
      const wrapper = await mountRecapCard('year-recap', makeRecap({ bestLift: null, topTag: null }))
      const text = wrapper.text()
      expect(text).not.toContain('Best lift')
      expect(text).not.toContain('Most trained')
      expect(text).toContain('1,250,400') // the headline survives
    })

    it('renders a flat axis and no peak bar for a zero-volume year', async () => {
      const wrapper = await mountRecapCard(
        'year-recap',
        makeRecap({ monthlyVolume: new Array(12).fill(0), busiestMonth: null, totalVolume: 0 }),
      )
      expect(wrapper.findAll('.yrBarCol')).toHaveLength(12)
      expect(wrapper.findAll('.yrBarPeak')).toHaveLength(0)
      expect(wrapper.find('.yrChart').attributes('aria-label')).toBe('Monthly training volume for 2026')
    })
  })

  describe('year-recap-story (YearRecapStory)', () => {
    it('renders the year, volume, stats and both highlight rows', async () => {
      const wrapper = await mountRecapCard('year-recap-story', makeRecap())
      const text = wrapper.text()
      expect(text).toContain('Year in Review')
      expect(text).toContain('2026')
      expect(text).toContain('1,250,400')
      expect(text).toContain('Deadlift')
      expect(text).toContain('405 lbs × 3')
      expect(text).toContain('~446 lbs e1RM')
      expect(text).toContain('Push')
      expect(text).toContain('620 sets across 22 exercises')
    })

    it('labels weights in the recap unit, not a hardcoded lbs', async () => {
      const wrapper = await mountRecapCard(
        'year-recap-story',
        makeRecap({ unitLabel: 'kg', totalVolume: 567_120, bestLift: { exerciseId: 'ex1', name: 'Deadlift', loadLabel: '184 kg', reps: 3, e1RM: 202, dateKey: '2026-08-14' } }),
      )
      const text = wrapper.text()
      expect(text).toContain('kg moved')
      expect(text).toContain('184 kg × 3')
      expect(text).toContain('~202 kg e1RM')
    })

    // The two formats are one recap in two layouts; the derivations are shared
    // (`yearRecap.ts`) precisely so they cannot disagree, and the chart's
    // accessible name is the half no visual check would catch.
    it('agrees with the square card on the stats and the chart label', async () => {
      const recap = makeRecap()
      const square = await mountRecapCard('year-recap', recap)
      const story = await mountRecapCard('year-recap-story', recap)

      expect(story.find('.yrsChart').attributes('aria-label')).toBe(
        square.find('.yrChart').attributes('aria-label'),
      )
      expect(story.findAll('.yrsStatValue').map((n) => n.text())).toEqual(
        square.findAll('.yrStatValue').map((n) => n.text()),
      )
    })
  })
})
