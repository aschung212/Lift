import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import type { BodyweightEntry } from '../../stores/bodyweight'
import { getLocalStorageMock, mockAnalytics, mockTheme, mockWeightUnit } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../composables/useAnalytics', () => mockAnalytics())
vi.mock('../../composables/useTheme', () => mockTheme())
vi.mock('../../composables/useWeightUnit', () => mockWeightUnit())
vi.mock('../../stores/progression', () => ({
  useProgressionStore: () => ({
    progressionEnabled: false,
    logBodyweightXP: vi.fn(),
    checkUnlocks: vi.fn().mockReturnValue([]),
  }),
}))
import { reactive } from 'vue'
import type { WeightGoalConfig } from '../../stores/preferences'

const mockWeightGoal = reactive<WeightGoalConfig>({
  direction: 'lose',
  loseTarget: null,
  gainTarget: null,
  maintainMin: null,
  maintainMax: null,
})

vi.mock('../../stores/preferences', () => ({
  usePreferencesStore: () => ({
    weightGoal: mockWeightGoal,
  }),
}))

// Reactive mock store
let entries: BodyweightEntry[] = []

vi.mock('../../stores/bodyweight', () => ({
  useBodyweightStore: () => ({
    get entries() { return entries },
    set entries(v: BodyweightEntry[]) { entries = v },
    get latestWeight() {
      if (!entries.length) return null
      const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date))
      return sorted[0].weight
    },
    get minWeight() {
      if (!entries.length) return null
      return Math.min(...entries.map(e => e.weight))
    },
    get maxWeight() {
      if (!entries.length) return null
      return Math.max(...entries.map(e => e.weight))
    },
    addEntry: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
  })
}))

import BodyweightTracker from '../../views/BodyweightTracker.vue'

function mountTracker(): VueWrapper {
  return mount(BodyweightTracker, {
    global: {
      stubs: { Teleport: true },
    }
  })
}

function makeEntry(id: string, weight: number, dateStr: string): BodyweightEntry {
  return { id, date: new Date(dateStr + 'T12:00:00').toISOString(), weight }
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
}

describe('BodyweightTracker', () => {
  beforeEach(() => {
    entries = []
    localStorageMock.clear()
    mockWeightGoal.direction = 'lose'
    mockWeightGoal.loseTarget = null
    mockWeightGoal.gainTarget = null
    mockWeightGoal.maintainMin = null
    mockWeightGoal.maintainMax = null
  })

  describe('empty state', () => {
    it('shows value proposition and CTA when no entries', () => {
      const wrapper = mountTracker()
      const empty = wrapper.find('.bwEmptyState')
      expect(empty.exists()).toBe(true)
      expect(empty.text()).toContain('Track your weight to spot trends')
      expect(empty.text()).toContain('same time each day')
      expect(empty.find('.bwEmptyCta').text()).toContain('+ Log')
    })

    it('renders "+ Log" button', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('.wtLogBtn').text()).toBe('+ Log')
    })

    it('does not show current weight summary', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('.bwSummary').exists()).toBe(false)
    })

    it('does not show period selector', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('.bwPeriodRow').exists()).toBe(false)
    })
  })

  describe('single entry', () => {
    beforeEach(() => {
      entries = [makeEntry('e-1', 170, daysAgo(2))]
    })

    it('shows current weight', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('.bwCurrentValue').text()).toContain('170')
      expect(wrapper.find('.bwCurrentValue').text()).toContain('lbs')
    })

    it('shows period selector', () => {
      const wrapper = mountTracker()
      const btns = wrapper.findAll('.bwPeriodBtn')
      expect(btns.map(b => b.text())).toEqual(['7d', '30d', '90d', '1y'])
    })

    it('shows single-entry prompt instead of stats', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('.bwStatsSingle').text()).toContain('Log at least 2 entries')
    })

    it('does not render SVG chart with only 1 day', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('svg').exists()).toBe(false)
    })

    it('renders the entry in the list', () => {
      const wrapper = mountTracker()
      const rows = wrapper.findAll('.wtSetRow')
      expect(rows.length).toBe(1)
      expect(rows[0].text()).toContain('170')
    })
  })

  describe('multiple entries', () => {
    beforeEach(() => {
      entries = [
        makeEntry('e-1', 172, daysAgo(25)),
        makeEntry('e-2', 170, daysAgo(18)),
        makeEntry('e-3', 168, daysAgo(10)),
        makeEntry('e-4', 169, daysAgo(2)),
      ]
    })

    it('shows latest weight as current', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('.bwCurrentValue').text()).toContain('169')
    })

    it('renders all entries in the list (newest first)', () => {
      const wrapper = mountTracker()
      const rows = wrapper.findAll('.wtSetRow')
      expect(rows.length).toBe(4)
      // First row should be most recent
      expect(rows[0].text()).toContain('169')
    })

    it('renders stats row with change, low, high, avg', () => {
      const wrapper = mountTracker()
      const statCards = wrapper.findAll('.bwStatCard')
      expect(statCards.length).toBe(4)
      expect(statCards[0].text()).toContain('Change')
      expect(statCards[1].text()).toContain('Low')
      expect(statCards[2].text()).toContain('High')
      expect(statCards[3].text()).toContain('Avg')
    })

    it('renders SVG chart with data points', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('svg').exists()).toBe(true)
      const dots = wrapper.findAll('circle')
      expect(dots.length).toBeGreaterThanOrEqual(2)
    })

    it('renders polyline for chart line', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('polyline').exists()).toBe(true)
    })

    it('highlights all-time low with badge', () => {
      const wrapper = mountTracker()
      const lowBadge = wrapper.find('.bwEntryBadge')
      expect(lowBadge.exists()).toBe(true)
      expect(lowBadge.text()).toContain('Low')
    })

    it('highlights all-time high with badge', () => {
      const wrapper = mountTracker()
      const badges = wrapper.findAll('.bwEntryBadge')
      const highBadge = badges.find(b => b.text().includes('High'))
      expect(highBadge).toBeDefined()
    })

    it('low badge is green when losing, red when gaining', () => {
      mockWeightGoal.direction = 'lose'
      let wrapper = mountTracker()
      expect(wrapper.find('.bwEntryBadgeGood').text()).toContain('Low')

      mockWeightGoal.direction = 'gain'
      wrapper = mountTracker()
      expect(wrapper.find('.bwEntryBadgeBad').text()).toContain('Low')
    })

    it('high badge is red when losing, green when gaining', () => {
      mockWeightGoal.direction = 'lose'
      let wrapper = mountTracker()
      expect(wrapper.find('.bwEntryBadgeBad').text()).toContain('High')

      mockWeightGoal.direction = 'gain'
      wrapper = mountTracker()
      expect(wrapper.find('.bwEntryBadgeGood').text()).toContain('High')
    })

    it('no row highlighting in maintain mode', () => {
      mockWeightGoal.direction = 'maintain'
      const wrapper = mountTracker()
      expect(wrapper.find('.bwEntryGood').exists()).toBe(false)
      expect(wrapper.find('.bwEntryBad').exists()).toBe(false)
    })

    it('shows delta from previous entry', () => {
      const wrapper = mountTracker()
      const deltas = wrapper.findAll('.bwDelta')
      expect(deltas.length).toBeGreaterThan(0)
    })

    it('chart has accessible role="img" and aria-label', () => {
      const wrapper = mountTracker()
      const svg = wrapper.find('svg')
      expect(svg.attributes('role')).toBe('img')
      expect(svg.attributes('aria-label')).toContain('Body weight')
    })
  })

  describe('period selection', () => {
    beforeEach(() => {
      entries = [
        makeEntry('e-1', 172, daysAgo(20)),
        makeEntry('e-2', 170, daysAgo(2)),
      ]
    })

    it('defaults to 30d period', () => {
      const wrapper = mountTracker()
      const activeBtn = wrapper.find('.bwPeriodBtn.active')
      expect(activeBtn.text()).toBe('30d')
    })

    it('switches period on button click', async () => {
      const wrapper = mountTracker()
      const btns = wrapper.findAll('.bwPeriodBtn')
      await btns[0].trigger('click')

      expect(wrapper.find('.bwPeriodBtn.active').text()).toBe('7d')
    })
  })

  describe('entry actions', () => {
    beforeEach(() => {
      entries = [makeEntry('e-1', 170, daysAgo(2))]
    })

    it('reveals edit/delete on entry tap', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtSetRow').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtSetActions').exists()).toBe(true)
      const btns = wrapper.findAll('.wtSetBtn')
      expect(btns.map(b => b.text())).toContain('Edit')
      expect(btns.map(b => b.text())).toContain('Delete')
    })

    it('hides actions on second tap', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtSetRow').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.wtSetActions').exists()).toBe(true)

      await wrapper.find('.wtSetRow').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.wtSetActions').exists()).toBe(false)
    })
  })

  describe('log modal', () => {
    it('opens modal when "+ Log" is clicked', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtLogBtn').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.repMaxModal').exists()).toBe(true)
      expect(wrapper.find('#bw-modal-title').text()).toBe('Log Weight')
    })

    it('shows date and weight inputs', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtLogBtn').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('input[type="date"]').exists()).toBe(true)
      expect(wrapper.find('input[type="number"]').exists()).toBe(true)
    })

    it('shows Save and Cancel buttons', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtLogBtn').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.repMaxBtnCalc').text()).toBe('Save')
      expect(wrapper.find('.repMaxBtnClose').text()).toBe('Cancel')
    })

    it('disables save when weight is empty', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtLogBtn').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.repMaxBtnCalc').attributes('disabled')).toBeDefined()
    })

    it('has accessible dialog role', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtLogBtn').trigger('click')
      await wrapper.vm.$nextTick()

      const dialog = wrapper.find('.repMaxModal')
      expect(dialog.attributes('role')).toBe('dialog')
      expect(dialog.attributes('aria-modal')).toBe('true')
    })
  })

  describe('entry list accessibility', () => {
    beforeEach(() => {
      entries = [makeEntry('e-1', 170, daysAgo(2))]
    })

    it('entry rows have role=button and tabindex=0', () => {
      const wrapper = mountTracker()
      const row = wrapper.find('.wtSetRow')
      expect(row.attributes('role')).toBe('button')
      expect(row.attributes('tabindex')).toBe('0')
    })

    it('entry rows have aria-expanded reflecting action visibility', async () => {
      const wrapper = mountTracker()
      const row = wrapper.find('.wtSetRow')
      expect(row.attributes('aria-expanded')).toBe('false')

      await row.trigger('click')
      await wrapper.vm.$nextTick()
      expect(row.attributes('aria-expanded')).toBe('true')
    })

    it('entry rows have descriptive aria-label', () => {
      const wrapper = mountTracker()
      const row = wrapper.find('.wtSetRow')
      const label = row.attributes('aria-label')
      expect(label).toContain('170')
      expect(label).toContain('lbs')
    })

    it('entry rows respond to Enter key', async () => {
      const wrapper = mountTracker()
      const row = wrapper.find('.wtSetRow')
      await row.trigger('keydown.enter')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.wtSetActions').exists()).toBe(true)
    })

    it('entry rows respond to Space key', async () => {
      const wrapper = mountTracker()
      const row = wrapper.find('.wtSetRow')
      await row.trigger('keydown.space')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.wtSetActions').exists()).toBe(true)
    })
  })

  describe('weight goal delta coloring', () => {
    beforeEach(() => {
      // Three entries: 175 → 173 → 170 (losing trend)
      entries = [
        makeEntry('e-1', 175, daysAgo(20)),
        makeEntry('e-2', 173, daysAgo(10)),
        makeEntry('e-3', 170, daysAgo(2)),
      ]
    })

    it('losing goal: weight drop is green (bwDeltaGood)', () => {
      mockWeightGoal.direction = 'lose'
      const wrapper = mountTracker()
      const deltas = wrapper.findAll('.bwDelta')
      // Latest entry (170) is -3 from previous (173) → good for losing
      const latestDelta = deltas[0]
      expect(latestDelta.classes()).toContain('bwDeltaGood')
    })

    it('gaining goal: weight drop is red (bwDeltaBad)', () => {
      mockWeightGoal.direction = 'gain'
      const wrapper = mountTracker()
      const deltas = wrapper.findAll('.bwDelta')
      const latestDelta = deltas[0]
      expect(latestDelta.classes()).toContain('bwDeltaBad')
    })

    it('gaining goal: weight increase is green', () => {
      // Reverse the trend: 170 → 173 → 175 (gaining)
      entries = [
        makeEntry('e-1', 170, daysAgo(20)),
        makeEntry('e-2', 173, daysAgo(10)),
        makeEntry('e-3', 175, daysAgo(2)),
      ]
      mockWeightGoal.direction = 'gain'
      const wrapper = mountTracker()
      const deltas = wrapper.findAll('.bwDelta')
      expect(deltas[0].classes()).toContain('bwDeltaGood')
    })

    it('maintain with no range: deltas are neutral', () => {
      mockWeightGoal.direction = 'maintain'
      const wrapper = mountTracker()
      const deltas = wrapper.findAll('.bwDelta')
      expect(deltas[0].classes()).not.toContain('bwDeltaGood')
      expect(deltas[0].classes()).not.toContain('bwDeltaBad')
    })

    it('maintain with max only: under max is neutral', () => {
      mockWeightGoal.direction = 'maintain'
      mockWeightGoal.maintainMax = 180
      const wrapper = mountTracker()
      const deltas = wrapper.findAll('.bwDelta')
      // 170 is under 180 max, delta is neutral
      expect(deltas[0].classes()).not.toContain('bwDeltaBad')
    })

    it('maintain with max only: over max, losing is good', () => {
      mockWeightGoal.direction = 'maintain'
      mockWeightGoal.maintainMax = 165 // all entries are above this
      const wrapper = mountTracker()
      const deltas = wrapper.findAll('.bwDelta')
      // 170 is above 165 max, and delta is -3 (losing) → good
      expect(deltas[0].classes()).toContain('bwDeltaGood')
    })

    it('maintain with min only: above min is neutral', () => {
      mockWeightGoal.direction = 'maintain'
      mockWeightGoal.maintainMin = 160
      const wrapper = mountTracker()
      const deltas = wrapper.findAll('.bwDelta')
      // 170 is above 160 min, delta is neutral
      expect(deltas[0].classes()).not.toContain('bwDeltaBad')
    })

    it('maintain with min only: below min, gaining is good', () => {
      mockWeightGoal.direction = 'maintain'
      mockWeightGoal.maintainMin = 180 // all entries below this
      const wrapper = mountTracker()
      const deltas = wrapper.findAll('.bwDelta')
      // 170 is below 180 min, and delta is -3 (losing) → bad
      expect(deltas[0].classes()).toContain('bwDeltaBad')
    })

    it('maintain with both bounds: within range is neutral', () => {
      mockWeightGoal.direction = 'maintain'
      mockWeightGoal.maintainMin = 160
      mockWeightGoal.maintainMax = 180
      const wrapper = mountTracker()
      const deltas = wrapper.findAll('.bwDelta')
      // 170 is within 160-180, neutral
      expect(deltas[0].classes()).not.toContain('bwDeltaGood')
      expect(deltas[0].classes()).not.toContain('bwDeltaBad')
    })
  })

  describe('maintain mode weight highlighting', () => {
    beforeEach(() => {
      entries = [
        makeEntry('e-1', 175, daysAgo(20)),
        makeEntry('e-2', 173, daysAgo(10)),
        makeEntry('e-3', 170, daysAgo(2)),
      ]
    })

    it('marks weight as out of range when above max', () => {
      mockWeightGoal.direction = 'maintain'
      mockWeightGoal.maintainMax = 172
      const wrapper = mountTracker()
      const outOfRange = wrapper.findAll('.bwWeightOutOfRange')
      // 175 and 173 are above 172 max
      expect(outOfRange.length).toBe(2)
    })

    it('marks weight as out of range when below min', () => {
      mockWeightGoal.direction = 'maintain'
      mockWeightGoal.maintainMin = 172
      const wrapper = mountTracker()
      const outOfRange = wrapper.findAll('.bwWeightOutOfRange')
      // 170 is below 172 min
      expect(outOfRange.length).toBe(1)
    })

    it('no out-of-range marking when within bounds', () => {
      mockWeightGoal.direction = 'maintain'
      mockWeightGoal.maintainMin = 160
      mockWeightGoal.maintainMax = 180
      const wrapper = mountTracker()
      expect(wrapper.find('.bwWeightOutOfRange').exists()).toBe(false)
    })

    it('no weight highlighting outside maintain mode', () => {
      mockWeightGoal.direction = 'lose'
      const wrapper = mountTracker()
      expect(wrapper.find('.bwWeightOutOfRange').exists()).toBe(false)
    })
  })

  describe('entry row highlighting', () => {
    beforeEach(() => {
      entries = [
        makeEntry('e-1', 175, daysAgo(20)),
        makeEntry('e-2', 173, daysAgo(10)),
        makeEntry('e-3', 170, daysAgo(2)),
      ]
    })

    it('losing: low entry gets good row class, high gets bad', () => {
      mockWeightGoal.direction = 'lose'
      const wrapper = mountTracker()
      expect(wrapper.find('.bwEntryGood').exists()).toBe(true)
      expect(wrapper.find('.bwEntryBad').exists()).toBe(true)
    })

    it('gaining: high entry gets good row class, low gets bad', () => {
      mockWeightGoal.direction = 'gain'
      const wrapper = mountTracker()
      const goodRow = wrapper.find('.bwEntryGood')
      const badRow = wrapper.find('.bwEntryBad')
      expect(goodRow.exists()).toBe(true)
      expect(badRow.exists()).toBe(true)
    })
  })

  describe('chart goal indicators', () => {
    beforeEach(() => {
      entries = [
        makeEntry('e-1', 175, daysAgo(20)),
        makeEntry('e-2', 173, daysAgo(10)),
        makeEntry('e-3', 170, daysAgo(2)),
      ]
    })

    it('shows goal tag when lose target is set', () => {
      mockWeightGoal.direction = 'lose'
      mockWeightGoal.loseTarget = 165
      const wrapper = mountTracker()
      const tag = wrapper.find('.bwGoalTag')
      expect(tag.exists()).toBe(true)
      expect(tag.text()).toContain('Goal')
    })

    it('shows goal tag when gain target is set', () => {
      mockWeightGoal.direction = 'gain'
      mockWeightGoal.gainTarget = 185
      const wrapper = mountTracker()
      const tag = wrapper.find('.bwGoalTag')
      expect(tag.exists()).toBe(true)
      expect(tag.text()).toContain('Goal')
    })

    it('shows range tag in maintain mode', () => {
      mockWeightGoal.direction = 'maintain'
      mockWeightGoal.maintainMin = 168
      mockWeightGoal.maintainMax = 175
      const wrapper = mountTracker()
      const tag = wrapper.find('.bwGoalTag')
      expect(tag.exists()).toBe(true)
      expect(tag.text()).toContain('Range')
    })

    it('no goal tag when no target is set', () => {
      mockWeightGoal.direction = 'lose'
      const wrapper = mountTracker()
      expect(wrapper.find('.bwGoalTag').exists()).toBe(false)
    })

    it('draws goal line on chart when target is within data range', () => {
      mockWeightGoal.direction = 'lose'
      mockWeightGoal.loseTarget = 172 // within 170-175 data range
      const wrapper = mountTracker()
      const goalLines = wrapper.findAll('.bwGoalLine')
      expect(goalLines.length).toBe(1)
    })

    it('draws range boundary lines in maintain mode', () => {
      mockWeightGoal.direction = 'maintain'
      mockWeightGoal.maintainMin = 168
      mockWeightGoal.maintainMax = 176
      const wrapper = mountTracker()
      const goalLines = wrapper.findAll('.bwGoalLine')
      expect(goalLines.length).toBe(2)
    })
  })

  describe('chart dot rendering', () => {
    it('shows dots for each data point on 30d view', () => {
      // Use dates within 30d of "now" so they're all visible
      const now = new Date()
      entries = [
        makeEntry('e-1', 175, new Date(now.getTime() - 20 * 86400000).toISOString().slice(0, 10)),
        makeEntry('e-2', 173, new Date(now.getTime() - 10 * 86400000).toISOString().slice(0, 10)),
        makeEntry('e-3', 170, new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10)),
      ]
      const wrapper = mountTracker()
      const dots = wrapper.findAll('.bwEndpointDot')
      expect(dots.length).toBe(3)
    })

    it('shows only 2 endpoint dots on 90d view', async () => {
      const now = new Date()
      entries = [
        makeEntry('e-1', 175, new Date(now.getTime() - 80 * 86400000).toISOString().slice(0, 10)),
        makeEntry('e-2', 173, new Date(now.getTime() - 40 * 86400000).toISOString().slice(0, 10)),
        makeEntry('e-3', 170, new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10)),
      ]
      const wrapper = mountTracker()
      // Switch to 90d
      const btns = wrapper.findAll('.bwPeriodBtn')
      const btn90 = btns.find(b => b.text() === '90d')!
      await btn90.trigger('click')
      await wrapper.vm.$nextTick()
      const dots = wrapper.findAll('.bwEndpointDot')
      expect(dots.length).toBe(2)
    })
  })

  describe('goal progress hint', () => {
    beforeEach(() => {
      entries = [
        makeEntry('e-1', 175, daysAgo(20)),
        makeEntry('e-2', 173, daysAgo(10)),
        makeEntry('e-3', 170, daysAgo(2)),
      ]
    })

    it('shows down arrow and distance when losing', () => {
      mockWeightGoal.direction = 'lose'
      mockWeightGoal.loseTarget = 165
      const wrapper = mountTracker()
      const hint = wrapper.find('.bwGoalProgressHint')
      expect(hint.exists()).toBe(true)
      expect(hint.text()).toContain('↓')
      expect(hint.text()).toContain('to goal')
    })

    it('shows up arrow and distance when gaining', () => {
      mockWeightGoal.direction = 'gain'
      mockWeightGoal.gainTarget = 185
      const wrapper = mountTracker()
      const hint = wrapper.find('.bwGoalProgressHint')
      expect(hint.text()).toContain('↑')
      expect(hint.text()).toContain('to goal')
    })

    it('shows checkmark when at or past goal (losing)', () => {
      mockWeightGoal.direction = 'lose'
      mockWeightGoal.loseTarget = 175 // latest is 170, already past goal
      const wrapper = mountTracker()
      const hint = wrapper.find('.bwGoalProgressHint')
      expect(hint.text()).toContain('✓')
      expect(hint.text()).toContain('At goal')
    })

    it('shows checkmark when at or past goal (gaining)', () => {
      mockWeightGoal.direction = 'gain'
      mockWeightGoal.gainTarget = 165 // latest is 170, already past goal
      const wrapper = mountTracker()
      const hint = wrapper.find('.bwGoalProgressHint')
      expect(hint.text()).toContain('✓')
      expect(hint.text()).toContain('At goal')
    })

    it('shows within range for maintain mode', () => {
      mockWeightGoal.direction = 'maintain'
      mockWeightGoal.maintainMin = 160
      mockWeightGoal.maintainMax = 180
      const wrapper = mountTracker()
      const hint = wrapper.find('.bwGoalProgressHint')
      expect(hint.text()).toContain('Within range')
    })

    it('shows below range for maintain mode', () => {
      mockWeightGoal.direction = 'maintain'
      mockWeightGoal.maintainMin = 175 // latest 170 is below
      const wrapper = mountTracker()
      const hint = wrapper.find('.bwGoalProgressHint')
      expect(hint.text()).toContain('below range')
    })

    it('shows above range for maintain mode', () => {
      mockWeightGoal.direction = 'maintain'
      mockWeightGoal.maintainMax = 165 // latest 170 is above
      const wrapper = mountTracker()
      const hint = wrapper.find('.bwGoalProgressHint')
      expect(hint.text()).toContain('above range')
    })

    it('hint is empty when no target is set', () => {
      mockWeightGoal.direction = 'lose'
      const wrapper = mountTracker()
      expect(wrapper.find('.bwGoalProgressHint').text()).toBe('')
    })
  })

  describe('hero layout', () => {
    it('shows current weight as hero without title row', () => {
      entries = [makeEntry('e-1', 172, daysAgo(2))]
      const wrapper = mountTracker()
      expect(wrapper.find('.bwCurrentValue').text()).toContain('172')
      // No "Body Weight" title — the weight IS the identity
      expect(wrapper.find('.wtTitle').exists()).toBe(false)
    })

    it('shows log button in hero row', () => {
      entries = [makeEntry('e-1', 172, daysAgo(2))]
      const wrapper = mountTracker()
      const hero = wrapper.find('.bwHero')
      expect(hero.find('.wtLogBtn').exists()).toBe(true)
    })

    // LIFT-856: the hero shows the current weight value, not a title — so the view
    // had no page-level <h1>, breaking heading navigation across tab switches. A
    // single visually-hidden h1 gives assistive tech a consistent landmark.
    it('provides a single visually-hidden h1 page heading for assistive tech', () => {
      const wrapper = mountTracker()
      const h1s = wrapper.findAll('h1')
      expect(h1s.length).toBe(1)
      expect(h1s[0].text()).toBe('Weight')
      expect(h1s[0].classes()).toContain('srOnly')
    })

    // LIFT-856: the "Weight Over Time" chart title is the one section heading
    // under the page <h1>. It's exposed via role/aria-level (not a native <h2>)
    // to avoid a UA-margin shift inside the baseline-aligned flex header.
    it('exposes the chart title as a level-2 section heading', () => {
      entries = [
        makeEntry('e-1', 175, daysAgo(20)),
        makeEntry('e-2', 170, daysAgo(2)),
      ]
      const wrapper = mountTracker()
      const title = wrapper.find('.wtGraphTitle')
      expect(title.exists()).toBe(true)
      expect(title.text()).toBe('Weight Over Time')
      expect(title.attributes('role')).toBe('heading')
      expect(title.attributes('aria-level')).toBe('2')
    })
  })

  describe('a11y: sentiment indicators (WCAG 1.4.1 — not color alone)', () => {
    beforeEach(() => {
      entries = [
        makeEntry('e-1', 175, daysAgo(10)),
        makeEntry('e-2', 172, daysAgo(7)),
        makeEntry('e-3', 170, daysAgo(3)),
        makeEntry('e-4', 169, daysAgo(1)),
      ]
    })

    it('shows ✓ sentiment icon on change stat when direction is favorable', () => {
      mockWeightGoal.direction = 'lose'
      const wrapper = mountTracker()
      const changeStat = wrapper.findAll('.bwStatCard')[0]
      const sentiment = changeStat.find('.bwSentiment')
      expect(sentiment.exists()).toBe(true)
      expect(sentiment.text()).toBe('✓')
      expect(sentiment.attributes('aria-label')).toBe('on track')
    })

    it('shows ✗ sentiment icon on change stat when direction is unfavorable', () => {
      mockWeightGoal.direction = 'gain'
      const wrapper = mountTracker()
      const changeStat = wrapper.findAll('.bwStatCard')[0]
      const sentiment = changeStat.find('.bwSentiment')
      expect(sentiment.exists()).toBe(true)
      expect(sentiment.text()).toBe('✗')
      expect(sentiment.attributes('aria-label')).toBe('off track')
    })

    it('shows sentiment icons on entry deltas', () => {
      mockWeightGoal.direction = 'lose'
      const wrapper = mountTracker()
      const sentiments = wrapper.findAll('.bwDelta .bwSentiment')
      expect(sentiments.length).toBeGreaterThan(0)
      // Losing weight when goal is "lose" should be on track
      expect(sentiments.some(s => s.text() === '✓')).toBe(true)
    })

    it('does not show sentiment when goal is maintain and within range', () => {
      mockWeightGoal.direction = 'maintain'
      mockWeightGoal.maintainMin = 165
      mockWeightGoal.maintainMax = 180
      const wrapper = mountTracker()
      const changeStat = wrapper.findAll('.bwStatCard')[0]
      const sentiment = changeStat.find('.bwSentiment')
      // Within range → neutral → no sentiment shown
      expect(sentiment.exists()).toBe(false)
    })
  })
})
