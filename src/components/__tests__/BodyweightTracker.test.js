import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// Stub localStorage
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val) }),
    removeItem: vi.fn(key => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()
vi.stubGlobal('localStorage', localStorageMock)

// Mock supabase
vi.mock('../../lib/supabase', () => ({ supabase: null }))

// Mock analytics
vi.mock('../../composables/useAnalytics', () => ({
  useAnalytics: () => ({
    logEvent: vi.fn(),
  })
}))

// Mock useTheme
vi.mock('../../composables/useTheme', () => ({
  useTheme: () => ({
    weightUnit: { value: 'lbs' },
    displayWeight: (w) => Math.round(w),
    toLbs: (w) => w,
  })
}))

// Reactive mock store
let entries = []

vi.mock('../../stores/bodyweight', () => ({
  useBodyweightStore: () => ({
    get entries() { return entries },
    set entries(v) { entries = v },
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

import BodyweightTracker from '../BodyweightTracker.vue'

function mountTracker() {
  return mount(BodyweightTracker, {
    global: {
      stubs: { Teleport: true },
    }
  })
}

function makeEntry(id, weight, dateStr) {
  return { id, date: new Date(dateStr + 'T12:00:00').toISOString(), weight }
}

describe('BodyweightTracker', () => {
  beforeEach(() => {
    entries = []
    localStorageMock.clear()
  })

  describe('empty state', () => {
    it('shows empty message when no entries', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('.wtEmpty').text()).toContain('No entries yet')
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
      entries = [makeEntry('e-1', 170, '2026-03-30')]
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
      expect(wrapper.find('.bwStatsSingle').text()).toContain('Only 1 entry')
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
        makeEntry('e-1', 172, '2026-03-01'),
        makeEntry('e-2', 170, '2026-03-10'),
        makeEntry('e-3', 168, '2026-03-20'),
        makeEntry('e-4', 169, '2026-03-30'),
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

    it('renders polyline and polygon for chart line and area', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('polyline').exists()).toBe(true)
      expect(wrapper.find('polygon').exists()).toBe(true)
    })

    it('highlights all-time low with badge', () => {
      const wrapper = mountTracker()
      const lowBadge = wrapper.find('.bwEntryBadgeLow')
      expect(lowBadge.exists()).toBe(true)
      expect(lowBadge.text()).toContain('Low')
    })

    it('highlights all-time high with badge', () => {
      const wrapper = mountTracker()
      const highBadge = wrapper.find('.bwEntryBadgeHigh')
      expect(highBadge.exists()).toBe(true)
      expect(highBadge.text()).toContain('High')
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
        makeEntry('e-1', 172, '2026-03-01'),
        makeEntry('e-2', 170, '2026-03-30'),
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
      entries = [makeEntry('e-1', 170, '2026-03-30')]
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
})
