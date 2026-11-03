/**
 * SessionPlanCard — the guided "repeat your last session" card (#1256),
 * extracted from WorkoutTracker as a props + emits child (LIFT-1449).
 *
 * Until the extraction the card could only be reached by mounting the whole
 * tracker behind ~250 lines of store and composable mocks, which is why its
 * analytics events, its day label and its kg wording had never been asserted
 * at all. The tracker suite keeps its integration cases (the tag chips scope
 * the card, a search hides it, a tapped row opens the log sheet); this file
 * pins the card's own contract:
 *
 *  - it derives the plan from the scope it is handed, in the order it is
 *    handed, and renders nothing when there is no earlier day to repeat;
 *  - the open state is the HOST's (`v-model:expanded`), because the card
 *    unmounts while a search is active and while the timeline is showing;
 *  - a row is a read-back of a logged set, so its top set is worded with the
 *    bodyweight that set captured (LIFT-1373), never today's.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { enableAutoUnmount, mount, VueWrapper } from '@vue/test-utils'
import type { Exercise, WorkoutSet } from '../../stores/workout'
import { localDateKey } from '../../lib/dates'
import { epley } from '../../lib/epley'
import { runComponentAxe } from '../../__tests__/axeHelper'
import { withTZ } from '../../__tests__/helpers'
import SessionPlanCard from '../SessionPlanCard.vue'

// Axe needs an attached tree, and every mount here renders the same list id.
enableAutoUnmount(afterEach)

const { logEvent, unit } = vi.hoisted(() => ({
  logEvent: vi.fn(),
  unit: { value: 'lbs' as 'lbs' | 'kg' },
}))

vi.mock('../../composables/useAnalytics', () => ({
  useAnalytics: () => ({ logEvent, tabSwitch: vi.fn(), flushEngagement: vi.fn() }),
}))

vi.mock('../../composables/useWeightUnit', () => ({
  useWeightUnit: () => ({
    weightUnit: unit,
    displayWeight: (lbs: number) => (unit.value === 'kg' ? +(lbs * 0.453592).toFixed(1) : Math.round(lbs)),
    toLbs: (w: number) => w,
  }),
}))

/** Frozen "now": a Thursday at local noon, so no fixture straddles midnight. */
const NOW = () => new Date(2026, 2, 12, 12, 0, 0)

/** The local day `daysAgo` days before the frozen now. */
function localDay(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return localDateKey(d)
}

/** `endOfDayISO(day)`'s shape, as a UI-logged set stores it: the prefix IS the local day (#746). */
function loggedOn(daysAgo: number): string {
  return `${localDay(daysAgo)}T23:59:00.000Z`
}

function set(id: string, daysAgo: number, weight: number, reps: number, extra: Partial<WorkoutSet> = {}): WorkoutSet {
  return { id, date: loggedOn(daysAgo), weight, reps, estimated1RM: epley(weight, reps), ...extra }
}

/** Bench + OHP trained 2 days ago (the session to repeat); Squat 5 days ago. */
function scope(): Exercise[] {
  return [
    { id: 'ex-1', name: 'Bench Press', tags: ['Push'], sets: [set('b1', 2, 135, 10), set('b2', 2, 185, 5)] },
    { id: 'ex-2', name: 'Overhead Press', tags: ['Push'], sets: [set('o1', 2, 95, 8)] },
    { id: 'ex-3', name: 'Squat', tags: ['Legs'], sets: [set('q1', 5, 225, 5)] },
  ]
}

interface MountOptions {
  exercises?: Exercise[]
  tagFilters?: string[]
  expanded?: boolean
  /** Wire `update:expanded` back into the prop, as the host's `v-model:expanded` does. */
  vModel?: boolean
}

function mountCard(options: MountOptions = {}): VueWrapper {
  const wrapper: VueWrapper = mount(SessionPlanCard, {
    props: {
      exercises: options.exercises ?? scope(),
      tagFilters: options.tagFilters ?? [],
      expanded: options.expanded ?? false,
      ...(options.vModel === false
        ? {}
        : { 'onUpdate:expanded': (expanded: boolean) => wrapper.setProps({ expanded }) }),
    },
    attachTo: document.body,
  })
  return wrapper
}

const rowNames = (wrapper: VueWrapper) => wrapper.findAll('.wtSessionPlanName').map(n => n.text())

describe('SessionPlanCard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW())
    logEvent.mockClear()
    unit.value = 'lbs'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('the plan', () => {
    it('renders nothing when the scope has no earlier day to repeat', () => {
      const wrapper = mountCard({
        exercises: [
          { id: 'ex-1', name: 'Bench Press', tags: [], sets: [set('t1', 0, 135, 10)] },
          { id: 'ex-2', name: 'Row', tags: [], sets: [] },
        ],
      })
      expect(wrapper.find('.wtSessionPlan').exists()).toBe(false)
    })

    it('summarizes the most recent earlier session while collapsed', () => {
      const wrapper = mountCard()
      const toggle = wrapper.find('.wtSessionPlanToggle')
      expect(toggle.find('.wtSessionPlanTitle').text()).toBe('Repeat last session')
      expect(toggle.find('.wtSessionPlanMeta').text()).toContain('2 exercises · 3 sets ·')
      expect(toggle.attributes('aria-expanded')).toBe('false')
      expect(wrapper.find('.wtSessionPlanList').exists()).toBe(false)
    })

    it('names the session after the active tag only when exactly one is active', () => {
      expect(mountCard({ tagFilters: ['Push'] }).find('.wtSessionPlanTitle').text())
        .toBe('Repeat last Push session')
      expect(mountCard({ tagFilters: ['Push', 'Legs'] }).find('.wtSessionPlanTitle').text())
        .toBe('Repeat last session')
    })

    it('lists the reference day only, in the order the host passed', () => {
      // Store order, not recency or name: the rows must not reshuffle as
      // today's sets land (#1256), so the card may not re-sort what it is given.
      const [bench, ohp, squat] = scope()
      const wrapper = mountCard({ exercises: [ohp, squat, bench], expanded: true })
      expect(rowNames(wrapper)).toEqual(['Overhead Press', 'Bench Press'])
      expect(wrapper.findAll('.wtSessionPlanRowMeta')[1].text()).toBe('2 sets · top 185 lbs × 5')
    })

    it('counts today toward the plan and marks the rows it completes', () => {
      const exercises = scope()
      exercises[1].sets.push(set('o-today', 0, 95, 8))
      const wrapper = mountCard({ exercises, expanded: true })

      expect(wrapper.find('.wtSessionPlanMeta').text()).toContain('1/3 sets ·')
      const rows = wrapper.findAll('.wtSessionPlanRow')
      expect(rows[0].classes()).not.toContain('wtSessionPlanRowDone')
      expect(rows[0].find('.wtSessionPlanProgress').text()).toBe('0/2')
      expect(rows[1].classes()).toContain('wtSessionPlanRowDone')
      expect(rows[1].find('.wtSessionPlanCheck').exists()).toBe(true)
    })

    it('follows a set logged while mounted once the host hands it a fresh array', async () => {
      // The store mutates exercises in place, so the card only sees a new set
      // through a fresh-identity prop (#963); the tracker binds a computed that
      // re-filters on every store trigger.
      const exercises = scope()
      const wrapper = mountCard({ exercises, expanded: true })
      expect(wrapper.find('.wtSessionPlanMeta').text()).toContain('2 exercises · 3 sets')

      exercises[0].sets.push(set('b-today', 0, 135, 10))
      await wrapper.setProps({ exercises: [...exercises] })

      expect(wrapper.find('.wtSessionPlanMeta').text()).toContain('1/3 sets')
      expect(wrapper.findAll('.wtSessionPlanProgress')[0].text()).toBe('1/2')
    })
  })

  describe('the disclosure', () => {
    it('asks the host to open it, and records the expansion', async () => {
      const wrapper = mountCard()
      await wrapper.find('.wtSessionPlanToggle').trigger('click')

      expect(wrapper.emitted('update:expanded')).toEqual([[true]])
      expect(logEvent).toHaveBeenCalledWith('session_plan_expanded', { exercises: 2 })
      const toggle = wrapper.find('.wtSessionPlanToggle')
      expect(toggle.attributes('aria-expanded')).toBe('true')
      expect(wrapper.find('.wtSessionPlanList').attributes('id')).toBe(toggle.attributes('aria-controls'))
    })

    it('collapses without recording anything', async () => {
      const wrapper = mountCard({ expanded: true })
      await wrapper.find('.wtSessionPlanToggle').trigger('click')

      expect(wrapper.emitted('update:expanded')).toEqual([[false]])
      expect(logEvent).not.toHaveBeenCalled()
      expect(wrapper.find('.wtSessionPlanList').exists()).toBe(false)
    })

    it('shows the state its host holds, not one of its own', async () => {
      // Mounted open — what a host does when the card returns after a search
      // or a trip to the timeline — it renders the checklist without a tap.
      expect(mountCard({ expanded: true }).find('.wtSessionPlanList').exists()).toBe(true)

      // And a tap the host does not take up changes nothing on screen.
      const unbound = mountCard({ vModel: false })
      await unbound.find('.wtSessionPlanToggle').trigger('click')
      expect(unbound.emitted('update:expanded')).toEqual([[true]])
      expect(unbound.find('.wtSessionPlanList').exists()).toBe(false)
    })
  })

  describe('a row', () => {
    it('records the tap and hands its exercise to the host', async () => {
      const wrapper = mountCard({ expanded: true })
      await wrapper.findAll('.wtSessionPlanRow')[1].trigger('click')

      expect(logEvent).toHaveBeenCalledWith('session_plan_item_tapped', {})
      expect(wrapper.emitted('log-exercise')).toEqual([['ex-2']])
    })

    it('is named for its exercise and its progress, capped at the plan', () => {
      const exercises = scope()
      exercises[1].sets.push(set('o-t1', 0, 95, 8), set('o-t2', 0, 95, 8))
      const wrapper = mountCard({ exercises, expanded: true })
      const labels = wrapper.findAll('.wtSessionPlanRow').map(r => r.attributes('aria-label'))
      expect(labels).toEqual([
        'Bench Press, 0 of 2 sets done. Log a set.',
        'Overhead Press, 1 of 1 sets done. Log a set.',
      ])
    })
  })

  describe('the top set is a read-back (LIFT-1373)', () => {
    const BODYWEIGHT = 170

    function pullUp(sets: WorkoutSet[]): Exercise[] {
      return [{ id: 'ex-1', name: 'Pull-Up', tags: [], bodyweightLoaded: true, sets }]
    }

    it('names a bodyweight-only top set instead of printing 0', () => {
      const wrapper = mountCard({
        exercises: pullUp([
          set('p1', 2, 0, 12, { bodyweight: BODYWEIGHT, estimated1RM: epley(BODYWEIGHT, 12) }),
          set('p2', 2, 0, 10, { bodyweight: BODYWEIGHT, estimated1RM: epley(BODYWEIGHT, 10) }),
        ]),
        expanded: true,
      })
      const meta = wrapper.find('.wtSessionPlanRowMeta').text()
      expect(meta).toBe('2 sets · top Bodyweight × 12')
    })

    it('marks an added top set with "+", converted into kg', () => {
      unit.value = 'kg'
      const wrapper = mountCard({
        exercises: pullUp([
          set('p1', 2, 25, 5, { bodyweight: BODYWEIGHT, estimated1RM: epley(BODYWEIGHT + 25, 5) }),
        ]),
        expanded: true,
      })
      expect(wrapper.find('.wtSessionPlanRowMeta').text()).toBe('1 set · top +11.3 kg × 5')
    })

    it('keeps the bare number for a top set that captured no bodyweight', () => {
      // Logged before any weigh-in, it folded nothing, so its e1RM is off the
      // bare weight. The card cannot see today's bodyweight and must not claim
      // one the set never recorded.
      const wrapper = mountCard({ exercises: pullUp([set('p1', 2, 0, 12)]), expanded: true })
      expect(wrapper.find('.wtSessionPlanRowMeta').text()).toBe('1 set · top 0 lbs × 12')
    })
  })

  describe('the day label', () => {
    /** The label the card owes for `daysAgo`, built from local date parts, never by parsing a key. */
    function expectedLabel(daysAgo: number): string {
      const d = new Date()
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo)
        .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    }

    it('names the reference day on its local calendar date, on both sides of UTC', () => {
      const offsetBefore = new Date(2026, 0, 1).getTimezoneOffset()
      // An evening in Los Angeles is already tomorrow in UTC, and a morning in
      // Tokyo is still yesterday there; parsing the day key as UTC midnight
      // would label the session a day early in the first zone.
      for (const [tz, hour] of [['America/Los_Angeles', 20], ['Asia/Tokyo', 8]] as const) {
        withTZ(tz, () => {
          vi.setSystemTime(new Date(2026, 2, 12, hour, 0, 0))
          const wrapper = mountCard()
          expect(wrapper.find('.wtSessionPlanMeta').text(), tz).toBe(`2 exercises · 3 sets · ${expectedLabel(2)}`)
          wrapper.unmount()
        })
      }
      // The pinned zone must not outlive the test.
      expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(offsetBefore)
    })
  })

  describe('accessibility', () => {
    it('passes axe collapsed and expanded', async () => {
      const wrapper = mountCard()
      expect(await runComponentAxe(wrapper.element)).toHaveNoViolations()

      await wrapper.find('.wtSessionPlanToggle').trigger('click')
      expect(wrapper.find('.wtSessionPlanList').exists()).toBe(true)
      expect(await runComponentAxe(wrapper.element)).toHaveNoViolations()
    })
  })
})
