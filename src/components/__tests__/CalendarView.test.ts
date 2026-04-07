import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { getLocalStorageMock, mockAnalytics, mockTheme } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../composables/useAnalytics', () => mockAnalytics())
vi.mock('../../composables/useTheme', () => mockTheme())

// Build reactive mock store
interface MockSet {
  id: string
  date: string
  weight: number
  reps: number
  estimated1RM: number
}

interface MockExercise {
  id: string
  name: string
  tags: string[]
  sets: MockSet[]
}

let exercises: MockExercise[] = []

function getExercisePR(id: string): number {
  const ex = exercises.find(e => e.id === id)
  if (!ex || ex.sets.length === 0) return 0
  return Math.max(...ex.sets.map(s => s.estimated1RM))
}

function getAllTags(): string[] {
  const tags = new Set<string>()
  exercises.forEach(e => (e.tags || []).forEach(t => tags.add(t)))
  return [...tags].sort()
}

vi.mock('../../stores/workout', () => ({
  useWorkoutStore: () => ({
    get exercises() { return exercises },
    set exercises(v: MockExercise[]) { exercises = v },
    get allTags() { return getAllTags() },
    getExercisePR,
    logSet: vi.fn(),
    addExercise: vi.fn(),
  })
}))

import CalendarView from '../CalendarView.vue'

function mountCalendar() {
  return mount(CalendarView, {
    global: {
      stubs: { Teleport: true },
    }
  })
}

// Create exercise data with sets on specific dates
function makeExercises(dates: string[]): MockExercise[] {
  return [{
    id: 'ex-1',
    name: 'Bench Press',
    tags: ['Chest'],
    sets: dates.map((date, i) => ({
      id: `s-${i}`,
      date: `${date}T12:00:00`,
      weight: 185 + i * 10,
      reps: 5,
      estimated1RM: Math.round((185 + i * 10) * (1 + 5 / 30)),
    }))
  }]
}

describe('CalendarView', () => {
  beforeEach(() => {
    exercises = []
    localStorageMock.clear()
  })

  describe('header and navigation', () => {
    it('renders the Training Calendar title', () => {
      const wrapper = mountCalendar()
      expect(wrapper.find('.calTitle').text()).toBe('Training Calendar')
    })

    it('shows Month and Week view toggle buttons', () => {
      const wrapper = mountCalendar()
      const btns = wrapper.findAll('.calToggleBtn')
      expect(btns.length).toBe(2)
      expect(btns[0].text()).toBe('Month')
      expect(btns[1].text()).toBe('Week')
    })

    it('defaults to month view', () => {
      const wrapper = mountCalendar()
      expect(wrapper.find('.calToggleBtn.active').text()).toBe('Month')
      expect(wrapper.find('.calGrid').exists()).toBe(true)
    })

    it('shows navigation arrows and month label', () => {
      const wrapper = mountCalendar()
      const navBtns = wrapper.findAll('.calNavBtn')
      expect(navBtns.length).toBe(2)
      expect(navBtns[0].text()).toBe('‹')
      expect(navBtns[1].text()).toBe('›')
      expect(wrapper.find('.calNavLabel').exists()).toBe(true)
    })

    it('changes month label after navigating backward', async () => {
      const wrapper = mountCalendar()
      // Click prev twice to ensure we move away from current month
      await wrapper.findAll('.calNavBtn')[0].trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.findAll('.calNavBtn')[0].trigger('click')
      await wrapper.vm.$nextTick()

      const label = wrapper.find('.calNavLabel').text()
      const now = new Date()
      const currentMonthName = now.toLocaleDateString(undefined, { month: 'long' })
      // After going back 2 months, the label should not contain the current month
      expect(label).not.toContain(currentMonthName)
    })

    it('changes month label after navigating forward', async () => {
      const wrapper = mountCalendar()
      await wrapper.findAll('.calNavBtn')[1].trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.findAll('.calNavBtn')[1].trigger('click')
      await wrapper.vm.$nextTick()

      const label = wrapper.find('.calNavLabel').text()
      const now = new Date()
      const currentMonthName = now.toLocaleDateString(undefined, { month: 'long' })
      expect(label).not.toContain(currentMonthName)
    })
  })

  describe('month grid', () => {
    it('renders day headers (Su Mo Tu We Th Fr Sa)', () => {
      const wrapper = mountCalendar()
      const headers = wrapper.findAll('.calDayHeader')
      expect(headers.length).toBe(7)
      expect(headers.map(h => h.text())).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'])
    })

    it('renders calendar cells for the month', () => {
      const wrapper = mountCalendar()
      const cells = wrapper.findAll('.calCell')
      // A month grid has between 28 and 42 cells (4-6 rows × 7 days)
      expect(cells.length).toBeGreaterThanOrEqual(28)
      expect(cells.length).toBeLessThanOrEqual(42)
    })

    it('marks today with calCellToday class', () => {
      const wrapper = mountCalendar()
      const todayCells = wrapper.findAll('.calCellToday')
      expect(todayCells.length).toBe(1)
    })

    it('shows dots on days with workout data', () => {
      const today = new Date()
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      exercises = makeExercises([dateStr])

      const wrapper = mountCalendar()
      const dotsContainers = wrapper.findAll('.calDots')
      expect(dotsContainers.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('day selection', () => {
    it('selects a day when clicked', async () => {
      const wrapper = mountCalendar()
      // Click on an in-month cell
      const inMonthCells = wrapper.findAll('.calCell:not(.calCellOtherMonth)')
      await inMonthCells[0].trigger('click')
      expect(wrapper.find('.calCellSelected').exists()).toBe(true)
    })

    it('shows detail panel when day is selected', async () => {
      const wrapper = mountCalendar()
      const inMonthCells = wrapper.findAll('.calCell:not(.calCellOtherMonth)')
      await inMonthCells[0].trigger('click')
      expect(wrapper.find('.calDetail').exists()).toBe(true)
    })

    it('shows "+ Log" button in day detail', async () => {
      const wrapper = mountCalendar()
      const inMonthCells = wrapper.findAll('.calCell:not(.calCellOtherMonth)')
      await inMonthCells[0].trigger('click')
      expect(wrapper.find('.calLogBtn').text()).toBe('+ Log')
    })

    it('shows "No sets logged" for empty days', async () => {
      const wrapper = mountCalendar()
      const inMonthCells = wrapper.findAll('.calCell:not(.calCellOtherMonth)')
      await inMonthCells[0].trigger('click')
      expect(wrapper.find('.calDetailEmpty').text()).toContain('No sets logged')
    })

    it('deselects day when clicked again', async () => {
      const wrapper = mountCalendar()
      const inMonthCells = wrapper.findAll('.calCell:not(.calCellOtherMonth)')
      await inMonthCells[0].trigger('click')
      expect(wrapper.find('.calCellSelected').exists()).toBe(true)

      await inMonthCells[0].trigger('click')
      expect(wrapper.find('.calCellSelected').exists()).toBe(false)
    })
  })

  describe('day detail with workout data', () => {
    it('shows exercise names for selected day', async () => {
      const today = new Date()
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      exercises = makeExercises([dateStr])

      const wrapper = mountCalendar()
      // Click on today's cell
      const todayCell = wrapper.find('.calCellToday')
      await todayCell.trigger('click')

      expect(wrapper.find('.calDetailTags').exists()).toBe(true)
      expect(wrapper.text()).toContain('Bench Press')
    })

    it('shows workout summary bar with exercise count, set count, and volume', async () => {
      const today = new Date()
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      exercises = makeExercises([dateStr])

      const wrapper = mountCalendar()
      await wrapper.find('.calCellToday').trigger('click')

      const summary = wrapper.find('.calSummaryBar')
      expect(summary.exists()).toBe(true)
      expect(summary.text()).toContain('1')  // 1 exercise
      expect(summary.text()).toContain('set') // set count
    })

    it('shows set count badge on exercise tag', async () => {
      const today = new Date()
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      exercises = makeExercises([dateStr])

      const wrapper = mountCalendar()
      await wrapper.find('.calCellToday').trigger('click')

      expect(wrapper.find('.calExRowCount').exists()).toBe(true)
    })

    it('expands set details when exercise row is clicked', async () => {
      const today = new Date()
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      exercises = makeExercises([dateStr])

      const wrapper = mountCalendar()
      await wrapper.find('.calCellToday').trigger('click')
      await wrapper.find('.calExRow').trigger('click')

      expect(wrapper.find('.calSetList').exists()).toBe(true)
      expect(wrapper.find('.calSetRow').exists()).toBe(true)
    })

    it('collapses set details on second click', async () => {
      const today = new Date()
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      exercises = makeExercises([dateStr])

      const wrapper = mountCalendar()
      await wrapper.find('.calCellToday').trigger('click')
      await wrapper.find('.calExRow').trigger('click')
      expect(wrapper.find('.calSetList').exists()).toBe(true)

      await wrapper.find('.calExRow').trigger('click')
      expect(wrapper.find('.calSetList').exists()).toBe(false)
    })
  })

  describe('week view', () => {
    it('switches to week view when Week button is clicked', async () => {
      const wrapper = mountCalendar()
      await wrapper.findAll('.calToggleBtn')[1].trigger('click')

      expect(wrapper.find('.calWeek').exists()).toBe(true)
      expect(wrapper.find('.calGrid').exists()).toBe(false)
    })

    it('renders 7 day rows in week view', async () => {
      const wrapper = mountCalendar()
      await wrapper.findAll('.calToggleBtn')[1].trigger('click')

      expect(wrapper.findAll('.calWeekRow').length).toBe(7)
    })

    it('shows day names and numbers', async () => {
      const wrapper = mountCalendar()
      await wrapper.findAll('.calToggleBtn')[1].trigger('click')

      expect(wrapper.findAll('.calWeekDayName').length).toBe(7)
      expect(wrapper.findAll('.calWeekDayNum').length).toBe(7)
    })

    it('shows "Rest" for days without workouts', async () => {
      const wrapper = mountCalendar()
      await wrapper.findAll('.calToggleBtn')[1].trigger('click')

      expect(wrapper.findAll('.calWeekRest').length).toBe(7)
    })

    it('marks today in week view', async () => {
      const wrapper = mountCalendar()
      await wrapper.findAll('.calToggleBtn')[1].trigger('click')

      expect(wrapper.find('.calWeekRowToday').exists()).toBe(true)
    })

    it('shows "+ Log" button on each day row', async () => {
      const wrapper = mountCalendar()
      await wrapper.findAll('.calToggleBtn')[1].trigger('click')

      expect(wrapper.findAll('.calWeekDayLogBtn').length).toBe(7)
    })

    it('navigates weeks with arrows', async () => {
      const wrapper = mountCalendar()
      await wrapper.findAll('.calToggleBtn')[1].trigger('click')

      const initialLabel = wrapper.find('.calNavLabel').text()
      await wrapper.findAll('.calNavBtn')[0].trigger('click')
      expect(wrapper.find('.calNavLabel').text()).not.toBe(initialLabel)
    })
  })

  describe('tag filtering', () => {
    it('shows tag filter bar when exercises have tags', () => {
      exercises = makeExercises(['2026-03-31'])
      const wrapper = mountCalendar()
      expect(wrapper.find('.wtTagFilterBar').exists()).toBe(true)
    })

    it('does not show tag filter when no exercises have tags', () => {
      exercises = [{ id: 'ex-1', name: 'Bench', tags: [], sets: [] }]
      const wrapper = mountCalendar()
      expect(wrapper.find('.wtTagFilterBar').exists()).toBe(false)
    })
  })

  describe('PR indicators', () => {
    it('shows trophy on calendar cell for PR day', () => {
      const today = new Date()
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      exercises = makeExercises([dateStr])

      const wrapper = mountCalendar()
      expect(wrapper.find('.calCellPR').exists()).toBe(true)
      expect(wrapper.find('.calCellPR').text()).toContain('🏆')
    })
  })

  describe('nav label tap-to-today', () => {
    it('nav label is not tappable when on current period', () => {
      const wrapper = mountCalendar()
      const label = wrapper.find('.calNavLabel')
      expect(label.classes()).not.toContain('calNavLabelTappable')
      expect((label.element as HTMLButtonElement).disabled).toBe(true)
    })

    it('nav label becomes tappable when viewing a past month', async () => {
      const wrapper = mountCalendar()
      // Navigate back one month
      await wrapper.findAll('.calNavBtn')[0].trigger('click')
      const label = wrapper.find('.calNavLabel')
      expect(label.classes()).toContain('calNavLabelTappable')
      expect((label.element as HTMLButtonElement).disabled).toBe(false)
    })

    it('tapping nav label returns to current month', async () => {
      const wrapper = mountCalendar()
      const currentLabel = wrapper.find('.calNavLabel').text()
      // Navigate back
      await wrapper.findAll('.calNavBtn')[0].trigger('click')
      expect(wrapper.find('.calNavLabel').text()).not.toBe(currentLabel)
      // Tap label to return
      await wrapper.find('.calNavLabel').trigger('click')
      expect(wrapper.find('.calNavLabel').text()).toBe(currentLabel)
    })
  })

  describe('accordion multi-expand', () => {
    it('allows multiple exercises expanded simultaneously', async () => {
      const today = new Date()
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      exercises = [
        { id: 'ex-1', name: 'Bench', tags: ['Chest'], sets: [{ id: 's1', date: `${dateStr}T12:00:00`, weight: 135, reps: 5, estimated1RM: 158 }] },
        { id: 'ex-2', name: 'Squat', tags: ['Legs'], sets: [{ id: 's2', date: `${dateStr}T12:00:00`, weight: 225, reps: 5, estimated1RM: 263 }] },
      ]

      const wrapper = mountCalendar()
      await wrapper.find('.calCellToday').trigger('click')

      const rows = wrapper.findAll('.calExRow')
      expect(rows).toHaveLength(2)

      // Expand first
      await rows[0].trigger('click')
      expect(wrapper.findAll('.calSetList')).toHaveLength(1)

      // Expand second — both should be open
      await rows[1].trigger('click')
      expect(wrapper.findAll('.calSetList')).toHaveLength(2)
    })
  })

  describe('accessibility', () => {
    it('nav buttons have aria-labels', () => {
      const wrapper = mountCalendar()
      const navBtns = wrapper.findAll('.calNavBtn')
      expect(navBtns[0].attributes('aria-label')).toBe('Previous')
      expect(navBtns[1].attributes('aria-label')).toBe('Next')
    })

    it('week view log buttons have aria-labels (LIFT-93)', async () => {
      const wrapper = mountCalendar()
      await wrapper.findAll('.calToggleBtn')[1].trigger('click')

      const logBtns = wrapper.findAll('.calWeekDayLogBtn')
      expect(logBtns.length).toBe(7)
      for (const btn of logBtns) {
        const label = btn.attributes('aria-label')
        expect(label).toBeTruthy()
        expect(label).toMatch(/^Log workout for/)
      }
    })
  })
})
