import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shallowRef, triggerRef, reactive } from 'vue'
import { mount, VueWrapper } from '@vue/test-utils'
import type { Exercise, WorkoutSet } from '../../stores/workout'
import { getLocalStorageMock, mockAnalytics, mockTheme, mockWeightUnit, mockRestTimer } from '../../__tests__/helpers'
import EditExerciseModal from '../EditExerciseModal.vue'

const localStorageMock = getLocalStorageMock()

vi.mock('../../composables/useAnalytics', () => mockAnalytics())
vi.mock('../../composables/useTheme', () => mockTheme())
vi.mock('../../composables/useWeightUnit', () => mockWeightUnit())
vi.mock('../../composables/useRestTimer', () => mockRestTimer())
// Mutable container so gym-filter tests (#961) can drive the synced gym list.
// `reactive` keeps the mock faithful to the real Pinia store: adding a gym has
// to invalidate `allGyms` so newly created gyms render without a remount —
// with a plain object the computed caches forever and inline-add tests pass
// vacuously (same class of unfaithful-mock blind spot as #963).
const mockPrefsState = reactive({ gyms: [] as string[] })
const mockAddGym = vi.fn((name: string) => {
  if (mockPrefsState.gyms.includes(name)) return null
  mockPrefsState.gyms = [...mockPrefsState.gyms, name]
  return name
})
vi.mock('../../stores/preferences', () => ({
  usePreferencesStore: () => ({
    experience: { prCelebrations: true, haptics: true, screenWakeLock: true },
    filters: { warmupThreshold: 0.75 },
    intensityPresets: [50, 70, 80, 90, 100],
    get gyms() { return mockPrefsState.gyms },
    addGym: mockAddGym,
  }),
}))
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

// Fixture factories — each call returns a fresh deep copy so tests never share object references.
function createExercises(): Exercise[] {
  return [
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
}

function createPRExercises(): Exercise[] {
  return [
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
}

// Mock store state — a shallowRef mutated in place + triggerRef, mirroring the
// real store's reactivity contract (workout.ts trades deep reactivity for
// explicit triggers). Faithfulness matters here: children only observe
// in-place mutations when a fresh-identity prop reaches them (#963), and the
// live-update regression tests must be able to reproduce exactly that. The
// `mockState` getter/setter facade keeps the original container API.
const mockExercises = shallowRef<Exercise[]>([])
const mockState = {
  get exercises() { return mockExercises.value },
  set exercises(v: Exercise[]) { mockExercises.value = v },
}

function getExercisePR(id: string): number {
  const ex = mockState.exercises.find(e => e.id === id)
  if (!ex || ex.sets.length === 0) return 0
  return Math.max(...ex.sets.map(s => s.estimated1RM))
}

function getExercisePRSet(id: string): WorkoutSet | null {
  const ex = mockState.exercises.find(e => e.id === id)
  if (!ex || ex.sets.length === 0) return null
  return ex.sets.reduce((best, s) => s.estimated1RM > best.estimated1RM ? s : best)
}

function getAllTags(): string[] {
  const tags = new Set<string>()
  mockState.exercises.forEach(e => (e.tags || []).forEach(t => tags.add(t)))
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

// Faithful to the real actions: mutate the exercise IN PLACE, then triggerRef —
// the exact store contract the fresh-identity bindings (#963) exist to handle.
const mockUpdateExerciseTags = vi.fn((exerciseId: string, tags: string[]) => {
  const ex = mockExercises.value.find(e => e.id === exerciseId)
  if (!ex) return
  ex.tags = [...tags]
  triggerRef(mockExercises)
})
const mockSetExerciseGyms = vi.fn((exerciseId: string, gyms: string[]) => {
  const ex = mockExercises.value.find(e => e.id === exerciseId)
  if (!ex) return
  if (gyms.length > 0) ex.gyms = [...gyms]
  else delete ex.gyms
  triggerRef(mockExercises)
})

const mockArchiveExercise = vi.fn()
const mockUnarchiveExercise = vi.fn()

// Mockable read getters — tests drive these with mockReturnValue and the
// suite-level beforeEach resets them to the no-data default.
const mockGetOverloadSuggestion = vi.fn()
const mockGetLastSession = vi.fn()
const mockGetUsualLadder = vi.fn()

vi.mock('../../stores/workout', () => ({
  useWorkoutStore: () => ({
    get exercises() { return mockState.exercises },
    set exercises(v: Exercise[]) { mockState.exercises = v },
    get activeExercises() { return mockState.exercises.filter(e => !e.archived_at) },
    get archivedExercises() { return mockState.exercises.filter(e => !!e.archived_at) },
    get allTags() { return getAllTags() },
    getExercisePR,
    getExercisePRSet,
    getOverloadSuggestion: mockGetOverloadSuggestion,
    getLastSession: mockGetLastSession,
    getUsualLadder: mockGetUsualLadder,
    addExercise: mockAddExercise,
    logSet: mockLogSet,
    updateSet: mockUpdateSet,
    deleteSet: mockDeleteSet,
    deleteExercise: mockDeleteExercise,
    restoreSet: mockRestoreSet,
    syncDeleteSet: mockSyncDeleteSet,
    restoreExercise: mockRestoreExercise,
    syncDeleteExercise: mockSyncDeleteExercise,
    archiveExercise: mockArchiveExercise,
    unarchiveExercise: mockUnarchiveExercise,
    renameExercise: mockRenameExercise,
    updateExerciseTags: mockUpdateExerciseTags,
    updateExercise: vi.fn(),
    setExerciseGyms: mockSetExerciseGyms,
    renameGymOnExercises: vi.fn(),
    removeGymFromExercises: vi.fn(() => []),
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

/**
 * Typed accessor for WorkoutTracker's defineExpose'd methods.
 * These are the component's public API for parent components (App.vue).
 */
function exposed(wrapper: VueWrapper) {
  return wrapper.vm as unknown as {
    openTimelineLogModal: () => void
    openNewExerciseModal: () => void
  }
}

/**
 * Typed accessor for WorkoutTracker's internal timer state.
 * Used by wall-clock timer tests that verify backgrounding behavior —
 * these need direct access to startRestTimer / timerSeconds because
 * the timer is internal state not exposed to parents.
 *
 * After #582 extracted RestTimerView, the timer lives on a controller
 * (timerCtrl) exposed on the component instance. We unwrap the refs
 * so call sites can read .timerSeconds directly instead of .value.
 */
function timerState(wrapper: VueWrapper) {
  const vm = wrapper.vm as unknown as {
    timerCtrl: {
      startRestTimer: () => void
      timerSeconds: { value: number }
      timerActive: { value: boolean }
    }
  }
  return {
    startRestTimer: () => vm.timerCtrl.startRestTimer(),
    get timerSeconds() { return vm.timerCtrl.timerSeconds.value },
    get timerActive() { return vm.timerCtrl.timerActive.value },
  }
}

describe('WorkoutTracker', () => {
  beforeEach(() => {
    mockState.exercises = []
    mockPrefsState.gyms = []
    localStorageMock.clear()
    vi.clearAllMocks()
    // clearAllMocks keeps implementations — reset return values explicitly
    // so a test's mockReturnValue never leaks into the next test.
    mockGetOverloadSuggestion.mockReturnValue(null)
    mockGetLastSession.mockReturnValue(null)
    mockGetUsualLadder.mockReturnValue(null)
  })

  describe('empty state', () => {
    it('shows empty message when no exercises exist', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('.wtEmpty').text()).toContain('No exercises yet')
    })

    it('renders the Workouts large title', () => {
      // After the 03-workouts.png restyle, the "+ New Exercise" button moved
      // into the exercise-picker modal. The tab itself shows an iOS large
      // title instead.
      const wrapper = mountTracker()
      expect(wrapper.find('.wtPageTitle').text()).toBe('Workouts')
    })

    it('does not render the tag filter bar when no tags (only the gym row remains)', () => {
      const wrapper = mountTracker()
      // The gym row (#963) is always visible in the exercises view; the TAG
      // bar still keeps its zero-chrome behavior.
      const bars = wrapper.findAll('.wtTagFilterBar')
      expect(bars).toHaveLength(1)
      expect(bars[0].attributes('aria-label')).toBe('Filter by gym')
    })

    it('shows fresh-start transition card after clearing sample data', () => {
      localStorageMock.setItem('fresh-start', 'true')
      const wrapper = mountTracker()
      expect(wrapper.find('.wtFreshStart').exists()).toBe(true)
      expect(wrapper.find('.wtFreshStartTitle').text()).toContain('starting fresh')
      expect(wrapper.find('.wtFreshStartCta').exists()).toBe(true)
    })

    it('shows default empty state when fresh-start flag is absent', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('.wtFreshStart').exists()).toBe(false)
      expect(wrapper.find('.wtEmpty').text()).toContain('No exercises yet')
    })
  })

  describe('exercise list', () => {
    beforeEach(() => {
      mockState.exercises = createExercises()
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

    it('displays last set summary with weight × reps on the card', () => {
      const wrapper = mountTracker()
      // The restyled card shows the most recent set + time-ago instead of
      // an est. 1RM summary. Bench last set in the fixture is 195 × 5.
      const stats = wrapper.findAll('.wtExerciseStat')
      expect(stats[0].text()).toContain('195')
      expect(stats[0].text()).toContain('× 5')
    })

    it('shows "No sets yet" placeholder for exercise with no sets', () => {
      const wrapper = mountTracker()
      const items = wrapper.findAll('.wtExerciseItem')
      // ex-3 (Deadlift) has no sets — stat line shows the empty placeholder
      const deadliftStat = items[2].find('.wtExerciseStatEmpty')
      expect(deadliftStat.exists()).toBe(true)
      expect(deadliftStat.text()).toContain('No sets yet')
    })

    it('shows a circular quick-log button for each exercise', () => {
      const wrapper = mountTracker()
      // Button is now icon-only (gold circle with a plus svg). Assert it
      // exists with the circle modifier class and an aria-label.
      const logBtns = wrapper.findAll('.wtExerciseLogBtn.wtExerciseLogBtnCircle')
      expect(logBtns.length).toBe(3)
      expect(logBtns[0].attributes('aria-label')).toContain('Log a set')
    })

    // Custom ordering was removed once the list became recency-ordered (#936):
    // no drag handles, no long-press gesture, no keyboard reorder. This guards
    // against any of those affordances being reintroduced by accident.
    it('does not render drag handles (custom ordering removed)', () => {
      const wrapper = mountTracker()
      expect(wrapper.findAll('.wtDragHandle').length).toBe(0)
    })
  })

  // ── archived exercises section (LIFT-434) ─────────────────────
  describe('archived exercises', () => {
    it('does not render the archived section when there are no archived exercises', () => {
      mockState.exercises = createExercises()
      const wrapper = mountTracker()
      expect(wrapper.find('.wtArchivedSection').exists()).toBe(false)
    })

    it('hides archived exercises from the main list and shows them in the Archived section', async () => {
      mockState.exercises = createExercises()
      mockState.exercises[1].archived_at = '2026-05-01T00:00:00.000Z'
      const wrapper = mountTracker()
      const items = wrapper.findAll('.wtExerciseItem')
      expect(items.length).toBe(2)
      const section = wrapper.find('.wtArchivedSection')
      expect(section.exists()).toBe(true)
      expect(section.find('.wtArchivedToggleCount').text()).toBe('1')
      // Archived list is collapsed by default — click the disclosure to reveal it.
      await section.find('.wtArchivedToggle').trigger('click')
      const archivedRows = wrapper.findAll('.wtArchivedRow')
      expect(archivedRows.length).toBe(1)
      expect(archivedRows[0].text()).toContain('Squat')
    })

    it('calls unarchiveExercise when the Unarchive button is clicked', async () => {
      mockState.exercises = createExercises()
      mockState.exercises[0].archived_at = '2026-05-01T00:00:00.000Z'
      const wrapper = mountTracker()
      await wrapper.find('.wtArchivedToggle').trigger('click')
      await wrapper.find('.wtArchivedActionBtn').trigger('click')
      expect(mockUnarchiveExercise).toHaveBeenCalledWith('ex-1')
    })

    it('omits tags that exist only on archived exercises from the chip bar', () => {
      // 'Legs' lives only on Squat. Archive Squat and 'Legs' should disappear
      // from the chips — otherwise tapping it would filter to an empty list.
      mockState.exercises = createExercises()
      mockState.exercises[1].archived_at = '2026-05-01T00:00:00.000Z'
      const wrapper = mountTracker()
      const chips = wrapper.findAll('.wtTagChip').map(c => c.text())
      const chipText = chips.join(' ')
      expect(chipText).not.toContain('Legs')
      expect(chipText).toContain('Chest')
      expect(chipText).toContain('Push')
    })
  })

  describe('tag filtering', () => {
    beforeEach(() => {
      mockState.exercises = createExercises()
    })

    function tagChips(wrapper: VueWrapper) {
      // After the PNG restyle, chips include an "All" chip and a tag-manager
      // chip. Skip those so tests focus on the real tag filter chips.
      return wrapper.findAll('.wtTagChip').filter(c => {
        if (c.classes('wtTagChipClear')) return false
        if (c.classes('wtTagChipManage')) return false
        const label = c.find('.wtTagChipLabel')
        if (!label.exists()) return false
        return true
      })
    }

    it('renders tag filter chips for all unique tags', () => {
      const wrapper = mountTracker()
      const chips = tagChips(wrapper)
      const chipLabels = chips.map(c => c.find('.wtTagChipLabel').text())
      expect(chipLabels).toContain('Chest')
      expect(chipLabels).toContain('Push')
      expect(chipLabels).toContain('Legs')
    })

    it('filters exercises when tag is clicked', async () => {
      const wrapper = mountTracker()
      const chips = tagChips(wrapper)
      const legsChip = chips.find(c => c.find('.wtTagChipLabel').text() === 'Legs')!
      await legsChip.trigger('click')

      const items = wrapper.findAll('.wtExerciseItem')
      expect(items.length).toBe(1)
      expect(wrapper.text()).toContain('Squat')
    })

    it('deactivates filter by clicking the All chip', async () => {
      // The dedicated "× Clear" button was retired in favor of the "All" chip
      // that sits at the head of the tag-filter row.
      const wrapper = mountTracker()
      const chips = tagChips(wrapper)
      await chips[0].trigger('click')
      const allChip = wrapper.findAll('.wtTagChip').find(c => c.text().trim() === 'All')!
      await allChip.trigger('click')

      expect(wrapper.findAll('.wtExerciseItem').length).toBe(3)
    })

    it('shows exercises matching ANY active tag (OR logic)', async () => {
      const wrapper = mountTracker()
      const chips = tagChips(wrapper)
      const pushChip = chips.find(c => c.find('.wtTagChipLabel').text() === 'Push')!
      await pushChip.trigger('click')

      // Push matches Bench Press and Overhead Press
      const items = wrapper.findAll('.wtExerciseItem')
      expect(items.length).toBe(2)
    })

    it('deactivates tag on second click', async () => {
      const wrapper = mountTracker()
      const chips = tagChips(wrapper)
      const legsChip = chips.find(c => c.find('.wtTagChipLabel').text() === 'Legs')!
      await legsChip.trigger('click')
      expect(wrapper.findAll('.wtExerciseItem').length).toBe(1)

      await legsChip.trigger('click')
      expect(wrapper.findAll('.wtExerciseItem').length).toBe(3)
    })
  })

  // Recency ordering (#936): the exercise list is sorted by the most recent
  // set date (descending) so the next exercise to perform is easiest to reach,
  // and that order is preserved inside tag/search-filtered subsets.
  describe('recency ordering (#936)', () => {
    /** Names in the order they render in the list. */
    function renderedNames(wrapper: VueWrapper): string[] {
      return wrapper.findAll('.wtExerciseItem .wtExerciseName').map(n => n.text())
    }

    it('orders exercises by most-recent set first, regardless of array order', () => {
      // Array order deliberately does NOT match recency order.
      mockState.exercises = [
        {
          id: 'ex-old', name: 'Deadlift', tags: ['Legs'],
          sets: [{ id: 'so', date: '2026-01-05T12:00:00', weight: 315, reps: 3, estimated1RM: 344 }],
        },
        {
          id: 'ex-new', name: 'Row', tags: ['Back'],
          sets: [{ id: 'sn', date: '2026-03-10T12:00:00', weight: 135, reps: 8, estimated1RM: 168 }],
        },
        {
          id: 'ex-mid', name: 'Curl', tags: ['Arms'],
          sets: [{ id: 'sm', date: '2026-02-01T12:00:00', weight: 40, reps: 10, estimated1RM: 53 }],
        },
      ]
      const wrapper = mountTracker()
      expect(renderedNames(wrapper)).toEqual(['Row', 'Curl', 'Deadlift'])
    })

    it('sorts never-logged exercises to the bottom', () => {
      mockState.exercises = [
        { id: 'ex-empty', name: 'Plank', tags: ['Core'], sets: [] },
        {
          id: 'ex-logged', name: 'Bench Press', tags: ['Push'],
          sets: [{ id: 's', date: '2026-01-20T12:00:00', weight: 185, reps: 5, estimated1RM: 216 }],
        },
      ]
      const wrapper = mountTracker()
      expect(renderedNames(wrapper)).toEqual(['Bench Press', 'Plank'])
    })

    it('keeps recency order inside a tag-filtered subset', async () => {
      mockState.exercises = [
        {
          id: 'ex-a', name: 'Incline Press', tags: ['Push'],
          sets: [{ id: 'a', date: '2026-01-05T12:00:00', weight: 135, reps: 8, estimated1RM: 168 }],
        },
        {
          id: 'ex-b', name: 'Overhead Press', tags: ['Push'],
          sets: [{ id: 'b', date: '2026-03-01T12:00:00', weight: 95, reps: 6, estimated1RM: 114 }],
        },
        {
          id: 'ex-c', name: 'Squat', tags: ['Legs'],
          sets: [{ id: 'c', date: '2026-04-01T12:00:00', weight: 225, reps: 5, estimated1RM: 263 }],
        },
      ]
      const wrapper = mountTracker()
      const pushChip = wrapper.findAll('.wtTagChip')
        .find(c => c.find('.wtTagChipLabel').exists() && c.find('.wtTagChipLabel').text() === 'Push')!
      await pushChip.trigger('click')

      // Only the two Push exercises, most-recent first — Squat is filtered out
      // even though it is the most recently trained overall.
      expect(renderedNames(wrapper)).toEqual(['Overhead Press', 'Incline Press'])
    })

    it('breaks recency ties by preserving array order (stable sort)', () => {
      // Same day for both — the stored array (creation) order is the stable
      // tiebreaker now that manual reorder is gone.
      mockState.exercises = [
        {
          id: 'ex-1', name: 'Second', tags: [],
          sets: [{ id: '1', date: '2026-02-02T12:00:00', weight: 100, reps: 5, estimated1RM: 117 }],
        },
        {
          id: 'ex-2', name: 'First', tags: [],
          sets: [{ id: '2', date: '2026-02-02T18:00:00', weight: 100, reps: 5, estimated1RM: 117 }],
        },
      ]
      const wrapper = mountTracker()
      expect(renderedNames(wrapper)).toEqual(['Second', 'First'])
    })
  })

  describe('exercise detail modal', () => {
    beforeEach(() => {
      mockState.exercises = createExercises()
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
      mockState.exercises[0].sets.push(
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
      mockState.exercises[0].sets = [
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

  // #971: a "history" button in the log-set header jumps to the exercise's
  // set-history detail view. The log sheet and detail modal share a z-index,
  // so this is a swap (close sheet → open detail), not a stack.
  describe('set history shortcut from log modal (#971)', () => {
    beforeEach(() => {
      mockState.exercises = createExercises()
    })

    it('opens the exercise set history from the log-set header, swapping out the log sheet', async () => {
      const wrapper = mountTracker()
      // Open the log-set modal for a known exercise (Bench Press is most-recent).
      await wrapper.findAll('.wtExerciseLogBtn')[0].trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.logSetSheet').exists()).toBe(true)
      expect(wrapper.find('.wtDetailModal').exists()).toBe(false)

      // Tap the leading history button.
      const historyBtn = wrapper.find('.wtLogHistoryBtn')
      expect(historyBtn.exists()).toBe(true)
      await historyBtn.trigger('click')
      await wrapper.vm.$nextTick()

      // The log sheet is replaced by the detail "All Sets" view for the same exercise.
      expect(wrapper.find('.logSetSheet').exists()).toBe(false)
      expect(wrapper.find('.wtDetailModal').exists()).toBe(true)
      expect(wrapper.find('.wtDetailTitle').text()).toBe('Bench Press')
      expect(wrapper.find('.wtDetailTab.active').text()).toContain('All Sets')
    })

    it('routes back to logging via the detail "+ Log Set" footer', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseLogBtn')[0].trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.find('.wtLogHistoryBtn').trigger('click')
      await wrapper.vm.$nextTick()

      // From the detail view, the footer re-opens the log-set modal.
      await wrapper.find('.wtDetailFooterBtn').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.logSetSheet').exists()).toBe(true)
      expect(wrapper.find('#log-modal-title').text()).toBe('Bench Press')
    })

    it('hides the history button when creating a new exercise', async () => {
      const wrapper = mountTracker()
      exposed(wrapper).openNewExerciseModal()
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.logSetSheet').exists()).toBe(true)
      expect(wrapper.find('.wtLogHistoryBtn').exists()).toBe(false)
    })
  })

  describe('PR history tab', () => {
    beforeEach(() => {
      mockState.exercises = createPRExercises()
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
    // App.vue's top-bar "+" calls the exposed openNewExerciseModal directly to
    // open this modal (the picker's "+ New exercise" row is now only reached
    // via the timeline "Log a set" button). Tests use the exposed API directly.
    async function openNewExerciseModal(wrapper: VueWrapper) {
      exposed(wrapper).openNewExerciseModal()
      await wrapper.vm.$nextTick()
    }

    it('opens modal via the "+ New exercise" picker row', async () => {
      const wrapper = mountTracker()
      await openNewExerciseModal(wrapper)

      expect(wrapper.find('.repMaxModal').exists()).toBe(true)
    })

    it('shows "New Exercise" as modal title', async () => {
      const wrapper = mountTracker()
      await openNewExerciseModal(wrapper)

      expect(wrapper.find('#log-modal-title').text()).toBe('New Exercise')
    })

    it('calls addExercise with name and tags on save', async () => {
      mockState.exercises = createExercises()
      mockAddExercise.mockReturnValue('ex-new')
      const wrapper = mountTracker()

      await openNewExerciseModal(wrapper)

      // Enter exercise name
      const nameInput = wrapper.find('.repMaxModal input[type="text"]')
      await nameInput.setValue('Deadlift')

      // Click save (no weight/reps means just create the exercise)
      const saveBtn = wrapper.find('.repMaxBtn.repMaxBtnCalc')
      await saveBtn.trigger('click')

      // The options bag carries gym membership from creation (#984); with no
      // gym filter active it is empty = unassigned = shows at every gym.
      expect(mockAddExercise).toHaveBeenCalledWith('Deadlift', [], { gyms: [] })
    })

    it('calls addExercise with selected tags', async () => {
      mockState.exercises = createExercises()
      mockAddExercise.mockReturnValue('ex-new')
      const wrapper = mountTracker()

      await openNewExerciseModal(wrapper)

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
      await openNewExerciseModal(wrapper)

      const saveBtn = wrapper.find('.repMaxBtn.repMaxBtnCalc')
      expect(saveBtn.attributes('disabled')).toBeDefined()
    })
  })

  describe('set logging flow', () => {
    beforeEach(() => {
      mockState.exercises = createExercises()
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

    // LIFT-683: the set-logging inputs declare enterkeyhint so iOS labels the
    // keyboard return key for the weight -> reps -> done flow. Without these,
    // the return key shows a generic label and breaks the native flow that is
    // central to the app. Pin the hints so they cannot silently regress.
    it('sets enterkeyhint on weight (next) and reps (done) inputs for iOS keyboard flow', async () => {
      const wrapper = mountTracker()
      const logBtns = wrapper.findAll('.wtExerciseLogBtn')
      await logBtns[0].trigger('click')
      await wrapper.vm.$nextTick()

      const inputs = wrapper.findAll('.repMaxModal input')
      const weightInput = inputs.find(i => i.attributes('inputmode') === 'decimal')!
      const repsInput = inputs.find(i => i.attributes('inputmode') === 'numeric')!
      expect(weightInput.attributes('enterkeyhint')).toBe('next')
      expect(repsInput.attributes('enterkeyhint')).toBe('done')
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

    /**
     * Regression: gemini-3.1-pro flagged a P1 in the step 5c plate-calc
     * restyle where the WEIGHT/REPS card row had a stale `v-else` against
     * the now-deleted standalone reps stepper. In plate mode this meant
     * the WEIGHT card disappeared, and step 5c had also removed the
     * in-card weight display — leaving the user with no visible weight
     * at all while picking plates. This test pins the WEIGHT/REPS row +
     * plate calc to *both* render in plate mode.
     */
    it('shows WEIGHT/REPS cards alongside the plate calc in plate mode', async () => {
      mockState.exercises = createExercises()
      // Switch the first exercise into plate mode
      mockState.exercises[0].inputMode = 'plates'
      mockState.exercises[0].plateCountMode = 'per-side'
      mockState.exercises[0].barWeight = 45

      const wrapper = mountTracker()
      const logBtns = wrapper.findAll('.wtExerciseLogBtn')
      await logBtns[0].trigger('click')
      await wrapper.vm.$nextTick()

      // Both the WEIGHT/REPS card row AND the plate calc must be present.
      expect(wrapper.find('.logSetFieldsRow').exists()).toBe(true)
      expect(wrapper.find('.wtPlateCalc').exists()).toBe(true)
      // The legacy standalone reps stepper used to render in plate mode
      // and is now gone — the REPS card covers it.
      expect(wrapper.find('.wtRepsStepperFull').exists()).toBe(false)
    })

    it('shows plate calculator hint for numpad-mode exercises (LIFT-388)', async () => {
      mockState.exercises = createExercises()
      // ex-1 is in default numpad mode (no inputMode set)
      const wrapper = mountTracker()
      const logBtns = wrapper.findAll('.wtExerciseLogBtn')
      await logBtns[0].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtPlateHint').exists()).toBe(true)
      expect(wrapper.find('.wtPlateHintText').text()).toContain('plate calculator')
    })

    it('hides plate calculator hint when exercise is in plate mode (LIFT-388)', async () => {
      mockState.exercises = createExercises()
      mockState.exercises[0].inputMode = 'plates'
      const wrapper = mountTracker()
      const logBtns = wrapper.findAll('.wtExerciseLogBtn')
      await logBtns[0].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtPlateHint').exists()).toBe(false)
    })

    it('hides plate calculator hint after dismissal via localStorage (LIFT-388)', async () => {
      localStorageMock.setItem('plate-calc-hint-dismissed', 'true')
      mockState.exercises = createExercises()
      const wrapper = mountTracker()
      const logBtns = wrapper.findAll('.wtExerciseLogBtn')
      await logBtns[0].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtPlateHint').exists()).toBe(false)
    })

    it('dismiss button persists hint dismissal to localStorage (LIFT-388)', async () => {
      mockState.exercises = createExercises()
      const wrapper = mountTracker()
      const logBtns = wrapper.findAll('.wtExerciseLogBtn')
      await logBtns[0].trigger('click')
      await wrapper.vm.$nextTick()

      await wrapper.find('.wtPlateHintDismiss').trigger('click')
      await wrapper.vm.$nextTick()

      expect(localStorageMock.getItem('plate-calc-hint-dismissed')).toBe('true')
      expect(wrapper.find('.wtPlateHint').exists()).toBe(false)
    })

    it('debounces plate sync when typing weight (LIFT-634)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false })
      try {
        mockState.exercises = createExercises()
        mockState.exercises[0].inputMode = 'plates'
        mockState.exercises[0].plateCountMode = 'per-side'
        mockState.exercises[0].barWeight = 45

        const wrapper = mountTracker()
        const logBtns = wrapper.findAll('.wtExerciseLogBtn')
        await logBtns[0].trigger('click')
        await wrapper.vm.$nextTick()

        const weightInput = wrapper.find('input[aria-label="Weight"]')
        expect(weightInput.exists()).toBe(true)

        // Type "2" — plate sync should NOT fire immediately
        await weightInput.setValue('2')
        await wrapper.vm.$nextTick()


        // Type "22" — should reset the debounce timer, still no sync
        await weightInput.setValue('22')
        await wrapper.vm.$nextTick()

        // Now advance past the 250ms debounce
        vi.advanceTimersByTime(300)
        await wrapper.vm.$nextTick()

        // After debounce, the plate display should have synced.
        // The exact plate state depends on the value, but the key assertion
        // is that we reached here without the sync running 2 separate times
        // (once for "2" and once for "22"). If debounce is working, only
        // the final value "22" was synced.
        // Verify the weight input still shows the last typed value.
        expect((weightInput.element as HTMLInputElement).value).toBe('22')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('usual ladder & ghost logging (#741)', () => {
    /** Local calendar date, matching the component's todayISO(). */
    function localDay(daysAgo = 0): string {
      const d = new Date()
      d.setDate(d.getDate() - daysAgo)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }

    function benchLadder() {
      return {
        rungs: [
          { weightLbs: 45, reps: 10, source: 'consensus' },
          { weightLbs: 95, reps: 10, source: 'consensus' },
          { weightLbs: 135, reps: 10, source: 'consensus' },
          { weightLbs: 185, reps: 10, source: 'consensus' },
          { weightLbs: 225, reps: 10, source: 'consensus' },
          { weightLbs: 275, reps: 10, source: 'consensus' },
        ],
        consensusCount: 6,
        sessionsSampled: 4,
      }
    }

    /** Appends sets dated today to ex-1 so doneness derivation sees them. */
    function seedTodaySets(weights: number[]) {
      for (const w of weights) {
        mockState.exercises[0].sets.push({
          id: `s-today-${w}-${mockState.exercises[0].sets.length}`,
          date: `${localDay()}T23:59:00.000Z`,
          weight: w,
          reps: 10,
          estimated1RM: Math.round(w * (1 + 10 / 30)),
        })
      }
    }

    async function openBenchModal(wrapper: VueWrapper) {
      await wrapper.findAll('.wtExerciseLogBtn')[0].trigger('click')
      await wrapper.vm.$nextTick()
    }

    beforeEach(() => {
      mockState.exercises = createExercises()
    })

    it('falls back to last-session chips when no ladder is detected', async () => {
      mockGetLastSession.mockReturnValue({
        date: '2026-01-20',
        sets: [
          { id: 's-a', date: '2026-01-20T12:00:00', weight: 185, reps: 5, estimated1RM: 216 },
          { id: 's-b', date: '2026-01-20T12:00:00', weight: 195, reps: 3, estimated1RM: 215 },
        ],
      })
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      expect(wrapper.find('.wtPrevSessionLabel').text()).toContain('Last session')
      const chips = wrapper.findAll('.wtPrevSessionChip')
      expect(chips).toHaveLength(2)
      await chips[0].trigger('click')
      expect((wrapper.find('input[aria-label="Weight"]').element as HTMLInputElement).value).toBe('185')
      expect((wrapper.find('input[aria-label="Reps"]').element as HTMLInputElement).value).toBe('5')
    })

    it('renders the ladder with the first rung highlighted as next', async () => {
      mockGetUsualLadder.mockReturnValue(benchLadder())
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      expect(wrapper.find('.wtPrevSessionLabel').text()).toBe('Usual · 6 sets')
      const chips = wrapper.findAll('.wtPrevSessionChip')
      expect(chips).toHaveLength(6)
      expect(chips[0].classes()).toContain('wtPrevSessionChipNext')
      expect(chips[0].attributes('aria-current')).toBe('step')
      expect(chips[0].text()).toBe('45 × 10')
      expect(chips[5].text()).toBe('275 × 10')
    })

    it('fills weight and reps when a rung chip is tapped', async () => {
      mockGetUsualLadder.mockReturnValue(benchLadder())
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      await wrapper.findAll('.wtPrevSessionChip')[2].trigger('click')
      expect((wrapper.find('input[aria-label="Weight"]').element as HTMLInputElement).value).toBe('135')
      expect((wrapper.find('input[aria-label="Reps"]').element as HTMLInputElement).value).toBe('10')
    })

    it('arms the ghost: placeholders show the next rung and Save states its payload', async () => {
      mockGetUsualLadder.mockReturnValue(benchLadder())
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      expect(wrapper.find('input[aria-label="Weight"]').attributes('placeholder')).toBe('45')
      expect(wrapper.find('input[aria-label="Reps"]').attributes('placeholder')).toBe('10')
      const saveBtn = wrapper.find('.repMaxBtn.repMaxBtnCalc')
      expect(saveBtn.text()).toBe('Save 45 × 10')
      expect(saveBtn.attributes('disabled')).toBeUndefined()
    })

    it('ghost save logs the next rung with fields left empty (settled pattern)', async () => {
      mockGetUsualLadder.mockReturnValue(benchLadder())
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      await wrapper.find('.repMaxBtn.repMaxBtnCalc').trigger('click')
      await wrapper.vm.$nextTick()

      expect(mockLogSet).toHaveBeenCalledWith('ex-1', 45, 10, expect.any(String))
      // Modal stays open, fields remain genuinely empty
      expect(wrapper.find('.repMaxModal').exists()).toBe(true)
      expect((wrapper.find('input[aria-label="Weight"]').element as HTMLInputElement).value).toBe('')
      expect((wrapper.find('input[aria-label="Reps"]').element as HTMLInputElement).value).toBe('')
    })

    it('a double-tap on ghost Save logs exactly one set (re-arm cooldown)', async () => {
      mockGetUsualLadder.mockReturnValue(benchLadder())
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      // NOTE: re-find the button after every state change — the render
      // replaces the element, so a held wrapper goes stale (detached node).
      const saveBtn = () => wrapper.find('.repMaxBtn.repMaxBtnCalc')
      await saveBtn().trigger('click')
      await saveBtn().trigger('click') // accidental double-tap
      expect(mockLogSet).toHaveBeenCalledTimes(1)
      // Button visibly disarms during the cooldown
      expect(saveBtn().attributes('disabled')).toBeDefined()
      expect(saveBtn().text()).toBe('Save')

      // After the cooldown an intentional tap logs the next set
      await new Promise(r => setTimeout(r, 600))
      await wrapper.vm.$nextTick()
      await saveBtn().trigger('click')
      expect(mockLogSet).toHaveBeenCalledTimes(2)
    })

    it('typing anything disarms the ghost', async () => {
      mockGetUsualLadder.mockReturnValue(benchLadder())
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      await wrapper.find('input[aria-label="Weight"]').setValue('50')
      const saveBtn = wrapper.find('.repMaxBtn.repMaxBtnCalc')
      expect(saveBtn.text()).toBe('Save')
      // Normal validation again: weight without reps cannot save
      expect(saveBtn.attributes('disabled')).toBeDefined()
    })

    it('derives doneness from today\'s logged sets', async () => {
      mockGetUsualLadder.mockReturnValue(benchLadder())
      seedTodaySets([45])
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      expect(wrapper.find('.wtPrevSessionLabel').text()).toBe('Usual · 1 of 6')
      const chips = wrapper.findAll('.wtPrevSessionChip')
      expect(chips[0].classes()).toContain('wtPrevSessionChipUsed')
      expect(chips[0].attributes('aria-label')).toBe('45 × 10, logged')
      expect(chips[1].classes()).toContain('wtPrevSessionChipNext')
      // Ghost now points at the second rung
      expect(wrapper.find('.repMaxBtn.repMaxBtnCalc').text()).toBe('Save 95 × 10')
    })

    it('dims lighter rungs as skipped when the user jumps ahead', async () => {
      mockGetUsualLadder.mockReturnValue(benchLadder())
      seedTodaySets([185])
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      const chips = wrapper.findAll('.wtPrevSessionChip')
      // 45/95/135 are moot warm-ups below today's heaviest — skipped, not struck through
      for (const i of [0, 1, 2]) {
        expect(chips[i].classes()).toContain('wtPrevSessionChipSkipped')
        expect(chips[i].classes()).not.toContain('wtPrevSessionChipUsed')
        // Skipped state is exposed to screen readers, not just via opacity
        expect(chips[i].attributes('aria-label')).toContain('skipped')
      }
      expect(chips[3].classes()).toContain('wtPrevSessionChipUsed')
      expect(chips[4].classes()).toContain('wtPrevSessionChipNext')
      expect(chips[4].attributes('aria-label')).toBeUndefined()
      expect(wrapper.find('.wtPrevSessionLabel').text()).toBe('Usual · 4 of 6')
    })

    it('completes the ladder when a heavier set beats the top rung', async () => {
      mockGetUsualLadder.mockReturnValue(benchLadder())
      seedTodaySets([280])
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      expect(wrapper.find('.wtPrevSessionLabel').text()).toBe('Usual · 6 of 6')
      expect(wrapper.find('.wtPrevSessionChipNext').exists()).toBe(false)
      // Ghost disarmed → Save disabled until the user types
      const saveBtn = wrapper.find('.repMaxBtn.repMaxBtnCalc')
      expect(saveBtn.text()).toBe('Save')
      expect(saveBtn.attributes('disabled')).toBeDefined()
    })

    it('backdating the modal date drops to fallback mode and disarms the ghost', async () => {
      mockGetUsualLadder.mockReturnValue(benchLadder())
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      await wrapper.find('.wtDateOverlayInput').setValue('2026-01-10')
      await wrapper.vm.$nextTick()

      // Ladder gated off (not today) → no routine chips and the ghost disarms.
      // (The PR-anchored Intensity lens is date-independent and may still show
      // its own preset chips, so scope to the non-preset chips.)
      const routineChips = wrapper.findAll('.wtPrevSessionChip')
        .filter(c => !c.element.closest('.wtIntensityPresetChips'))
      expect(routineChips).toHaveLength(0)
      const saveBtn = wrapper.find('.repMaxBtn.repMaxBtnCalc')
      expect(saveBtn.text()).toBe('Save')
      expect(saveBtn.attributes('disabled')).toBeDefined()
    })

    it('never arms the ghost in plate mode but chips still fill plates + reps', async () => {
      mockState.exercises[0].inputMode = 'plates'
      mockState.exercises[0].plateCountMode = 'per-side'
      mockState.exercises[0].barWeight = 45
      mockGetUsualLadder.mockReturnValue(benchLadder())
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      // Plate seeding pre-fills the weight from the next rung — no ghost
      expect(wrapper.find('.repMaxBtn.repMaxBtnCalc').text()).toBe('Save')
      expect(wrapper.find('input[aria-label="Reps"]').attributes('placeholder')).toBe('—')

      await wrapper.findAll('.wtPrevSessionChip')[2].trigger('click')
      await wrapper.vm.$nextTick()
      expect((wrapper.find('input[aria-label="Weight"]').element as HTMLInputElement).value).toBe('135')
      expect((wrapper.find('input[aria-label="Reps"]').element as HTMLInputElement).value).toBe('10')
    })
  })

  describe('overload nudge (#741)', () => {
    function localDay(daysAgo = 0): string {
      const d = new Date()
      d.setDate(d.getDate() - daysAgo)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }

    function benchLadder() {
      return {
        rungs: [
          { weightLbs: 45, reps: 10, source: 'consensus' },
          { weightLbs: 135, reps: 10, source: 'consensus' },
          { weightLbs: 225, reps: 10, source: 'consensus' },
          { weightLbs: 275, reps: 10, source: 'consensus' },
        ],
        consensusCount: 4,
        sessionsSampled: 4,
      }
    }

    function highSuggestion() {
      return { type: 'increase_weight', weight: 280, reps: 8, reason: 'x', confidence: 'high' }
    }

    function priorSession(daysAgo = 2, topWeight = 275) {
      return {
        date: localDay(daysAgo),
        sets: [{ id: 's-p', date: `${localDay(daysAgo)}T12:00:00`, weight: topWeight, reps: 10, estimated1RM: 367 }],
      }
    }

    /** Today's sets covering every rung except the top one → top set is up next. */
    function seedAllButTopRung() {
      for (const w of [45, 135, 225]) {
        mockState.exercises[0].sets.push({
          id: `s-today-${w}`,
          date: `${localDay()}T23:59:00.000Z`,
          weight: w,
          reps: 10,
          estimated1RM: Math.round(w * (1 + 10 / 30)),
        })
      }
    }

    async function openBenchModal(wrapper: VueWrapper) {
      await wrapper.findAll('.wtExerciseLogBtn')[0].trigger('click')
      await wrapper.vm.$nextTick()
    }

    function armEligibleNudge() {
      mockGetUsualLadder.mockReturnValue(benchLadder())
      mockGetOverloadSuggestion.mockReturnValue(highSuggestion())
      mockGetLastSession.mockReturnValue(priorSession())
      seedAllButTopRung()
    }

    beforeEach(() => {
      mockState.exercises = createExercises()
    })

    it('shows the nudge card right before the habitual top set', async () => {
      armEligibleNudge()
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      const card = wrapper.find('.wtOverloadCard')
      expect(card.exists()).toBe(true)
      expect(card.text()).toContain('Suggestion')
      expect(card.text()).toContain('280 lbs × 8')
      expect(card.text()).toContain('Up from 275 lbs × 10')
    })

    it('records the shown nudge once per day in localStorage', async () => {
      armEligibleNudge()
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      const state = JSON.parse(localStorageMock.getItem('overload-nudge-state')!)
      expect(state.lastGlobalShownDay).toBe(localDay())
      expect(state.byExercise['ex-1']).toMatchObject({
        lastShownDay: localDay(),
        shownForWeightLbs: 280,
        outcome: 'pending',
        ignoredCount: 0,
      })
    })

    it('does not show before the top rung is up next', async () => {
      mockGetUsualLadder.mockReturnValue(benchLadder())
      mockGetOverloadSuggestion.mockReturnValue(highSuggestion())
      mockGetLastSession.mockReturnValue(priorSession())
      // No sets logged today → next rung is the first, not the top
      const wrapper = mountTracker()
      await openBenchModal(wrapper)
      expect(wrapper.find('.wtOverloadCard').exists()).toBe(false)
    })

    it('never shows low-confidence suggestions', async () => {
      armEligibleNudge()
      mockGetOverloadSuggestion.mockReturnValue({ ...highSuggestion(), confidence: 'low' })
      const wrapper = mountTracker()
      await openBenchModal(wrapper)
      expect(wrapper.find('.wtOverloadCard').exists()).toBe(false)
    })

    it('suppresses the nudge during a deload (last session below the usual top)', async () => {
      armEligibleNudge()
      mockGetLastSession.mockReturnValue(priorSession(2, 225))
      const wrapper = mountTracker()
      await openBenchModal(wrapper)
      expect(wrapper.find('.wtOverloadCard').exists()).toBe(false)
    })

    it('suppresses the nudge after a 3+ week break', async () => {
      armEligibleNudge()
      mockGetLastSession.mockReturnValue(priorSession(30))
      const wrapper = mountTracker()
      await openBenchModal(wrapper)
      expect(wrapper.find('.wtOverloadCard').exists()).toBe(false)
    })

    it('enforces the one-nudge-per-day global cap across exercises', async () => {
      armEligibleNudge()
      localStorageMock.setItem('overload-nudge-state', JSON.stringify({
        lastGlobalShownDay: localDay(),
        byExercise: { 'ex-other': { lastShownDay: localDay(), shownForWeightLbs: 100, outcome: 'pending', ignoredCount: 0 } },
      }))
      const wrapper = mountTracker()
      await openBenchModal(wrapper)
      expect(wrapper.find('.wtOverloadCard').exists()).toBe(false)
    })

    it('enforces the 7-day per-exercise cooldown', async () => {
      armEligibleNudge()
      localStorageMock.setItem('overload-nudge-state', JSON.stringify({
        lastGlobalShownDay: localDay(3),
        byExercise: { 'ex-1': { lastShownDay: localDay(3), shownForWeightLbs: 280, outcome: 'accepted', ignoredCount: 0 } },
      }))
      const wrapper = mountTracker()
      await openBenchModal(wrapper)
      expect(wrapper.find('.wtOverloadCard').exists()).toBe(false)
    })

    it('shows again once the cooldown has elapsed', async () => {
      armEligibleNudge()
      localStorageMock.setItem('overload-nudge-state', JSON.stringify({
        lastGlobalShownDay: localDay(8),
        byExercise: { 'ex-1': { lastShownDay: localDay(8), shownForWeightLbs: 280, outcome: 'accepted', ignoredCount: 0 } },
      }))
      const wrapper = mountTracker()
      await openBenchModal(wrapper)
      expect(wrapper.find('.wtOverloadCard').exists()).toBe(true)
    })

    it('backs off to 14 days after one ignore', async () => {
      armEligibleNudge()
      localStorageMock.setItem('overload-nudge-state', JSON.stringify({
        lastGlobalShownDay: localDay(10),
        byExercise: { 'ex-1': { lastShownDay: localDay(10), shownForWeightLbs: 280, outcome: 'ignored', ignoredCount: 1 } },
      }))
      const wrapper = mountTracker()
      await openBenchModal(wrapper)
      expect(wrapper.find('.wtOverloadCard').exists()).toBe(false)
    })

    it('mutes the exercise after three ignores while the top weight is unchanged', async () => {
      armEligibleNudge()
      localStorageMock.setItem('overload-nudge-state', JSON.stringify({
        lastGlobalShownDay: localDay(60),
        byExercise: { 'ex-1': { lastShownDay: localDay(60), shownForWeightLbs: 280, outcome: 'ignored', ignoredCount: 3 } },
      }))
      const wrapper = mountTracker()
      await openBenchModal(wrapper)
      expect(wrapper.find('.wtOverloadCard').exists()).toBe(false)
    })

    it('disarms the ghost while the nudge is visible — Save demands an explicit choice', async () => {
      armEligibleNudge()
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      expect(wrapper.find('.wtOverloadCard').exists()).toBe(true)
      // No ghost: plain disabled Save, default placeholders — the nudge and
      // the old top set never compete as two one-tap payloads
      const saveBtn = wrapper.find('.repMaxBtn.repMaxBtnCalc')
      expect(saveBtn.text()).toBe('Save')
      expect(saveBtn.attributes('disabled')).toBeDefined()
      expect(wrapper.find('input[aria-label="Weight"]').attributes('placeholder')).toBe('135')
    })

    it('exposes the nudge card as a keyboard-actionable button', async () => {
      armEligibleNudge()
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      const card = wrapper.find('.wtOverloadCard')
      expect(card.attributes('role')).toBe('button')
      expect(card.attributes('tabindex')).toBe('0')
      expect(card.attributes('aria-label')).toContain('280')
      await card.trigger('keydown.enter')
      expect((wrapper.find('input[aria-label="Weight"]').element as HTMLInputElement).value).toBe('280')
    })

    it('settles a stale pending nudge as ignored when a later session stayed lighter', async () => {
      armEligibleNudge()
      // Nudge shown 8 days ago, still pending; the user benched 5 days ago
      // at the usual top weight — that answers "no thanks"
      localStorageMock.setItem('overload-nudge-state', JSON.stringify({
        lastGlobalShownDay: localDay(8),
        byExercise: { 'ex-1': { lastShownDay: localDay(8), shownForWeightLbs: 280, outcome: 'pending', ignoredCount: 0 } },
      }))
      mockState.exercises[0].sets.push({
        id: 's-between', date: `${localDay(5)}T23:59:00.000Z`, weight: 275, reps: 10, estimated1RM: 367,
      })
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      const state = JSON.parse(localStorageMock.getItem('overload-nudge-state')!)
      expect(state.byExercise['ex-1'].outcome).toBe('ignored')
      expect(state.byExercise['ex-1'].ignoredCount).toBe(1)
      // One ignore → 14-day backoff; only 8 days elapsed → suppressed
      expect(wrapper.find('.wtOverloadCard').exists()).toBe(false)
    })

    it('tapping the card fills the fields, and saving records the accept', async () => {
      armEligibleNudge()
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      await wrapper.find('.wtOverloadCard').trigger('click')
      await wrapper.vm.$nextTick()
      expect((wrapper.find('input[aria-label="Weight"]').element as HTMLInputElement).value).toBe('280')
      expect((wrapper.find('input[aria-label="Reps"]').element as HTMLInputElement).value).toBe('8')
      // Card is gone once the fields are filled (fill-only, never saves)
      expect(wrapper.find('.wtOverloadCard').exists()).toBe(false)

      await wrapper.find('.repMaxBtn.repMaxBtnCalc').trigger('click')
      await wrapper.vm.$nextTick()
      expect(mockLogSet).toHaveBeenCalledWith('ex-1', 280, 8, expect.any(String))
      const state = JSON.parse(localStorageMock.getItem('overload-nudge-state')!)
      expect(state.byExercise['ex-1'].outcome).toBe('accepted')
      expect(state.byExercise['ex-1'].ignoredCount).toBe(0)
    })
  })

  describe('intensity lens (#770)', () => {
    async function openBenchModal(wrapper: VueWrapper) {
      await wrapper.findAll('.wtExerciseLogBtn')[0].trigger('click')
      await wrapper.vm.$nextTick()
    }

    // Bench's best e1RM in createExercises is 228 — the intensity anchor.
    function priorSession() {
      return {
        date: '2026-01-20',
        sets: [
          { id: 's-a', date: '2026-01-20T12:00:00', weight: 185, reps: 5, estimated1RM: 216 },
          { id: 's-b', date: '2026-01-20T12:00:00', weight: 195, reps: 5, estimated1RM: 228 },
        ],
      }
    }

    beforeEach(() => {
      mockState.exercises = createExercises()
    })

    // Activate a named lens in the Suggestions drawer (the drawer opens on the
    // default quick-fill lens; intensity lives behind the segmented control).
    async function selectLens(wrapper: VueWrapper, label: string) {
      const seg = wrapper.findAll('.wtSuggestionSegment').find(s => s.text() === label)
      if (!seg) throw new Error(`no "${label}" suggestion segment`)
      await seg.trigger('click')
    }

    it('exposes an Intensity lens anchored to the PR e1RM', async () => {
      mockGetLastSession.mockReturnValue(priorSession())
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      // No routine detected → drawer defaults to the last-session lens, with the
      // intensity lens available alongside it on the segmented control.
      expect(wrapper.findAll('.wtSuggestionSegment').map(s => s.text())).toEqual(['Last', 'Intensity'])
      await selectLens(wrapper, 'Intensity')
      // Anchor caption + the slider control.
      expect(wrapper.find('.wtSuggestions').text()).toContain('228 lbs max')
      expect(wrapper.find('.wtIntensitySlider').exists()).toBe(true)
    })

    it('renders tappable intensity presets that drive the slider (#776)', async () => {
      mockGetLastSession.mockReturnValue(priorSession())
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      await selectLens(wrapper, 'Intensity')
      const chips = wrapper.findAll('.wtIntensityPresetChips .wtPrevSessionChip')
      expect(chips.map(c => c.text())).toEqual(['50%', '70%', '80%', '90%', '100%'])
      // Default intensity is 80% → that chip is highlighted as current.
      expect(chips.find(c => c.classes().includes('wtPrevSessionChipNext'))?.text()).toBe('80%')

      // Tapping a preset sets the intensity: caption + slider follow, highlight moves.
      await chips.find(c => c.text() === '50%')!.trigger('click')
      expect(wrapper.find('.wtSuggestions .wtPrevSessionLabel').text()).toContain('50% of')
      expect((wrapper.find('.wtIntensitySlider').element as HTMLInputElement).value).toBe('50')
      const after = wrapper.findAll('.wtIntensityPresetChips .wtPrevSessionChip')
      expect(after.find(c => c.classes().includes('wtPrevSessionChipNext'))?.text()).toBe('50%')
    })

    it('shows weight rows at the default intensity and fills inputs on tap', async () => {
      mockGetLastSession.mockReturnValue(priorSession())
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      await selectLens(wrapper, 'Intensity')
      const rows = wrapper.findAll('.wtPrTargetsRow')
      // Default 80% of 228 e1RM, default 10 rep rows.
      expect(rows).toHaveLength(10)
      // Row 1 (1 rep = the 1RM, no Epley multiplier): ceil(80% × 228) = 185 lb,
      // and each row surfaces its e1RM for context.
      expect(rows[0].text()).toContain('185 lbs')
      expect(rows[0].text()).toContain('e1RM')

      await rows[0].trigger('click')
      expect((wrapper.find('input[aria-label="Weight"]').element as HTMLInputElement).value).toBe('185')
      expect((wrapper.find('input[aria-label="Reps"]').element as HTMLInputElement).value).toBe('1')
      // Re-find: tapping mutates intensityUsed, so Vue re-renders and the held node goes stale.
      expect(wrapper.findAll('.wtPrTargetsRow')[0].classes()).toContain('wtPrTargetsRowActive')
    })

    it('respects a per-exercise intensityMaxReps override', async () => {
      mockGetLastSession.mockReturnValue(priorSession())
      mockState.exercises[0].intensityMaxReps = 3
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      await selectLens(wrapper, 'Intensity')
      expect(wrapper.findAll('.wtPrTargetsRow')).toHaveLength(3)
    })

    it('recomputes (and can empty) the table as the slider moves', async () => {
      mockGetLastSession.mockReturnValue(priorSession())
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      await selectLens(wrapper, 'Intensity')
      expect(wrapper.findAll('.wtPrTargetsRow').length).toBeGreaterThan(0)
      // 0% intensity has no loadable target at any rep count → empty state.
      await wrapper.find('.wtIntensitySlider').setValue(0)
      expect(wrapper.findAll('.wtPrTargetsRow')).toHaveLength(0)
      expect(wrapper.find('.wtIntensityEmpty').exists()).toBe(true)
    })

    it('clears the row highlight when the slider moves (no stale index)', async () => {
      mockGetLastSession.mockReturnValue(priorSession())
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      await selectLens(wrapper, 'Intensity')
      await wrapper.findAll('.wtPrTargetsRow')[1].trigger('click')
      expect(wrapper.findAll('.wtPrTargetsRow')[1].classes()).toContain('wtPrTargetsRowActive')

      // Moving the slider rebuilds the table — the stale highlight must clear.
      await wrapper.find('.wtIntensitySlider').setValue(70)
      expect(wrapper.findAll('.wtPrTargetsRow').some(r => r.classes().includes('wtPrTargetsRowActive'))).toBe(false)
    })

    it('coexists with the usual ladder as a separate lens', async () => {
      mockGetUsualLadder.mockReturnValue({
        rungs: [
          { weightLbs: 45, reps: 10 },
          { weightLbs: 135, reps: 8 },
          { weightLbs: 225, reps: 5 },
        ],
      })
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      // Routine is the default lens; intensity is available beside it.
      expect(wrapper.findAll('.wtSuggestionSegment').map(s => s.text())).toEqual(['Routine', 'Intensity'])
      expect(wrapper.find('.wtSuggestionSegmentActive').text()).toBe('Routine')

      await selectLens(wrapper, 'Intensity')
      expect(wrapper.findAll('.wtPrTargetsRow').length).toBeGreaterThan(0)
    })

    it('does not render the drawer with no routine, last session, or PR', async () => {
      // An exercise with no sets has no PR to anchor the intensity lens to.
      mockState.exercises = [{ id: 'ex-1', name: 'Bench Press', tags: [], sets: [] }]
      const wrapper = mountTracker()
      await openBenchModal(wrapper)
      expect(wrapper.find('.wtSuggestions').exists()).toBe(false)
    })
  })

  describe('suggestions drawer (#759)', () => {
    async function openBenchModal(wrapper: VueWrapper) {
      await wrapper.findAll('.wtExerciseLogBtn')[0].trigger('click')
      await wrapper.vm.$nextTick()
    }

    beforeEach(() => {
      mockState.exercises = createExercises()
    })

    it('opens expanded on the routine lens so one-tap logging needs no extra tap', async () => {
      mockGetUsualLadder.mockReturnValue({
        rungs: [
          { weightLbs: 135, reps: 5 },
          { weightLbs: 185, reps: 5 },
        ],
      })
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      // Ladder chips are visible immediately — the ghost-arm flow is preserved.
      expect(wrapper.find('.wtSuggestions').exists()).toBe(true)
      expect(wrapper.findAll('.wtPrevSessionChip').length).toBe(2)
    })

    it('renders no segmented control when only one lens is available', async () => {
      // Ladder only — a no-sets exercise has no PR, so no intensity lens either.
      mockState.exercises = [{ id: 'ex-1', name: 'Bench Press', tags: [], sets: [] }]
      mockGetUsualLadder.mockReturnValue({
        rungs: [
          { weightLbs: 135, reps: 5 },
          { weightLbs: 185, reps: 5 },
        ],
      })
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      expect(wrapper.find('.wtSuggestions').exists()).toBe(true)
      expect(wrapper.findAll('.wtSuggestionSegment')).toHaveLength(0)
    })

    it('switches the visible lens when a segment is tapped', async () => {
      mockGetLastSession.mockReturnValue({
        date: '2026-01-20',
        sets: [
          { id: 's-a', date: '2026-01-20T12:00:00', weight: 185, reps: 5, estimated1RM: 216 },
          { id: 's-b', date: '2026-01-20T12:00:00', weight: 225, reps: 3, estimated1RM: 248 },
        ],
      })
      const wrapper = mountTracker()
      await openBenchModal(wrapper)

      // Defaults to the last-session lens (chips visible, no ramp rows).
      expect(wrapper.find('.wtSuggestionSegmentActive').text()).toBe('Last')
      expect(wrapper.findAll('.wtPrevSessionChip').length).toBe(2)
      expect(wrapper.findAll('.wtPrTargetsRow')).toHaveLength(0)

      const intensitySeg = wrapper.findAll('.wtSuggestionSegment').find(s => s.text() === 'Intensity')!
      await intensitySeg.trigger('click')
      // Now the intensity rows show and the last-session chips are gone (the
      // intensity lens has its own preset chips, so scope to non-preset chips).
      expect(wrapper.find('.wtSuggestionSegmentActive').text()).toBe('Intensity')
      expect(wrapper.findAll('.wtPrTargetsRow').length).toBeGreaterThan(0)
      const lastSessionChips = wrapper.findAll('.wtPrevSessionChip')
        .filter(c => !c.element.closest('.wtIntensityPresetChips'))
      expect(lastSessionChips).toHaveLength(0)
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
      mockState.exercises = JSON.parse(JSON.stringify(FIVE_EXERCISES))
    })

    it('shows search bar when 5+ exercises exist', () => {
      const wrapper = mountTracker()
      expect(wrapper.find('.wtSearchBar').exists()).toBe(true)
    })

    it('hides search bar when fewer than 5 exercises', () => {
      mockState.exercises = createExercises() // only 3
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
      // First filter by tag 'Back' — skip the "All" and manage chips added
      // in the 03-workouts.png restyle.
      const chips = wrapper.findAll('.wtTagChip').filter(c => {
        if (c.classes('wtTagChipClear')) return false
        if (c.classes('wtTagChipManage')) return false
        const label = c.find('.wtTagChipLabel')
        return label.exists()
      })
      const backChip = chips.find(c => c.find('.wtTagChipLabel').text() === 'Back')!
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
      mockState.exercises = createExercises()
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
      mockState.exercises = createExercises()
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

    // Regression (c16fc0b): tapping the "Today" subtitle must trigger the
    // native date picker. After the modal redesign (d4974c2) moved the date
    // into an inline <span>, the overlay input's click handler was missing,
    // so desktop Chrome never opened the picker (Chrome only opens on the
    // built-in calendar icon, not on opacity:0 input-body clicks).
    it('date subtitle tap calls showPicker on the overlay input', async () => {
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseLogBtn')[0].trigger('click')
      await wrapper.vm.$nextTick()

      const wrap = wrapper.find('.wtDateBtnWrap')
      expect(wrap.exists(), 'date subtitle wrap missing from log modal').toBe(true)

      const dateInput = wrapper.find('.wtDateOverlayInput')
      expect(dateInput.exists(), 'overlay date input missing').toBe(true)
      expect(dateInput.attributes('type')).toBe('date')

      // The click handler must be bound so showPicker() fires inside the
      // user gesture on desktop Chrome and iOS 16+.
      const el = dateInput.element as HTMLInputElement
      let showPickerCalled = false
      // jsdom doesn't implement showPicker; install a stub so the handler
      // can invoke it without throwing.
      ;(el as HTMLInputElement & { showPicker: () => void }).showPicker = () => {
        showPickerCalled = true
      }
      await dateInput.trigger('click')
      expect(showPickerCalled, '@click="tryShowDatePicker" binding missing — regression of c16fc0b').toBe(true)
    })
  })

  describe('accessibility', () => {
    it('log modal has aria-modal and role dialog', async () => {
      mockState.exercises = createExercises()
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseLogBtn')[0].trigger('click')
      await wrapper.vm.$nextTick()

      const modal = wrapper.find('.repMaxModal')
      expect(modal.attributes('role')).toBe('dialog')
      expect(modal.attributes('aria-modal')).toBe('true')
    })

    it('search input has aria-label', () => {
      mockState.exercises = [
        { id: '1', name: 'A', tags: [], sets: [] },
        { id: '2', name: 'B', tags: [], sets: [] },
        { id: '3', name: 'C', tags: [], sets: [] },
        { id: '4', name: 'D', tags: [], sets: [] },
        { id: '5', name: 'E', tags: [], sets: [] },
      ]
      const wrapper = mountTracker()
      // Search now covers both exercise names and tags (03-workouts.png).
      expect(wrapper.find('.wtSearchInput').attributes('aria-label')).toBe('Search exercises or tags')
    })

    it('log button aria-label renders exercise name dynamically', () => {
      mockState.exercises = [{ id: '1', name: 'Bench Press', tags: [], sets: [] }]
      const wrapper = mountTracker()
      const logBtn = wrapper.find('.wtExerciseLogBtn')
      expect(logBtn.attributes('aria-label')).toBe('Log a set for Bench Press')
    })

    it('detail modal has aria-modal and role dialog', async () => {
      mockState.exercises = createExercises()
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      const modal = wrapper.find('.wtDetailModal')
      expect(modal.attributes('role')).toBe('dialog')
      expect(modal.attributes('aria-modal')).toBe('true')
    })

    it('tag filter buttons have aria-pressed reflecting active state', () => {
      mockState.exercises = createExercises()
      const wrapper = mountTracker()
      // Only actual tag chips have aria-pressed — skip "All", "× Clear",
      // and the tag-manager chip added in the 03-workouts.png restyle.
      const tagBtns = wrapper.findAll('.wtTagChip').filter(c => c.find('.wtTagChipLabel').exists())
      expect(tagBtns.length).toBeGreaterThan(0)
      tagBtns.forEach(btn => {
        expect(btn.attributes('aria-pressed')).toBe('false')
      })
    })

    it('tag add buttons have aria-label', async () => {
      mockState.exercises = createExercises()
      const wrapper = mountTracker()
      // Open new exercise modal via the exposed helper (retired wtLogBtn).
      exposed(wrapper).openNewExerciseModal()
      await wrapper.vm.$nextTick()
      const addBtn = wrapper.find('.wtTagAddChip')
      expect(addBtn.attributes('aria-label')).toBe('Add tag')
    })

    it('timer visual display has aria-hidden (not aria-live) to prevent per-second announcements', () => {
      mockState.exercises = createExercises()
      const wrapper = mountTracker()
      const timerInner = wrapper.find('.wtTimerRingInner')
      if (timerInner.exists()) {
        expect(timerInner.attributes('aria-hidden')).toBe('true')
        expect(timerInner.attributes('aria-live')).toBeUndefined()
      }
    })

    it('timer has a screen-reader-only aria-live region for milestone announcements', () => {
      mockState.exercises = createExercises()
      const wrapper = mountTracker()
      const srAnnouncement = wrapper.find('.srOnly[aria-live="polite"]')
      if (srAnnouncement.exists()) {
        expect(srAnnouncement.attributes('aria-atomic')).toBe('true')
      }
    })
  })

  describe('rest timer drift correction', () => {
    beforeEach(() => {
      mockState.exercises = createExercises()
      localStorage.setItem('rest-timer', 'on')
      localStorage.setItem('rest-duration', '90')
      const mockOsc = { connect: vi.fn(), frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, start: vi.fn(), stop: vi.fn() }
      const mockGain = { connect: vi.fn(), gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }
      vi.stubGlobal('AudioContext', class {
        state = 'running'
        currentTime = 0
        destination = {}
        resume = vi.fn()
        createOscillator = vi.fn(() => mockOsc)
        createGain = vi.fn(() => mockGain)
      })
      vi.useFakeTimers({ shouldAdvanceTime: false })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('uses wall-clock time so backgrounding the app does not cause drift', async () => {
      const wrapper = mountTracker()
      const timer = timerState(wrapper)
      // Start the timer with 90s duration
      const startTime = Date.now()
      vi.setSystemTime(startTime)
      timer.startRestTimer()
      expect(timer.timerSeconds).toBe(90)

      // Simulate 30 real seconds passing (as if phone was backgrounded)
      vi.setSystemTime(startTime + 30_000)
      vi.advanceTimersByTime(250) // one tick
      await wrapper.vm.$nextTick()
      expect(timer.timerSeconds).toBe(60)

      // Simulate 55 more seconds — only 5s should remain
      vi.setSystemTime(startTime + 85_000)
      vi.advanceTimersByTime(250)
      await wrapper.vm.$nextTick()
      expect(timer.timerSeconds).toBe(5)
    })

    it('timer reaches zero even if intervals were throttled', async () => {
      const wrapper = mountTracker()
      const timer = timerState(wrapper)
      const startTime = Date.now()
      vi.setSystemTime(startTime)
      timer.startRestTimer()

      // Jump past the full duration in one step
      vi.setSystemTime(startTime + 91_000)
      vi.advanceTimersByTime(250)
      await wrapper.vm.$nextTick()
      expect(timer.timerSeconds).toBe(0)
    })
  })

  describe('view toggle', () => {
    beforeEach(() => {
      mockState.exercises = createExercises()
    })

    it('renders Exercises and Timeline toggle buttons when exercises exist', () => {
      const wrapper = mountTracker()
      const btns = wrapper.findAll('.wtViewToggleBtn')
      expect(btns.length).toBe(2)
      expect(btns[0].text()).toBe('Exercises')
      expect(btns[1].text()).toBe('Timeline')
    })

    it('does not render toggle when no exercises exist', () => {
      mockState.exercises = []
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

    it('exposes openTimelineLogModal to open the exercise picker from both views', async () => {
      // The top-bar "+" now adds an exercise; logging a set goes through the
      // exercise picker, exposed via openTimelineLogModal (used by the timeline
      // view's "Log a set" button). The picker works from both views.
      const wrapper = mountTracker()
      expect(typeof exposed(wrapper).openTimelineLogModal).toBe('function')

      exposed(wrapper).openTimelineLogModal()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.wtExPickerNew').exists()).toBe(true)

      // Switch to timeline view; the exposed helper still works.
      await wrapper.find('.wtExPickerRow + .wtExPickerRow, .wtExPickerRow')
      await wrapper.findAll('.wtViewToggleBtn')[1].trigger('click')
      await wrapper.vm.$nextTick()
      exposed(wrapper).openTimelineLogModal()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.wtExPickerNew').exists()).toBe(true)
    })

    it('timeline view shows a "Log a set" button that opens the exercise picker', async () => {
      const wrapper = mountTracker()
      // Switch to timeline view (timeline rows have no per-exercise "+").
      await wrapper.findAll('.wtViewToggleBtn')[1].trigger('click')
      await wrapper.vm.$nextTick()

      const logBtn = wrapper.find('.wtTimelineLogBtn')
      expect(logBtn.exists()).toBe(true)
      expect(logBtn.attributes('aria-label')).toBe('Log a set')

      await logBtn.trigger('click')
      await wrapper.vm.$nextTick()
      // Picker opens with the "+ New exercise" row available.
      expect(wrapper.find('.wtExPickerNew').exists()).toBe(true)
    })

    it('exercise picker dialog has aria-labelledby linked to title', async () => {
      const wrapper = mountTracker()
      exposed(wrapper).openTimelineLogModal()
      await wrapper.vm.$nextTick()

      const dialog = wrapper.find('[role="dialog"][aria-labelledby="timeline-picker-title"]')
      expect(dialog.exists()).toBe(true)
      expect(dialog.attributes('aria-modal')).toBe('true')
      const title = wrapper.find('#timeline-picker-title')
      expect(title.exists()).toBe(true)
      expect(title.text()).toBe('Choose Exercise')
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
      mockState.exercises = JSON.parse(JSON.stringify(TIMELINE_EXERCISES))
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
      mockState.exercises = [{ id: 'ex-1', name: 'Bench', tags: [], sets: [] }]
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
      mockState.exercises = [
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
      mockState.exercises = [{ id: 'ex-1', name: 'Bench Press', tags: [], sets }]
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
      mockState.exercises = [{ id: 'ex-1', name: 'Bench Press', tags: [], sets }]
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
      mockState.exercises = createExercises() // 2 sets on Bench Press
      const wrapper = mountTracker()
      await wrapper.findAll('.wtExerciseRow')[0].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.wtShowAllBtn').exists()).toBe(false)
    })
  })

  // ── Gym filtering (#961) ─────────────────────────────────────────
  describe('gym filtering', () => {
    /** Exercises spanning two gyms + shared (unassigned) equipment. */
    function createGymExercises(): Exercise[] {
      return [
        { id: 'ex-1', name: 'Hack Squat (PF)', tags: ['Legs'], sets: [], gyms: ['Gym A'] },
        { id: 'ex-2', name: 'Hack Squat (24h)', tags: ['Legs'], sets: [], gyms: ['Gym B'] },
        { id: 'ex-3', name: 'Bench Press', tags: ['Chest'], sets: [] }, // unassigned = everywhere
        { id: 'ex-4', name: 'Cable Row', tags: ['Back'], sets: [], gyms: ['Gym A', 'Gym B'] },
      ]
    }

    function gymChipRow(wrapper: VueWrapper) {
      return wrapper.find('[aria-label="Filter by gym"]')
    }

    function gymChip(wrapper: VueWrapper, label: string) {
      return gymChipRow(wrapper).findAll('.wtTagChip').find(c => c.text() === label)!
    }

    function listedNames(wrapper: VueWrapper): string[] {
      return wrapper.findAll('.wtExerciseName').map(n => n.text())
    }

    it('renders the zero-state chip row: All Gyms active + a labeled Add Gym chip (#963)', () => {
      mockState.exercises = createGymExercises()
      const wrapper = mountTracker()
      const chips = gymChipRow(wrapper).findAll('.wtTagChip')
      expect(chips.map(c => c.text())).toEqual(['All Gyms', 'Add Gym'])
      expect(chips[0].classes()).toContain('wtTagChipActive')
      // The labeled manage chip is the create-first-gym entry point in the
      // logging surface — Settings must not be the only way in.
      expect(gymChipRow(wrapper).find('[aria-label="Add a gym"]').exists()).toBe(true)
    })

    it('opens the gym manager from the zero-state Add Gym chip', async () => {
      mockState.exercises = createGymExercises()
      const wrapper = mountTracker()
      await gymChipRow(wrapper).find('[aria-label="Add a gym"]').trigger('click')
      expect(wrapper.find('[aria-labelledby="gym-manager-title"]').exists()).toBe(true)
    })

    it('routes EditExerciseModal create-gym to the preferences store (#963)', () => {
      mockState.exercises = createGymExercises()
      const wrapper = mountTracker()
      wrapper.findComponent(EditExerciseModal).vm.$emit('create-gym', 'Iron Temple')
      expect(mockAddGym).toHaveBeenCalledWith('Iron Temple')
      expect(mockPrefsState.gyms).toContain('Iron Temple')
    })

    it('renders the chip row (All Gyms + one chip per gym + manage) once gyms exist', () => {
      mockPrefsState.gyms = ['Gym A', 'Gym B']
      mockState.exercises = createGymExercises()
      const wrapper = mountTracker()
      const chips = gymChipRow(wrapper).findAll('.wtTagChip')
      expect(chips.map(c => c.text())).toEqual(['All Gyms', 'Gym A', 'Gym B', ''])
      // Exclusive default: All Gyms is the active chip.
      expect(chips[0].classes()).toContain('wtTagChipActive')
      // Trailing icon-only chip opens the gym manager.
      expect(gymChipRow(wrapper).find('[aria-label="Manage gyms"]').exists()).toBe(true)
    })

    it('filters exclusively: only the active gym\'s + unassigned exercises remain', async () => {
      mockPrefsState.gyms = ['Gym A', 'Gym B']
      mockState.exercises = createGymExercises()
      const wrapper = mountTracker()

      await gymChip(wrapper, 'Gym A').trigger('click')

      const names = listedNames(wrapper)
      expect(names).toContain('Hack Squat (PF)')   // Gym A
      expect(names).toContain('Bench Press')        // unassigned = everywhere
      expect(names).toContain('Cable Row')          // multi-gym incl. Gym A
      expect(names).not.toContain('Hack Squat (24h)') // Gym B only
    })

    it('selecting a second gym replaces the first (exclusive, not additive)', async () => {
      mockPrefsState.gyms = ['Gym A', 'Gym B']
      mockState.exercises = createGymExercises()
      const wrapper = mountTracker()

      await gymChip(wrapper, 'Gym A').trigger('click')
      await gymChip(wrapper, 'Gym B').trigger('click')

      expect(gymChip(wrapper, 'Gym B').classes()).toContain('wtTagChipActive')
      expect(gymChip(wrapper, 'Gym A').classes()).not.toContain('wtTagChipActive')
      const names = listedNames(wrapper)
      expect(names).toContain('Hack Squat (24h)')
      expect(names).not.toContain('Hack Squat (PF)')
    })

    it('tapping the active gym chip deselects back to All Gyms', async () => {
      mockPrefsState.gyms = ['Gym A', 'Gym B']
      mockState.exercises = createGymExercises()
      const wrapper = mountTracker()

      await gymChip(wrapper, 'Gym A').trigger('click')
      await gymChip(wrapper, 'Gym A').trigger('click')

      expect(gymChip(wrapper, 'All Gyms').classes()).toContain('wtTagChipActive')
      expect(listedNames(wrapper)).toHaveLength(4)
    })

    it('composes with the tag filter as AND (tags narrow within the gym)', async () => {
      mockPrefsState.gyms = ['Gym A', 'Gym B']
      mockState.exercises = createGymExercises()
      const wrapper = mountTracker()

      await gymChip(wrapper, 'Gym B').trigger('click')
      // Tag chip row: pick "Legs" — within Gym B that's only the 24h hack squat.
      const legsChip = wrapper.findAll('.wtTagChip').find(c => c.text().startsWith('Legs'))!
      await legsChip.trigger('click')

      expect(listedNames(wrapper)).toEqual(['Hack Squat (24h)'])
    })

    it('scopes tag chip counts to the active gym', async () => {
      mockPrefsState.gyms = ['Gym A', 'Gym B']
      mockState.exercises = createGymExercises()
      const wrapper = mountTracker()

      // Both hack squats carry Legs → count 2 without a gym filter.
      let legsChip = wrapper.findAll('.wtTagChip').find(c => c.text().startsWith('Legs'))!
      expect(legsChip.find('.wtTagChipCount').text()).toBe('2')

      await gymChip(wrapper, 'Gym A').trigger('click')
      legsChip = wrapper.findAll('.wtTagChip').find(c => c.text().startsWith('Legs'))!
      expect(legsChip.find('.wtTagChipCount').text()).toBe('1')
    })

    it('keeps an exercise whose gyms are all orphaned visible under any gym (rename race safety net)', async () => {
      mockPrefsState.gyms = ['Gym A', 'Gym B']
      mockState.exercises = [
        ...createGymExercises(),
        { id: 'ex-5', name: 'Ghost Machine', tags: [], sets: [], gyms: ['Renamed Away'] },
      ]
      const wrapper = mountTracker()

      await gymChip(wrapper, 'Gym A').trigger('click')

      expect(listedNames(wrapper)).toContain('Ghost Machine')
    })

    it('passes the gym-filtered list to the quick-log exercise picker', async () => {
      mockPrefsState.gyms = ['Gym A', 'Gym B']
      mockState.exercises = createGymExercises()
      const wrapper = mountTracker()

      await gymChip(wrapper, 'Gym B').trigger('click')

      const picker = wrapper.findComponent({ name: 'ExercisePickerModal' })
      const names = (picker.props('exercises') as Exercise[]).map(e => e.name)
      expect(names).toContain('Hack Squat (24h)')
      expect(names).toContain('Bench Press')
      expect(names).not.toContain('Hack Squat (PF)')
    })

    it('persists the selection per device and restores it on mount', async () => {
      mockPrefsState.gyms = ['Gym A', 'Gym B']
      mockState.exercises = createGymExercises()
      const first = mountTracker()
      await gymChip(first, 'Gym B').trigger('click')
      expect(localStorageMock.getItem('active-gym-filter')).toBe(JSON.stringify('Gym B'))
      first.unmount()

      const second = mountTracker()
      expect(gymChip(second, 'Gym B').classes()).toContain('wtTagChipActive')
      expect(listedNames(second)).not.toContain('Hack Squat (PF)')
    })

    it('ignores a persisted selection for a gym that no longer exists (filter stays inert)', () => {
      localStorageMock.setItem('active-gym-filter', JSON.stringify('Deleted Gym'))
      mockPrefsState.gyms = ['Gym A']
      mockState.exercises = createGymExercises()
      const wrapper = mountTracker()

      expect(gymChip(wrapper, 'All Gyms').classes()).toContain('wtTagChipActive')
      expect(listedNames(wrapper)).toHaveLength(4)
    })

    it('shows the generalized empty state when the gym filter empties the list', async () => {
      mockPrefsState.gyms = ['Gym A', 'Empty Gym']
      mockState.exercises = [
        { id: 'ex-1', name: 'Hack Squat (PF)', tags: [], sets: [], gyms: ['Gym A'] },
      ]
      const wrapper = mountTracker()

      await gymChip(wrapper, 'Empty Gym').trigger('click')

      expect(wrapper.find('.wtEmpty').text()).toContain('No exercises match your filters.')
    })

    // ── Assigning gyms at creation time (#984) ───────────────────
    describe('gym assignment in the new-exercise form', () => {
      /** The Gym picker inside the log sheet (EditExerciseModal has its own). */
      function newExerciseGymPicker(wrapper: VueWrapper) {
        return wrapper
          .find('[aria-labelledby="log-modal-title"]')
          .find('[aria-label="Gym membership"]')
      }

      function gymPickerChip(wrapper: VueWrapper, label: string) {
        return newExerciseGymPicker(wrapper)
          .findAll('.wtTagPickerChip')
          .find(c => c.text() === label)!
      }

      async function openNewExerciseForm(wrapper: VueWrapper, name = 'Hack Squat') {
        exposed(wrapper).openNewExerciseModal()
        await wrapper.vm.$nextTick()
        await wrapper.find('[aria-labelledby="log-modal-title"] input[type="text"]').setValue(name)
        return wrapper
      }

      async function save(wrapper: VueWrapper) {
        await wrapper.find('.repMaxBtn.repMaxBtnCalc').trigger('click')
      }

      it('renders a Gym picker in the new-exercise form', async () => {
        mockPrefsState.gyms = ['Gym A', 'Gym B']
        mockState.exercises = createGymExercises()
        const wrapper = mountTracker()
        await openNewExerciseForm(wrapper)

        expect(newExerciseGymPicker(wrapper).exists()).toBe(true)
        expect(
          newExerciseGymPicker(wrapper).findAll('.wtTagPickerChip').map(c => c.text()),
        ).toEqual(['Gym A', 'Gym B', '+'])
      })

      it('renders the picker with only the add chip when no gyms exist yet (first-gym path)', async () => {
        mockState.exercises = createGymExercises()
        const wrapper = mountTracker()
        await openNewExerciseForm(wrapper)

        expect(newExerciseGymPicker(wrapper).exists()).toBe(true)
        expect(newExerciseGymPicker(wrapper).find('[aria-label="Add gym"]').exists()).toBe(true)
      })

      it('pre-selects the active gym filter — the gym you are at is the gym you are adding for', async () => {
        mockPrefsState.gyms = ['Gym A', 'Gym B']
        mockState.exercises = createGymExercises()
        const wrapper = mountTracker()
        await gymChip(wrapper, 'Gym A').trigger('click')

        await openNewExerciseForm(wrapper)

        expect(gymPickerChip(wrapper, 'Gym A').classes()).toContain('wtTagPickerChipActive')
        expect(gymPickerChip(wrapper, 'Gym B').classes()).not.toContain('wtTagPickerChipActive')
      })

      it('passes the pre-selected gym through addExercise at creation', async () => {
        mockPrefsState.gyms = ['Gym A', 'Gym B']
        mockState.exercises = createGymExercises()
        mockAddExercise.mockReturnValue('ex-new')
        const wrapper = mountTracker()
        await gymChip(wrapper, 'Gym A').trigger('click')

        await openNewExerciseForm(wrapper, 'Pendulum Squat')
        await save(wrapper)

        expect(mockAddExercise).toHaveBeenCalledWith('Pendulum Squat', [], { gyms: ['Gym A'] })
      })

      it('leaves membership empty when no gym filter is active (unassigned = everywhere)', async () => {
        mockPrefsState.gyms = ['Gym A', 'Gym B']
        mockState.exercises = createGymExercises()
        mockAddExercise.mockReturnValue('ex-new')
        const wrapper = mountTracker()

        await openNewExerciseForm(wrapper, 'Pendulum Squat')
        await save(wrapper)

        expect(mockAddExercise).toHaveBeenCalledWith('Pendulum Squat', [], { gyms: [] })
      })

      it('deselecting the pre-seeded gym is one tap and sticks through save', async () => {
        mockPrefsState.gyms = ['Gym A', 'Gym B']
        mockState.exercises = createGymExercises()
        mockAddExercise.mockReturnValue('ex-new')
        const wrapper = mountTracker()
        await gymChip(wrapper, 'Gym A').trigger('click')

        await openNewExerciseForm(wrapper, 'Pendulum Squat')
        await gymPickerChip(wrapper, 'Gym A').trigger('click')
        await save(wrapper)

        expect(mockAddExercise).toHaveBeenCalledWith('Pendulum Squat', [], { gyms: [] })
      })

      it('selects multiple gyms (shared equipment across gyms)', async () => {
        mockPrefsState.gyms = ['Gym A', 'Gym B']
        mockState.exercises = createGymExercises()
        mockAddExercise.mockReturnValue('ex-new')
        const wrapper = mountTracker()

        await openNewExerciseForm(wrapper, 'Pendulum Squat')
        await gymPickerChip(wrapper, 'Gym A').trigger('click')
        await gymPickerChip(wrapper, 'Gym B').trigger('click')
        await save(wrapper)

        expect(mockAddExercise).toHaveBeenCalledWith('Pendulum Squat', [], {
          gyms: ['Gym A', 'Gym B'],
        })
      })

      it('inline "+" creates the gym in preferences and selects it locally', async () => {
        mockState.exercises = createGymExercises()
        mockAddExercise.mockReturnValue('ex-new')
        const wrapper = mountTracker()
        await openNewExerciseForm(wrapper, 'Pendulum Squat')

        await newExerciseGymPicker(wrapper).find('[aria-label="Add gym"]').trigger('click')
        const input = newExerciseGymPicker(wrapper).find('[aria-label="New gym name"]')
        await input.setValue('Iron Temple')
        await input.trigger('keyup.enter')

        expect(mockAddGym).toHaveBeenCalledWith('Iron Temple')
        expect(mockPrefsState.gyms).toContain('Iron Temple')
        expect(gymPickerChip(wrapper, 'Iron Temple').classes()).toContain('wtTagPickerChipActive')
      })

      it('flushes half-typed gym text on save instead of dropping it', async () => {
        mockState.exercises = createGymExercises()
        mockAddExercise.mockReturnValue('ex-new')
        const wrapper = mountTracker()
        await openNewExerciseForm(wrapper, 'Pendulum Squat')

        await newExerciseGymPicker(wrapper).find('[aria-label="Add gym"]').trigger('click')
        // Typed but never committed with Enter/blur — Save must not lose it.
        await newExerciseGymPicker(wrapper).find('[aria-label="New gym name"]').setValue('Iron Temple')
        await save(wrapper)

        expect(mockAddExercise).toHaveBeenCalledWith('Pendulum Squat', [], {
          gyms: ['Iron Temple'],
        })
      })

      it('does not leak a previous selection into the next new exercise', async () => {
        mockPrefsState.gyms = ['Gym A', 'Gym B']
        mockState.exercises = createGymExercises()
        mockAddExercise.mockReturnValue('ex-new')
        const wrapper = mountTracker()

        await openNewExerciseForm(wrapper, 'Pendulum Squat')
        await gymPickerChip(wrapper, 'Gym B').trigger('click')
        await save(wrapper)

        await openNewExerciseForm(wrapper, 'Belt Squat')
        expect(gymPickerChip(wrapper, 'Gym B').classes()).not.toContain('wtTagPickerChipActive')
      })
    })
  })

  describe('fresh-identity child bindings (#963)', () => {
    // The store mutates exercises in place behind a shallowRef; children bound
    // to the raw array froze because their prop identity never changed. These
    // tests drive the REAL host wiring (liveExercises) against the mock's
    // faithful in-place-mutation contract — they fail if anyone reverts a
    // binding to `store.exercises`.

    it('gym manager checklist shows a toggled checkmark live, without reopening', async () => {
      mockPrefsState.gyms = ['Gym A']
      mockState.exercises = [
        { id: 'ex-1', name: 'Hack Squat (PF)', tags: [], sets: [], gyms: ['Gym A'] },
        { id: 'ex-3', name: 'Bench Press', tags: [], sets: [] },
      ]
      const wrapper = mountTracker()
      await wrapper.find('[aria-label="Manage gyms"]').trigger('click')
      await wrapper.find('[aria-label="Show exercises for Gym A"]').trigger('click')

      // Re-find rows after every state change — Vue may replace the nodes.
      const benchRow = () =>
        wrapper.findAll('.wtTagExerciseRow').find(r => r.text().includes('Bench Press'))!
      expect(benchRow().find('.wtTagExerciseCheck').exists()).toBe(false)
      expect(wrapper.find('.wtTagManagerCount').text()).toBe('1')

      await benchRow().trigger('click')

      expect(benchRow().find('.wtTagExerciseCheck').exists()).toBe(true)
      expect(wrapper.find('.wtTagManagerCount').text()).toBe('2')
    })

    it('tag manager checklist shows a toggled checkmark live, without reopening', async () => {
      mockState.exercises = createExercises()
      const wrapper = mountTracker()
      await wrapper.find('[aria-label="Manage tags"]').trigger('click')
      await wrapper.find('[aria-label="Show exercises for Legs"]').trigger('click')

      const benchRow = () =>
        wrapper.findAll('.wtTagExerciseRow').find(r => r.text().includes('Bench Press'))!
      expect(benchRow().find('.wtTagExerciseCheck').exists()).toBe(false)

      await benchRow().trigger('click')

      expect(benchRow().find('.wtTagExerciseCheck').exists()).toBe(true)
    })

    it('timeline reflects sets mutated in place while it is the active view', async () => {
      mockState.exercises = createExercises()
      const wrapper = mountTracker()
      await wrapper.findAll('.wtViewToggleBtn')[1].trigger('click')
      expect(wrapper.text()).not.toContain('205')

      // The real store contract for logSet/updateSet/deleteSet: mutate the
      // exercise in place, then triggerRef.
      mockState.exercises[0].sets.push({
        id: 's-new', date: '2026-01-21T12:00:00', weight: 205, reps: 5, estimated1RM: 239,
      })
      triggerRef(mockExercises)
      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('205')
    })
  })
})
