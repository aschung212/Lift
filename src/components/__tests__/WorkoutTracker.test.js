import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// Stub localStorage before any imports
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
    tabSwitch: vi.fn(),
    flushEngagement: vi.fn(),
  })
}))

// Mock useTheme
vi.mock('../../composables/useTheme', () => ({
  useTheme: () => ({
    weightUnit: { value: 'lbs' },
    displayWeight: (w) => Math.round(w),
    toLbs: (w) => w,
    restTimerEnabled: { value: false },
  })
}))

// Mock ExerciseGraph (heavy SVG child)
vi.mock('../ExerciseGraph.vue', () => ({
  default: { name: 'ExerciseGraph', template: '<div class="mock-graph" />' }
}))

const EXERCISES = [
  {
    id: 'ex-1',
    name: 'Bench Press',
    tags: ['Chest', 'Push'],
    sets: [
      { id: 's-1', date: '2026-01-15T12:00:00', weight: 185, reps: 5, estimated1RM: 216 },
      { id: 's-2', date: '2026-01-20T12:00:00', weight: 195, reps: 5, estimated1RM: 228 },
    ]
  },
  {
    id: 'ex-2',
    name: 'Squat',
    tags: ['Legs'],
    sets: [
      { id: 's-3', date: '2026-01-16T12:00:00', weight: 225, reps: 5, estimated1RM: 263 },
    ]
  },
  {
    id: 'ex-3',
    name: 'Overhead Press',
    tags: ['Push'],
    sets: []
  },
]

const PR_EXERCISES = [
  {
    id: 'ex-1',
    name: 'Bench Press',
    tags: [],
    sets: [
      { id: 's-1', date: '2026-01-01T12:00:00', weight: 135, reps: 5, estimated1RM: 158 },
      { id: 's-2', date: '2026-01-15T12:00:00', weight: 155, reps: 5, estimated1RM: 181 },
      { id: 's-3', date: '2026-02-01T12:00:00', weight: 175, reps: 5, estimated1RM: 204 },
    ]
  }
]

// Build a reactive mock store
let exercises = []

function getExercisePR(id) {
  const ex = exercises.find(e => e.id === id)
  if (!ex || ex.sets.length === 0) return 0
  return Math.max(...ex.sets.map(s => s.estimated1RM))
}

function getAllTags() {
  const tags = new Set()
  exercises.forEach(e => (e.tags || []).forEach(t => tags.add(t)))
  return [...tags].sort()
}

vi.mock('../../stores/workout', () => ({
  useWorkoutStore: () => ({
    get exercises() { return exercises },
    set exercises(v) { exercises = v },
    get allTags() { return getAllTags() },
    getExercisePR,
    addExercise: vi.fn(),
    logSet: vi.fn(),
    updateSet: vi.fn(),
    deleteSet: vi.fn(),
    clearSets: vi.fn(),
    deleteExercise: vi.fn(),
    reorderExercises: vi.fn(),
    updateExercise: vi.fn(),
  })
}))



import WorkoutTracker from '../WorkoutTracker.vue'

function mountTracker() {
  return mount(WorkoutTracker, {
    global: {
      stubs: { Teleport: true },
    }
  })
}

describe('WorkoutTracker', () => {
  beforeEach(() => {
    exercises = []
    localStorageMock.clear()
  })

  describe('empty state', () => {
    it('shows empty message when no exercises exist', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('.wtEmpty').text()).toContain('No exercises yet')
    })

    it('renders "New Exercise" button', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('.wtLogBtn').text()).toBe('+ New Exercise')
    })

    it('does not render tag filter bar when no tags', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('.wtTagFilterBar').exists()).toBe(false)
    })
  })

  describe('exercise list', () => {
    beforeEach(() => {
      exercises = JSON.parse(JSON.stringify(EXERCISES))
    })

    it('renders all exercises', () => {
      const wrapper = mountTracker()
      const items = wrapper.findAll('.wtExerciseItem')
      expect(items.length).toBe(3)
    })

    it('displays exercise name and set count', () => {
      const wrapper = mountTracker()
      const rows = wrapper.findAll('.wtExerciseRow')
      expect(rows[0].text()).toContain('Bench Press')
      expect(rows[0].text()).toContain('2 sets')
      expect(rows[1].text()).toContain('Squat')
      expect(rows[1].text()).toContain('1 set')
    })

    it('uses singular "set" for exercises with 1 set', () => {
      const wrapper = mountTracker()
      const meta = wrapper.findAll('.wtExerciseMeta')
      expect(meta[1].text()).toMatch(/1 set$/)
    })

    it('displays PR value for exercises with sets', () => {
      const wrapper = mountTracker()
      const meta = wrapper.findAll('.wtExerciseMeta')
      expect(meta[0].text()).toContain('228')
      expect(meta[0].text()).toContain('lbs')
    })

    it('shows dash for PR when exercise has no sets', () => {
      const wrapper = mountTracker()
      const meta = wrapper.findAll('.wtExerciseMeta')
      expect(meta[2].text()).toContain('—')
    })

    it('shows "+ Log" button for each exercise', () => {
      const wrapper = mountTracker()
      const logBtns = wrapper.findAll('.wtExerciseLogBtn')
      expect(logBtns.length).toBe(3)
      expect(logBtns[0].text()).toBe('+ Log')
    })

    it('renders drag handles for reordering', () => {
      const wrapper = mountTracker()
      const handles = wrapper.findAll('.wtDragHandle')
      expect(handles.length).toBe(3)
    })
  })

  describe('tag filtering', () => {
    beforeEach(() => {
      exercises = JSON.parse(JSON.stringify(EXERCISES))
    })

    it('renders tag filter chips for all unique tags', () => {
      const wrapper = mountTracker()
      const chips = wrapper.findAll('.wtTagChip:not(.wtTagChipClear)')
      const chipTexts = chips.map(c => c.text())
      expect(chipTexts).toContain('Chest')
      expect(chipTexts).toContain('Push')
      expect(chipTexts).toContain('Legs')
    })

    it('filters exercises when tag is clicked', async () => {
      const wrapper = mountTracker()
      const chips = wrapper.findAll('.wtTagChip:not(.wtTagChipClear)')
      const legsChip = chips.find(c => c.text() === 'Legs')
      await legsChip.trigger('click')

      const items = wrapper.findAll('.wtExerciseItem')
      expect(items.length).toBe(1)
      expect(wrapper.text()).toContain('Squat')
    })

    it('shows clear button when filter is active', async () => {
      const wrapper = mountTracker()
      const chips = wrapper.findAll('.wtTagChip:not(.wtTagChipClear)')
      await chips[0].trigger('click')

      expect(wrapper.find('.wtTagChipClear').exists()).toBe(true)
      expect(wrapper.find('.wtTagChipClear').text()).toBe('× Clear')
    })

    it('clears filters when clear button is clicked', async () => {
      const wrapper = mountTracker()
      const chips = wrapper.findAll('.wtTagChip:not(.wtTagChipClear)')
      await chips[0].trigger('click')
      await wrapper.find('.wtTagChipClear').trigger('click')

      expect(wrapper.findAll('.wtExerciseItem').length).toBe(3)
    })

    it('shows exercises matching ANY active tag (OR logic)', async () => {
      const wrapper = mountTracker()
      const chips = wrapper.findAll('.wtTagChip:not(.wtTagChipClear)')
      const pushChip = chips.find(c => c.text() === 'Push')
      await pushChip.trigger('click')

      // Push matches Bench Press and Overhead Press
      const items = wrapper.findAll('.wtExerciseItem')
      expect(items.length).toBe(2)
    })

    it('disables drag handles when filter is active', async () => {
      const wrapper = mountTracker()
      const chips = wrapper.findAll('.wtTagChip:not(.wtTagChipClear)')
      await chips[0].trigger('click')

      expect(wrapper.findAll('.wtDragHandleDisabled').length).toBeGreaterThan(0)
    })

    it('deactivates tag on second click', async () => {
      const wrapper = mountTracker()
      const chips = wrapper.findAll('.wtTagChip:not(.wtTagChipClear)')
      const legsChip = chips.find(c => c.text() === 'Legs')
      await legsChip.trigger('click')
      expect(wrapper.findAll('.wtExerciseItem').length).toBe(1)

      await legsChip.trigger('click')
      expect(wrapper.findAll('.wtExerciseItem').length).toBe(3)
    })
  })

  describe('exercise detail modal', () => {
    beforeEach(() => {
      exercises = JSON.parse(JSON.stringify(EXERCISES))
    })

    it('opens detail modal when exercise row is clicked', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtDetailModal').exists()).toBe(true)
      expect(wrapper.find('.wtDetailTitle').text()).toBe('Bench Press')
    })

    it('shows "All Sets" tab as active by default', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtDetailTab.active').text()).toContain('All Sets')
    })

    it('displays set count badge in tab', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtDetailTabCount').text()).toBe('2')
    })

    it('renders set rows with weight × reps and e1RM', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      const setRows = wrapper.findAll('.wtSetRow')
      expect(setRows.length).toBe(2)
      // Most recent first
      expect(setRows[0].text()).toContain('195')
      expect(setRows[0].text()).toContain('lbs')
    })

    it('highlights the PR set with a trophy emoji', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.findAll('.wtSetRowPR').length).toBeGreaterThan(0)
      expect(wrapper.find('.wtSetPR').text()).toContain('🏆')
    })

    it('groups sets by date headers', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.findAll('.wtSetDateHeader').length).toBeGreaterThan(0)
    })

    it('closes modal via back button', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.wtDetailModal').exists()).toBe(true)

      await wrapper.find('.wtDetailBack').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.wtDetailModal').exists()).toBe(false)
    })

    it('reveals edit/delete actions on set tap', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      await wrapper.findAll('.wtSetRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      const btns = wrapper.findAll('.wtSetBtn')
      expect(btns.map(b => b.text())).toContain('Edit')
      expect(btns.map(b => b.text())).toContain('Delete')
    })

    it('shows Edit Exercise and Delete Exercise buttons', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      const exBtns = wrapper.find('.wtExActions').findAll('.wtSetBtn')
      expect(exBtns.map(b => b.text())).toContain('Edit Exercise')
      expect(exBtns.map(b => b.text())).toContain('Delete Exercise')
    })

    it('shows empty message for exercise with no sets', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[2].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtSetEmpty').text()).toContain('No sets logged yet')
    })

    it('has + Log button in detail header', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtDetailLogBtn').text()).toBe('+ Log')
    })
  })

  describe('PR history tab', () => {
    beforeEach(() => {
      exercises = JSON.parse(JSON.stringify(PR_EXERCISES))
    })

    it('shows PRs tab when multiple PRs exist', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtExerciseRow').trigger('click')
      await wrapper.vm.$nextTick()

      const tabs = wrapper.findAll('.wtDetailTab')
      expect(tabs.length).toBe(2)
      expect(tabs[1].text()).toContain('PRs')
    })

    it('renders a PR card for each PR', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtExerciseRow').trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.findAll('.wtDetailTab')[1].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.findAll('.wtPRCard').length).toBe(3)
    })

    it('marks the latest PR as "Current"', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtExerciseRow').trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.findAll('.wtDetailTab')[1].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtPRCardCurrent').exists()).toBe(true)
      expect(wrapper.find('.wtPRCardBadge').text()).toBe('Current')
    })

    it('shows connectors with e1RM delta between PRs', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtExerciseRow').trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.findAll('.wtDetailTab')[1].trigger('click')
      await wrapper.vm.$nextTick()

      const connectors = wrapper.findAll('.wtPRConnector')
      expect(connectors.length).toBeGreaterThan(0)
      expect(connectors[0].text()).toContain('+')
    })

    it('shows PR count badge in tab', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtExerciseRow').trigger('click')
      await wrapper.vm.$nextTick()

      const prTab = wrapper.findAll('.wtDetailTab')[1]
      expect(prTab.text()).toContain('3')
    })
  })

  describe('new exercise modal', () => {
    it('opens modal when "+ New Exercise" is clicked', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtLogBtn').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.repMaxModal').exists()).toBe(true)
    })
  })
})
