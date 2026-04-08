import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import type { Exercise, WorkoutSet } from '../../stores/workout'
import { getLocalStorageMock, mockAnalytics, mockTheme } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../composables/useAnalytics', () => mockAnalytics())
vi.mock('../../composables/useTheme', () => mockTheme())
vi.mock('../../stores/progression', () => ({
  useProgressionStore: () => ({
    progressionEnabled: false,
    showProgression: false,
    streakHistory: [],
    currentMultiplier: 1,
    logSetXP: vi.fn(),
    recordSetXP: vi.fn(),
    creditSetXP: vi.fn(),
    recalcSetXP: vi.fn(),
    removeSetXP: vi.fn(),
    checkUnlocks: vi.fn().mockReturnValue([]),
    starterConfirmed: true,
    starterTheme: 'fire',
    epoch: 1,
    xpPerSet: {},
    progressPercent: 0,
    totalXP: 0,
    nextUnlockThreshold: 5000,
  }),
}))
vi.mock('../../lib/xp', () => ({
  calculateSetXP: () => 50,
  calculateBest1RM: () => null,
  applyStreakMultiplier: (_xp: number) => _xp,
  checkRepPR: () => false,
  isExerciseEstablished: () => false,
  XP_CONFIG: { warmupThreshold: 0.5, prMultiplier: 3, tieMultiplier: 2, repPRMultiplier: 1.25 },
}))

// Mock ExerciseGraph (heavy SVG child)
vi.mock('../ExerciseGraph.vue', () => ({
  default: { name: 'ExerciseGraph', template: '<div class="mock-graph" />' }
}))

const EXERCISES: Exercise[] = [
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

const PR_EXERCISES: Exercise[] = [
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
let exercises: Exercise[] = []

function getExercisePR(id: string): number {
  const ex = exercises.find(e => e.id === id)
  if (!ex || ex.sets.length === 0) return 0
  return Math.max(...ex.sets.map(s => s.estimated1RM))
}

function getExercisePRSet(id: string): WorkoutSet | null {
  const ex = exercises.find(e => e.id === id)
  if (!ex || ex.sets.length === 0) return null
  return ex.sets.reduce((best, s) => s.estimated1RM > best.estimated1RM ? s : best)
}

function getAllTags(): string[] {
  const tags = new Set<string>()
  exercises.forEach(e => (e.tags || []).forEach(t => tags.add(t)))
  return [...tags].sort()
}

const mockAddExercise = vi.fn()
const mockLogSet = vi.fn()
const mockUpdateSet = vi.fn()
const mockDeleteSet = vi.fn()
const mockDeleteExercise = vi.fn()
const mockRestoreSet = vi.fn()
const mockSyncDeleteSet = vi.fn()
const mockRestoreExercise = vi.fn()
const mockSyncDeleteExercise = vi.fn()
const mockRenameExercise = vi.fn()
const mockUpdateExerciseTags = vi.fn()
const mockReorderExercise = vi.fn()

vi.mock('../../stores/workout', () => ({
  useWorkoutStore: () => ({
    get exercises() { return exercises },
    set exercises(v: Exercise[]) { exercises = v },
    get allTags() { return getAllTags() },
    getExercisePR,
    getExercisePRSet,
    getOverloadSuggestion: () => null,
    addExercise: mockAddExercise,
    logSet: mockLogSet,
    updateSet: mockUpdateSet,
    deleteSet: mockDeleteSet,
    deleteExercise: mockDeleteExercise,
    restoreSet: mockRestoreSet,
    syncDeleteSet: mockSyncDeleteSet,
    restoreExercise: mockRestoreExercise,
    syncDeleteExercise: mockSyncDeleteExercise,
    renameExercise: mockRenameExercise,
    updateExerciseTags: mockUpdateExerciseTags,
    reorderExercise: mockReorderExercise,
    reorderExercises: vi.fn(),
    updateExercise: vi.fn(),
  })
}))



import WorkoutTracker from '../WorkoutTracker.vue'

function mountTracker(): VueWrapper {
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
    vi.clearAllMocks()
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

    it('displays exercise name', () => {
      const wrapper = mountTracker()
      const rows = wrapper.findAll('.wtExerciseRow')
      expect(rows[0].text()).toContain('Bench Press')
      expect(rows[1].text()).toContain('Squat')
    })

    it('displays est. 1RM with the PR set weight × reps', () => {
      const wrapper = mountTracker()
      const meta = wrapper.findAll('.wtExerciseMeta')
      // Bench PR set: 195 × 5 = e1RM 228
      expect(meta[0].text()).toContain('228')
      expect(meta[0].text()).toContain('195')
      expect(meta[0].text()).toContain('5')
    })

    it('hides meta for exercise with no sets', () => {
      const wrapper = mountTracker()
      // ex-3 (Deadlift) has no sets — meta should not render
      const items = wrapper.findAll('.wtExerciseItem')
      const deadliftMeta = items[2].find('.wtExerciseMeta')
      expect(deadliftMeta.exists()).toBe(false)
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
      const legsChip = chips.find(c => c.text() === 'Legs')!
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
      const pushChip = chips.find(c => c.text() === 'Push')!
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
      const legsChip = chips.find(c => c.text() === 'Legs')!
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

    it('wraps each date group in a card', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      const cards = wrapper.findAll('.wtSetCard')
      expect(cards.length).toBe(2) // two different dates
    })

    it('groups same-date sets into one card', async () => {
      // Add a second set on the same date as the latest (Jan 20)
      exercises[0].sets.push(
        { id: 's-extra', date: '2026-01-20T14:00:00', weight: 190, reps: 3, estimated1RM: 210 }
      )
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      const cards = wrapper.findAll('.wtSetCard')
      expect(cards.length).toBe(2) // still two dates: Jan 15 and Jan 20
      // The Jan 20 card (first in reversed order) should have 2 set rows
      expect(cards[0].findAll('.wtSetRow').length).toBe(2)
    })

    it('groups sets by local date, not UTC date', async () => {
      // Two sets with the same UTC date prefix but at different times
      // Both should group under the same local date
      exercises[0].sets = [
        { id: 's-a', date: '2026-03-16T10:00:00', weight: 185, reps: 5, estimated1RM: 216 },
        { id: 's-b', date: '2026-03-16T14:30:00', weight: 195, reps: 5, estimated1RM: 228 },
      ]
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      // Both sets are on the same local date → 1 card
      const cards = wrapper.findAll('.wtSetCard')
      expect(cards.length).toBe(1)
      expect(cards[0].findAll('.wtSetRow').length).toBe(2)
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

    it('shows Edit button in detail header and Log Set in footer', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtDetailEditBtn').exists()).toBe(true)
      expect(wrapper.find('.wtDetailFooterBtn').text()).toBe('+ Log Set')
    })

    it('shows empty message for exercise with no sets', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[2].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtSetEmpty').text()).toContain('No sets logged yet')
    })

    it('has + Log Set button in detail footer', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtDetailFooterBtn').text()).toBe('+ Log Set')
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

    it('shows "New Exercise" as modal title', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtLogBtn').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('#log-modal-title').text()).toBe('New Exercise')
    })

    it('calls addExercise with name and tags on save', async () => {
      exercises = JSON.parse(JSON.stringify(EXERCISES))
      mockAddExercise.mockReturnValue('ex-new')
      const wrapper = mountTracker()

      await wrapper.find('.wtLogBtn').trigger('click')
      await wrapper.vm.$nextTick()

      // Enter exercise name
      const nameInput = wrapper.find('.repMaxModal input[type="text"]')
      await nameInput.setValue('Deadlift')

      // Click save (no weight/reps means just create the exercise)
      const saveBtn = wrapper.find('.repMaxBtn.repMaxBtnCalc')
      await saveBtn.trigger('click')

      expect(mockAddExercise).toHaveBeenCalledWith('Deadlift', [])
    })

    it('calls addExercise with selected tags', async () => {
      exercises = JSON.parse(JSON.stringify(EXERCISES))
      mockAddExercise.mockReturnValue('ex-new')
      const wrapper = mountTracker()

      await wrapper.find('.wtLogBtn').trigger('click')
      await wrapper.vm.$nextTick()

      // Enter exercise name
      const nameInput = wrapper.find('.repMaxModal input[type="text"]')
      await nameInput.setValue('Pull Up')

      // Click existing tag chips
      const tagChips = wrapper.findAll('.wtTagPickerChip')
      if (tagChips.length > 0) {
        await tagChips[0].trigger('click')
      }

      const saveBtn = wrapper.find('.repMaxBtn.repMaxBtnCalc')
      await saveBtn.trigger('click')

      expect(mockAddExercise).toHaveBeenCalled()
      // Verify tags were passed (first tag from allTags)
      const callArgs = mockAddExercise.mock.calls[0]
      expect(callArgs[0]).toBe('Pull Up')
      expect(callArgs[1].length).toBeGreaterThan(0)
    })

    it('disables save button when name is empty', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtLogBtn').trigger('click')
      await wrapper.vm.$nextTick()

      const saveBtn = wrapper.find('.repMaxBtn.repMaxBtnCalc')
      expect(saveBtn.attributes('disabled')).toBeDefined()
    })
  })

  describe('set logging flow', () => {
    beforeEach(() => {
      exercises = JSON.parse(JSON.stringify(EXERCISES))
    })

    it('opens log modal for specific exercise via "+ Log" button', async () => {
      const wrapper = mountTracker()
      const logBtns = wrapper.findAll('.wtExerciseLogBtn')
      await logBtns[0].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.repMaxModal').exists()).toBe(true)
      expect(wrapper.find('#log-modal-title').text()).toBe('Bench Press')
    })

    it('calls logSet with weight and reps on save', async () => {
      const wrapper = mountTracker()
      const logBtns = wrapper.findAll('.wtExerciseLogBtn')
      await logBtns[0].trigger('click')
      await wrapper.vm.$nextTick()

      // Enter weight and reps
      const inputs = wrapper.findAll('.repMaxModal input')
      const weightInput = inputs.find(i => i.attributes('inputmode') === 'decimal')!
      const repsInput = inputs.find(i => i.attributes('inputmode') === 'numeric')!
      await weightInput.setValue('185')
      await repsInput.setValue('5')

      const saveBtn = wrapper.find('.repMaxBtn.repMaxBtnCalc')
      await saveBtn.trigger('click')

      expect(mockLogSet).toHaveBeenCalledWith('ex-1', 185, 5, expect.any(String))
    })

    it('keeps modal open with cleared fields after saving a set', async () => {
      const wrapper = mountTracker()
      const logBtns = wrapper.findAll('.wtExerciseLogBtn')
      await logBtns[0].trigger('click')
      await wrapper.vm.$nextTick()

      const inputs = wrapper.findAll('.repMaxModal input')
      const weightInput = inputs.find(i => i.attributes('inputmode') === 'decimal')!
      const repsInput = inputs.find(i => i.attributes('inputmode') === 'numeric')!
      await weightInput.setValue('225')
      await repsInput.setValue('3')

      await wrapper.find('.repMaxBtn.repMaxBtnCalc').trigger('click')
      await wrapper.vm.$nextTick()

      // Modal stays open for the next set
      expect(wrapper.find('.repMaxModal').exists()).toBe(true)
      // Fields are cleared
      const updatedInputs = wrapper.findAll('.repMaxModal input')
      const updatedWeight = updatedInputs.find(i => i.attributes('inputmode') === 'decimal')!
      const updatedReps = updatedInputs.find(i => i.attributes('inputmode') === 'numeric')!
      expect((updatedWeight.element as HTMLInputElement).value).toBe('')
      expect((updatedReps.element as HTMLInputElement).value).toBe('')
    })

    it('disables save when weight or reps missing', async () => {
      const wrapper = mountTracker()
      const logBtns = wrapper.findAll('.wtExerciseLogBtn')
      await logBtns[0].trigger('click')
      await wrapper.vm.$nextTick()

      // Only enter weight, no reps
      const inputs = wrapper.findAll('.repMaxModal input')
      const weightInput = inputs.find(i => i.attributes('inputmode') === 'decimal')!
      await weightInput.setValue('185')

      const saveBtn = wrapper.find('.repMaxBtn.repMaxBtnCalc')
      expect(saveBtn.attributes('disabled')).toBeDefined()
    })
  })

  describe('exercise search', () => {
    const FIVE_EXERCISES: Exercise[] = [
      { id: 'ex-1', name: 'Bench Press', tags: ['Chest'], sets: [] },
      { id: 'ex-2', name: 'Squat', tags: ['Legs'], sets: [] },
      { id: 'ex-3', name: 'Deadlift', tags: ['Back'], sets: [] },
      { id: 'ex-4', name: 'Overhead Press', tags: ['Shoulders'], sets: [] },
      { id: 'ex-5', name: 'Barbell Row', tags: ['Back'], sets: [] },
    ]

    beforeEach(() => {
      exercises = JSON.parse(JSON.stringify(FIVE_EXERCISES))
    })

    it('shows search bar when 5+ exercises exist', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('.wtSearchBar').exists()).toBe(true)
    })

    it('hides search bar when fewer than 5 exercises', () => {
      exercises = JSON.parse(JSON.stringify(EXERCISES)) // only 3
      const wrapper = mountTracker()
      expect(wrapper.find('.wtSearchBar').exists()).toBe(false)
    })

    it('filters exercises by search query', async () => {
      const wrapper = mountTracker()
      const searchInput = wrapper.find('.wtSearchInput')
      await searchInput.setValue('bench')

      const items = wrapper.findAll('.wtExerciseItem')
      expect(items.length).toBe(1)
      expect(wrapper.text()).toContain('Bench Press')
    })

    it('shows result count when searching', async () => {
      const wrapper = mountTracker()
      const searchInput = wrapper.find('.wtSearchInput')
      await searchInput.setValue('press')

      expect(wrapper.find('.wtSearchCount').text()).toContain('2')
    })

    it('shows no-match message for unmatched query', async () => {
      const wrapper = mountTracker()
      const searchInput = wrapper.find('.wtSearchInput')
      await searchInput.setValue('zzzzz')

      expect(wrapper.findAll('.wtExerciseItem').length).toBe(0)
      expect(wrapper.text()).toContain('No exercises match your search')
    })

    it('search is case-insensitive', async () => {
      const wrapper = mountTracker()
      const searchInput = wrapper.find('.wtSearchInput')
      await searchInput.setValue('SQUAT')

      expect(wrapper.findAll('.wtExerciseItem').length).toBe(1)
      expect(wrapper.text()).toContain('Squat')
    })

    it('combined search and tag filter narrows results', async () => {
      const wrapper = mountTracker()
      // First filter by tag 'Back'
      const chips = wrapper.findAll('.wtTagChip:not(.wtTagChipClear)')
      const backChip = chips.find(c => c.text() === 'Back')!
      await backChip.trigger('click')

      // Then search for 'row'
      const searchInput = wrapper.find('.wtSearchInput')
      await searchInput.setValue('row')

      const items = wrapper.findAll('.wtExerciseItem')
      expect(items.length).toBe(1)
      expect(wrapper.text()).toContain('Barbell Row')
    })
  })

  describe('delete set with undo', () => {
    beforeEach(() => {
      exercises = JSON.parse(JSON.stringify(EXERCISES))
    })

    it('calls deleteSet when delete button is clicked', async () => {
      const wrapper = mountTracker()
      // Open detail modal
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      // Tap a set to reveal actions
      await wrapper.findAll('.wtSetRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      // Click delete
      const btns = wrapper.findAll('.wtSetBtn')
      const deleteBtn = btns.find(b => b.text() === 'Delete')!
      await deleteBtn.trigger('click')
      await wrapper.vm.$nextTick()

      expect(mockDeleteSet).toHaveBeenCalledWith('ex-1', expect.any(String), { sync: false })
    })

    it('calls deleteExercise from edit exercise modal', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      // Open edit modal from detail header
      await wrapper.find('.wtDetailEditBtn').trigger('click')
      await wrapper.vm.$nextTick()

      // Click Delete Exercise, then confirm
      await wrapper.find('.wtEditDeleteBtn').trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.find('.wtEditDeleteConfirmDanger').trigger('click')
      await wrapper.vm.$nextTick()

      expect(mockDeleteExercise).toHaveBeenCalledWith('ex-1', { sync: false })
    })
  })

  describe('edit set flow', () => {
    beforeEach(() => {
      exercises = JSON.parse(JSON.stringify(EXERCISES))
    })

    it('opens edit modal with pre-filled values when Edit is clicked', async () => {
      const wrapper = mountTracker()
      // Open detail modal
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      // Tap a set to reveal actions
      await wrapper.findAll('.wtSetRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      // Click edit
      const btns = wrapper.findAll('.wtSetBtn')
      const editBtn = btns.find(b => b.text() === 'Edit')!
      await editBtn.trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.repMaxModal').exists()).toBe(true)
      expect(wrapper.find('#log-modal-title').text()).toBe('Edit Set')
    })

    it('calls updateSet on save in edit mode', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      await wrapper.findAll('.wtSetRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      const editBtn = wrapper.findAll('.wtSetBtn').find(b => b.text() === 'Edit')!
      await editBtn.trigger('click')
      await wrapper.vm.$nextTick()

      // Modify weight
      const inputs = wrapper.findAll('.repMaxModal input')
      const weightInput = inputs.find(i => i.attributes('inputmode') === 'decimal')!
      await weightInput.setValue('200')

      const repsInput = inputs.find(i => i.attributes('inputmode') === 'numeric')!
      await repsInput.setValue('6')

      await wrapper.find('.repMaxBtn.repMaxBtnCalc').trigger('click')

      expect(mockUpdateSet).toHaveBeenCalledWith('ex-1', expect.any(String), 200, 6, expect.any(String))
    })

    it('shows date picker in edit mode', async () => {
      const wrapper = mountTracker()
      // Open detail modal
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      // Tap set, click Edit
      await wrapper.findAll('.wtSetRow')[0].trigger('click')
      await wrapper.vm.$nextTick()
      const editBtn = wrapper.findAll('.wtSetBtn').find(b => b.text() === 'Edit')!
      await editBtn.trigger('click')
      await wrapper.vm.$nextTick()

      // Date picker should be visible in edit mode
      const dateInput = wrapper.find('.repMaxModal input[type="date"]')
      expect(dateInput.exists()).toBe(true)
    })
  })

  describe('accessibility', () => {
    it('log modal has aria-modal and role dialog', async () => {
      exercises = JSON.parse(JSON.stringify(EXERCISES))
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseLogBtn')[0].trigger('click')
      await wrapper.vm.$nextTick()

      const modal = wrapper.find('.repMaxModal')
      expect(modal.attributes('role')).toBe('dialog')
      expect(modal.attributes('aria-modal')).toBe('true')
    })

    it('search input has aria-label', () => {
      exercises = [
        { id: '1', name: 'A', tags: [], sets: [] },
        { id: '2', name: 'B', tags: [], sets: [] },
        { id: '3', name: 'C', tags: [], sets: [] },
        { id: '4', name: 'D', tags: [], sets: [] },
        { id: '5', name: 'E', tags: [], sets: [] },
      ]
      const wrapper = mountTracker()
      expect(wrapper.find('.wtSearchInput').attributes('aria-label')).toBe('Search exercises')
    })

    it('log button aria-label renders exercise name dynamically', () => {
      exercises = [{ id: '1', name: 'Bench Press', tags: [], sets: [] }]
      const wrapper = mountTracker()
      const logBtn = wrapper.find('.wtExerciseLogBtn')
      expect(logBtn.attributes('aria-label')).toBe('Log a set for Bench Press')
    })

    it('detail modal has aria-modal and role dialog', async () => {
      exercises = JSON.parse(JSON.stringify(EXERCISES))
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      const modal = wrapper.find('.wtDetailModal')
      expect(modal.attributes('role')).toBe('dialog')
      expect(modal.attributes('aria-modal')).toBe('true')
    })

    it('tag filter buttons have aria-pressed reflecting active state', () => {
      exercises = JSON.parse(JSON.stringify(EXERCISES))
      const wrapper = mountTracker()
      const tagBtns = wrapper.findAll('.wtTagChip:not(.wtTagChipManage)')
      expect(tagBtns.length).toBeGreaterThan(0)
      // Initially none are pressed
      tagBtns.forEach(btn => {
        if (!btn.classes().includes('wtTagChipClear')) {
          expect(btn.attributes('aria-pressed')).toBe('false')
        }
      })
    })

    it('tag add buttons have aria-label', async () => {
      exercises = JSON.parse(JSON.stringify(EXERCISES))
      const wrapper = mountTracker()
      // Open new exercise modal
      await wrapper.find('.wtLogBtn').trigger('click')
      await wrapper.vm.$nextTick()
      const addBtn = wrapper.find('.wtTagAddChip')
      expect(addBtn.attributes('aria-label')).toBe('Add tag')
    })

    it('timer visual display has aria-hidden (not aria-live) to prevent per-second announcements', () => {
      exercises = JSON.parse(JSON.stringify(EXERCISES))
      const wrapper = mountTracker()
      const timerInner = wrapper.find('.wtTimerRingInner')
      if (timerInner.exists()) {
        expect(timerInner.attributes('aria-hidden')).toBe('true')
        expect(timerInner.attributes('aria-live')).toBeUndefined()
      }
    })

    it('timer has a screen-reader-only aria-live region for milestone announcements', () => {
      exercises = JSON.parse(JSON.stringify(EXERCISES))
      const wrapper = mountTracker()
      const srAnnouncement = wrapper.find('.srOnly[aria-live="polite"]')
      if (srAnnouncement.exists()) {
        expect(srAnnouncement.attributes('aria-atomic')).toBe('true')
      }
    })
  })

  describe('view toggle', () => {
    beforeEach(() => {
      exercises = JSON.parse(JSON.stringify(EXERCISES))
    })

    it('renders Exercises and Timeline toggle buttons when exercises exist', () => {
      const wrapper = mountTracker()
      const btns = wrapper.findAll('.wtViewToggleBtn')
      expect(btns.length).toBe(2)
      expect(btns[0].text()).toBe('Exercises')
      expect(btns[1].text()).toBe('Timeline')
    })

    it('does not render toggle when no exercises exist', () => {
      exercises = []
      const wrapper = mountTracker()
      expect(wrapper.find('.wtViewToggle').exists()).toBe(false)
    })

    it('defaults to exercises view', () => {
      const wrapper = mountTracker()
      const activeBtn = wrapper.find('.wtViewToggleBtn.active')
      expect(activeBtn.text()).toBe('Exercises')
    })

    it('switches to timeline view when Timeline button is clicked', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtViewToggleBtn')[1].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtViewToggleBtn.active').text()).toBe('Timeline')
    })

    it('shows "+ New Exercise" in exercises view and "+ Log Set" in timeline view', async () => {
      const wrapper = mountTracker()
      expect(wrapper.find('.wtLogBtn').text()).toBe('+ New Exercise')

      await wrapper.findAll('.wtViewToggleBtn')[1].trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.wtLogBtn').text()).toBe('+ Log Set')
    })

    it('persists view selection to localStorage', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtViewToggleBtn')[1].trigger('click')
      await wrapper.vm.$nextTick()

      expect(localStorageMock.setItem).toHaveBeenCalledWith('wt-list-view', 'timeline')
    })

    it('restores view from localStorage on mount', () => {
      localStorage.setItem('wt-list-view', 'timeline')
      const wrapper = mountTracker()
      expect(wrapper.find('.wtViewToggleBtn.active').text()).toBe('Timeline')
    })
  })

  describe('timeline view', () => {
    // Uses endOfDayISO-style timestamps (23:59:ss.msZ) to match production behavior.
    // Within a day, sets from different exercises preserve insertion order (Bench before Squat).
    const TIMELINE_EXERCISES: Exercise[] = [
      {
        id: 'ex-1',
        name: 'Bench Press',
        tags: ['Chest'],
        sets: [
          { id: 's-1', date: '2026-03-10T23:59:10.100Z', weight: 185, reps: 5, estimated1RM: 216 },
          { id: 's-2', date: '2026-03-10T23:59:20.200Z', weight: 185, reps: 4, estimated1RM: 208 },
          { id: 's-3', date: '2026-03-12T23:59:05.300Z', weight: 195, reps: 5, estimated1RM: 228 },
        ]
      },
      {
        id: 'ex-2',
        name: 'Squat',
        tags: ['Legs'],
        sets: [
          { id: 's-4', date: '2026-03-10T23:59:30.400Z', weight: 225, reps: 5, estimated1RM: 263 },
          { id: 's-5', date: '2026-03-12T23:59:45.500Z', weight: 235, reps: 3, estimated1RM: 257 },
        ]
      },
    ]

    async function mountTimeline() {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtViewToggleBtn')[1].trigger('click')
      await wrapper.vm.$nextTick()
      return wrapper
    }

    beforeEach(() => {
      exercises = JSON.parse(JSON.stringify(TIMELINE_EXERCISES))
    })

    it('renders all sets across exercises sorted by date (newest first)', async () => {
      const wrapper = await mountTimeline()
      const rows = wrapper.findAll('.wtTimelineRow')
      expect(rows.length).toBe(5)
      // Mar 12 sets come first. Within a day, insertion order is preserved
      // (Bench iterated before Squat), so Bench 195 then Squat 235
      expect(rows[0].text()).toContain('195')
      expect(rows[1].text()).toContain('235')
    })

    it('groups sets by date with date headers', async () => {
      const wrapper = await mountTimeline()
      const headers = wrapper.findAll('.wtTimelineDateHeader')
      expect(headers.length).toBe(2) // Mar 12 and Mar 10
    })

    it('displays exercise name in each timeline row', async () => {
      const wrapper = await mountTimeline()
      const names = wrapper.findAll('.wtTimelineExName')
      expect(names.length).toBe(5)
      // Mar 12 sets: Bench then Squat (insertion order preserved within day)
      expect(names[0].text()).toBe('Bench Press')
      expect(names[1].text()).toBe('Squat')
    })

    it('displays weight × reps and estimated 1RM for each set', async () => {
      const wrapper = await mountTimeline()
      const details = wrapper.findAll('.wtTimelineSetDetail')
      // First entry is Bench 195×5 (insertion order within day)
      expect(details[0].text()).toContain('195')
      expect(details[0].text()).toContain('5')

      const e1rms = wrapper.findAll('.wtTimelineE1RM')
      expect(e1rms[0].text()).toContain('228')
    })

    it('shows empty message when no sets exist', async () => {
      exercises = [{ id: 'ex-1', name: 'Bench', tags: [], sets: [] }]
      const wrapper = await mountTimeline()
      expect(wrapper.text()).toContain('No sets logged yet')
    })

    it('reveals edit/delete actions on timeline row tap', async () => {
      const wrapper = await mountTimeline()
      await wrapper.findAll('.wtTimelineRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtTimelineRowActive').exists()).toBe(true)
      const btns = wrapper.findAll('.wtSetBtn')
      expect(btns.map(b => b.text())).toContain('Edit')
      expect(btns.map(b => b.text())).toContain('Delete')
    })

    it('hides tag filter bar in timeline view', async () => {
      const wrapper = await mountTimeline()
      expect(wrapper.find('.wtTagFilterBar').exists()).toBe(false)
    })

    it('hides search bar in timeline view', async () => {
      // Need 5+ exercises for search bar
      exercises = [
        { id: '1', name: 'A', tags: [], sets: [{ id: 's1', date: '2026-01-01T10:00:00', weight: 100, reps: 5, estimated1RM: 117 }] },
        { id: '2', name: 'B', tags: [], sets: [] },
        { id: '3', name: 'C', tags: [], sets: [] },
        { id: '4', name: 'D', tags: [], sets: [] },
        { id: '5', name: 'E', tags: [], sets: [] },
      ]
      const wrapper = await mountTimeline()
      expect(wrapper.find('.wtSearchBar').exists()).toBe(false)
    })
  })

  describe('timeline pagination', () => {
    beforeEach(() => {
      // Create exercise with 55 sets to test "show more" (limit is 50)
      const sets = Array.from({ length: 55 }, (_, i) => ({
        id: `s-${i}`,
        date: `2026-01-${String(Math.floor(i / 3) + 1).padStart(2, '0')}T10:00:00`,
        weight: 135 + i,
        reps: 5,
        estimated1RM: 158 + i,
      }))
      exercises = [{ id: 'ex-1', name: 'Bench Press', tags: [], sets }]
    })

    it('limits visible timeline entries to 50 initially', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtViewToggleBtn')[1].trigger('click')
      await wrapper.vm.$nextTick()

      const rows = wrapper.findAll('.wtTimelineRow')
      expect(rows.length).toBe(50)
    })

    it('shows "Show more" button with remaining count', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtViewToggleBtn')[1].trigger('click')
      await wrapper.vm.$nextTick()

      const showMore = wrapper.find('.wtTimelineShowMore')
      expect(showMore.exists()).toBe(true)
      expect(showMore.text()).toContain('5 remaining')
    })

    it('loads more entries when "Show more" is clicked', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtViewToggleBtn')[1].trigger('click')
      await wrapper.vm.$nextTick()

      await wrapper.find('.wtTimelineShowMore').trigger('click')
      await wrapper.vm.$nextTick()

      const rows = wrapper.findAll('.wtTimelineRow')
      expect(rows.length).toBe(55)
      expect(wrapper.find('.wtTimelineShowMore').exists()).toBe(false)
    })
  })

  describe('show all / show less sets', () => {
    beforeEach(() => {
      // Create exercise with 15 sets — exceeds SET_LIMIT of 10
      const sets = Array.from({ length: 15 }, (_, i) => ({
        id: `s-${i}`,
        date: `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00`,
        weight: 135 + i * 5,
        reps: 5,
        estimated1RM: 158 + i * 5,
      }))
      exercises = [{ id: 'ex-1', name: 'Bench Press', tags: [], sets }]
    })

    it('limits visible sets to 10 initially in detail modal', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtExerciseRow').trigger('click')
      await wrapper.vm.$nextTick()

      const setRows = wrapper.findAll('.wtSetRow')
      expect(setRows.length).toBe(10)
    })

    it('shows "Show all X sets" button when sets exceed limit', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtExerciseRow').trigger('click')
      await wrapper.vm.$nextTick()

      const btn = wrapper.find('.wtShowAllBtn')
      expect(btn.exists()).toBe(true)
      expect(btn.text()).toContain('Show all 15 sets')
    })

    it('shows all sets when "Show all" is clicked', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtExerciseRow').trigger('click')
      await wrapper.vm.$nextTick()

      await wrapper.find('.wtShowAllBtn').trigger('click')
      await wrapper.vm.$nextTick()

      const setRows = wrapper.findAll('.wtSetRow')
      expect(setRows.length).toBe(15)
    })

    it('toggles button text to "Show less" after expanding', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtExerciseRow').trigger('click')
      await wrapper.vm.$nextTick()

      await wrapper.find('.wtShowAllBtn').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtShowAllBtn').text()).toBe('Show less')
    })

    it('collapses back to limit when "Show less" is clicked', async () => {
      const wrapper = mountTracker()
      await wrapper.find('.wtExerciseRow').trigger('click')
      await wrapper.vm.$nextTick()

      // Expand
      await wrapper.find('.wtShowAllBtn').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.findAll('.wtSetRow').length).toBe(15)

      // Collapse
      await wrapper.find('.wtShowAllBtn').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.findAll('.wtSetRow').length).toBe(10)
    })

    it('does not show "Show all" button when sets are within limit', async () => {
      exercises = JSON.parse(JSON.stringify(EXERCISES)) // 2 sets on Bench Press
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtShowAllBtn').exists()).toBe(false)
    })
  })
})
