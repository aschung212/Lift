/**
 * LIFT-1189 — ExerciseDetailModal: the exercise history/graph/PR surface.
 *
 * This modal is one of the core history-viewing flows but was only touched
 * incidentally by E2E. These tests pin the component's own contract in
 * isolation: the sets/PRs tab switch and their visibility gate, set-row and
 * PR-card rendering, the trophy on the PR set, the warmup-hide toggle, the
 * "show all" gate at SET_LIMIT, the empty state, and every emit the parent
 * relies on. The heavy SVG ExerciseGraph child is stubbed; the workout /
 * preferences stores and useWeightUnit are mocked at their boundary so the
 * test drives pure component STATE, mirroring the CoachSheet pattern.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import ExerciseDetailModal from '../ExerciseDetailModal.vue'
import type { Exercise, WorkoutSet } from '../../stores/workout'

enableAutoUnmount(afterEach)

// ── Store boundary mocks ─────────────────────────────────────────
// A single mutable array backs the mocked workout store; each test seeds it
// via setExercises() before mounting. getExercisePR returns the max e1RM of
// the exercise's sets — the same all-time-max semantics the real store uses
// when no PR baseline is set — so the trophy-matching logic is exercised
// faithfully rather than stubbed to a constant.
let mockExercises: Exercise[] = []
function setExercises(list: Exercise[]) {
  mockExercises = list
}

vi.mock('../../stores/workout', () => ({
  useWorkoutStore: () => ({
    get exercises() {
      return mockExercises
    },
    getExercisePR(id: string): number {
      const ex = mockExercises.find((e) => e.id === id)
      if (!ex || ex.sets.length === 0) return 0
      return Math.max(...ex.sets.map((s) => s.estimated1RM))
    },
  }),
}))

vi.mock('../../stores/preferences', () => ({
  usePreferencesStore: () => ({
    filters: { warmupThreshold: 0.75 },
    prBaselineDate: null,
  }),
}))

vi.mock('../../composables/useWeightUnit', () => ({
  useWeightUnit: () => ({
    weightUnit: ref('lbs'),
    displayWeight: (w: number) => Math.round(w),
    toLbs: (w: number) => w,
  }),
}))

// ExerciseGraph is a heavy computed-SVG child unrelated to this surface.
vi.mock('../../components/ExerciseGraph.vue', () => ({
  default: { name: 'ExerciseGraph', template: '<div class="mock-graph" />' },
}))

// ── Fixtures ─────────────────────────────────────────────────────
function makeSet(over: Partial<WorkoutSet> & { weight: number; reps: number; estimated1RM: number }): WorkoutSet {
  return {
    id: over.id ?? `s-${Math.random().toString(36).slice(2)}`,
    date: over.date ?? '2026-01-01T12:00:00',
    weight: over.weight,
    reps: over.reps,
    estimated1RM: over.estimated1RM,
  }
}

// Three ascending-max sets on distinct days → prHistory has 3 entries (>1),
// so the PRs tab is shown; the top set (204 on Feb 1) is the current PR.
function prRichExercise(over: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex-1',
    name: 'Bench Press',
    tags: ['Chest'],
    sets: [
      makeSet({ id: 's-1', date: '2026-01-01T12:00:00', weight: 135, reps: 5, estimated1RM: 158 }),
      makeSet({ id: 's-2', date: '2026-01-15T12:00:00', weight: 155, reps: 5, estimated1RM: 181 }),
      makeSet({ id: 's-3', date: '2026-02-01T12:00:00', weight: 175, reps: 5, estimated1RM: 204 }),
    ],
    ...over,
  }
}

function mountModal(exerciseId: string | null = 'ex-1'): VueWrapper {
  return mount(ExerciseDetailModal, {
    props: { exerciseId },
    global: { stubs: { Teleport: true } },
  })
}

beforeEach(() => {
  mockExercises = []
})

describe('ExerciseDetailModal', () => {
  describe('visibility', () => {
    it('renders nothing when no exerciseId is set', () => {
      setExercises([prRichExercise()])
      const wrapper = mountModal(null)
      expect(wrapper.find('.repMaxOverlay').exists()).toBe(false)
    })

    it('renders nothing when the exerciseId matches no known exercise', () => {
      setExercises([prRichExercise()])
      const wrapper = mountModal('missing')
      expect(wrapper.find('.repMaxOverlay').exists()).toBe(false)
    })

    it('renders a labelled dialog titled with the exercise name', () => {
      setExercises([prRichExercise()])
      const wrapper = mountModal()
      const dialog = wrapper.find('.wtDetailModal')
      expect(dialog.attributes('role')).toBe('dialog')
      expect(dialog.attributes('aria-modal')).toBe('true')
      expect(dialog.attributes('aria-labelledby')).toBe('detail-modal-title')
      expect(wrapper.find('#detail-modal-title').text()).toBe('Bench Press')
    })

    it('surfaces the durable per-exercise note when present', () => {
      setExercises([prRichExercise({ notes: 'Pause at the chest' })])
      const wrapper = mountModal()
      expect(wrapper.find('.wtDetailNote').text()).toBe('Pause at the chest')
    })

    it('omits the note paragraph when the exercise has no note', () => {
      setExercises([prRichExercise()])
      const wrapper = mountModal()
      expect(wrapper.find('.wtDetailNote').exists()).toBe(false)
    })
  })

  describe('All Sets tab', () => {
    it('shows the set count and renders each set row with weight × reps and e1RM', () => {
      setExercises([prRichExercise()])
      const wrapper = mountModal()
      expect(wrapper.find('.wtDetailTabCount').text()).toBe('3')
      const rows = wrapper.findAll('.wtSetRow')
      expect(rows).toHaveLength(3)
      // Sorted most-recent-first: the top row is the Feb 1 set.
      expect(rows[0].find('.wtSetDetail').text()).toBe('175 lbs × 5')
      expect(rows[0].find('.wtSet1RM').text()).toContain('~204 lbs')
    })

    it('marks the current-PR set with a trophy and none of the others', () => {
      setExercises([prRichExercise()])
      const wrapper = mountModal()
      const trophies = wrapper.findAll('.wtSetPR')
      expect(trophies).toHaveLength(1)
      // The trophy lives in the top (Feb 1, e1RM 204) row.
      const rows = wrapper.findAll('.wtSetRow')
      expect(rows[0].find('.wtSetPR').exists()).toBe(true)
    })

    it('shows the empty state when the exercise has no sets', () => {
      setExercises([prRichExercise({ sets: [] })])
      const wrapper = mountModal()
      expect(wrapper.find('.wtSetEmpty').text()).toBe('No sets logged yet.')
    })

    it('groups sets under a per-day date header', () => {
      setExercises([prRichExercise()])
      const wrapper = mountModal()
      // Three sets on three distinct days → three date headers.
      expect(wrapper.findAll('.wtSetDateHeader')).toHaveLength(3)
    })
  })

  describe('warmup toggle', () => {
    it('renders the warmup toggle only when more than one set exists', () => {
      setExercises([
        prRichExercise({ id: 'solo', sets: [makeSet({ weight: 135, reps: 5, estimated1RM: 158 })] }),
      ])
      const wrapper = mountModal('solo')
      expect(wrapper.find('.wtWarmupToggle').exists()).toBe(false)
    })

    it('toggles the hide-warmups state, flipping its label and aria-checked', async () => {
      setExercises([prRichExercise()])
      const wrapper = mountModal()
      const toggle = wrapper.find('.wtWarmupToggle')
      expect(toggle.attributes('aria-checked')).toBe('false')
      expect(toggle.text()).toBe('Hide warmups')

      await toggle.trigger('click')
      expect(wrapper.find('.wtWarmupToggle').attributes('aria-checked')).toBe('true')
      expect(wrapper.find('.wtWarmupToggle').text()).toBe('Warmups hidden')
    })
  })

  describe('show-all gate', () => {
    it('shows the "show all" button only past SET_LIMIT (10) sets and expands on tap', async () => {
      const many = Array.from({ length: 12 }, (_, i) =>
        makeSet({
          id: `m-${i}`,
          // Distinct days so each set is its own group; day index padded.
          date: `2026-03-${String(i + 1).padStart(2, '0')}T12:00:00`,
          weight: 100 + i,
          reps: 5,
          estimated1RM: 120 + i,
        }),
      )
      setExercises([prRichExercise({ sets: many })])
      const wrapper = mountModal()

      // Capped at SET_LIMIT until expanded.
      expect(wrapper.findAll('.wtSetRow')).toHaveLength(10)
      const btn = wrapper.find('.wtShowAllBtn')
      expect(btn.text()).toBe('Show all 12 sets')

      await btn.trigger('click')
      expect(wrapper.findAll('.wtSetRow')).toHaveLength(12)
      expect(wrapper.find('.wtShowAllBtn').text()).toBe('Show less')
    })

    it('does not render the show-all button at or below SET_LIMIT', () => {
      setExercises([prRichExercise()])
      const wrapper = mountModal()
      expect(wrapper.find('.wtShowAllBtn').exists()).toBe(false)
    })
  })

  describe('PRs tab', () => {
    it('hides the PRs tab when there is one or zero distinct PR days', () => {
      setExercises([
        prRichExercise({
          id: 'flat',
          sets: [makeSet({ weight: 135, reps: 5, estimated1RM: 158 })],
        }),
      ])
      const wrapper = mountModal('flat')
      const tabs = wrapper.findAll('.wtDetailTab')
      expect(tabs).toHaveLength(1)
      expect(tabs[0].text()).toContain('All Sets')
    })

    it('switches to the PRs tab and renders a card per PR with the current badge', async () => {
      setExercises([prRichExercise()])
      const wrapper = mountModal()
      const prTab = wrapper.findAll('.wtDetailTab').find((t) => t.text().includes('PRs'))!
      expect(prTab).toBeTruthy()

      await prTab.trigger('click')
      const cards = wrapper.findAll('.wtPRCard')
      expect(cards).toHaveLength(3)
      // Newest-first: the current PR (204) is on top and carries the badge.
      expect(cards[0].classes()).toContain('wtPRCardCurrent')
      expect(cards[0].find('.wtPRCardBadge').text()).toBe('Current')
      expect(cards[0].find('.wtPRCardValue').text()).toContain('175')
      // Only the current card gets the Current badge.
      expect(wrapper.findAll('.wtPRCardBadge')).toHaveLength(1)
    })

    it('resets to the All Sets tab when the exercise prop changes', async () => {
      setExercises([prRichExercise(), prRichExercise({ id: 'ex-2', name: 'Squat' })])
      const wrapper = mountModal()
      const prTab = wrapper.findAll('.wtDetailTab').find((t) => t.text().includes('PRs'))!
      await prTab.trigger('click')
      expect(wrapper.findAll('.wtPRCard').length).toBeGreaterThan(0)

      await wrapper.setProps({ exerciseId: 'ex-2' })
      await nextTick()
      // Back on All Sets: PR cards are gone, set rows are shown.
      expect(wrapper.findAll('.wtPRCard')).toHaveLength(0)
      expect(wrapper.findAll('.wtSetRow').length).toBeGreaterThan(0)
    })
  })

  describe('emits', () => {
    it('emits close from the Back button', async () => {
      setExercises([prRichExercise()])
      const wrapper = mountModal()
      await wrapper.find('.wtDetailBack').trigger('click')
      expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('emits open-edit-exercise with the exercise from the edit button', async () => {
      const ex = prRichExercise()
      setExercises([ex])
      const wrapper = mountModal()
      await wrapper.find('.wtDetailEditBtn').trigger('click')
      expect(wrapper.emitted('open-edit-exercise')![0]).toEqual([ex])
    })

    it('emits open-log-set with the exercise id from the footer button', async () => {
      setExercises([prRichExercise()])
      const wrapper = mountModal()
      await wrapper.find('.wtDetailFooterBtn').trigger('click')
      expect(wrapper.emitted('open-log-set')![0]).toEqual(['ex-1'])
    })

    it('reveals per-set actions on tap and emits edit-set / delete-set', async () => {
      const ex = prRichExercise()
      setExercises([ex])
      const wrapper = mountModal()

      const topRow = wrapper.findAll('.wtSetRow')[0]
      expect(topRow.find('.wtSetActions').exists()).toBe(false)
      await topRow.trigger('click')
      expect(wrapper.findAll('.wtSetRow')[0].find('.wtSetActions').exists()).toBe(true)

      await wrapper.find('.wtSetActions button[aria-label="Edit set"]').trigger('click')
      expect(wrapper.emitted('edit-set')![0][0]).toEqual(ex)
      expect((wrapper.emitted('edit-set')![0][1] as WorkoutSet).id).toBe('s-3')

      await wrapper.find('.wtSetActions button[aria-label="Delete set"]').trigger('click')
      expect(wrapper.emitted('delete-set')![0][0]).toBe('ex-1')
      expect((wrapper.emitted('delete-set')![0][1] as WorkoutSet).id).toBe('s-3')
    })
  })
})
