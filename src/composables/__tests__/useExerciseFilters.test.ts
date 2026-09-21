/**
 * Unit coverage for the exercise-list filter stack extracted in LIFT-915.
 *
 * What these tests are FOR: the stack has three branch points — the quick-log
 * picker leaves after the gym stage, the session-plan card leaves after the tag
 * stage but before the recency sort, and the main list takes the whole pipeline.
 * Those divergences are the part a DOM-level test can only observe obliquely
 * (the plan card's "no recency sort" property, for instance, is only visible
 * once a set is logged mid-session), so they are asserted directly here.
 *
 * Set dates use the `endOfDayISO` convention (`…T23:59:59Z`, #746) whose date
 * PREFIX is the local day the set is filed under, so `setDayKey` resolves them
 * identically in every timezone and the ordering assertions cannot become
 * clock-dependent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { useExerciseFilters, type UseExerciseFiltersReturn } from '../useExerciseFilters'
// Round-trip the persisted selection through the real reader/writer rather than
// a hand-encoded localStorage value — the key is JSON-encoded and sanitized, and
// a test that wrote a bare string would assert against a format nothing produces.
import { loadActiveGymFilter, saveActiveGymFilter } from '../../lib/gyms'
import type { Exercise, WorkoutSet } from '../../stores/workout'

function makeSet(dayKey: string): WorkoutSet {
  return {
    id: `set-${dayKey}-${Math.random().toString(36).slice(2)}`,
    weight: 135,
    reps: 5,
    date: `${dayKey}T23:59:59.000Z`,
    estimated1RM: 157.5,
  } as WorkoutSet
}

function makeExercise(
  name: string,
  overrides: Partial<Exercise> = {},
): Exercise {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    tags: [],
    sets: [],
    ...overrides,
  }
}

/** Names in list order — the assertion shape for every ordering test below. */
function names(list: readonly Exercise[]): string[] {
  return list.map(e => e.name)
}

describe('useExerciseFilters', () => {
  let scope: EffectScope
  let exercises: ReturnType<typeof ref<Exercise[]>>
  let tags: ReturnType<typeof ref<string[]>>
  let gyms: ReturnType<typeof ref<string[]>>

  function mount(): UseExerciseFiltersReturn {
    scope = effectScope()
    const result = scope.run(() =>
      useExerciseFilters({
        activeExercises: () => exercises.value ?? [],
        allTags: () => tags.value ?? [],
        allGyms: () => gyms.value ?? [],
      }),
    )
    return result as UseExerciseFiltersReturn
  }

  beforeEach(() => {
    localStorage.clear()
    exercises = ref<Exercise[]>([])
    tags = ref<string[]>([])
    gyms = ref<string[]>([])
  })

  afterEach(() => {
    scope?.stop()
  })

  describe('stage order: gym → search → tags → recency', () => {
    beforeEach(() => {
      gyms.value = ['Gym A', 'Gym B']
      tags.value = ['Push', 'Pull']
      exercises.value = [
        makeExercise('Bench Press', { tags: ['Push'], gyms: ['Gym A'], sets: [makeSet('2026-09-01')] }),
        makeExercise('Overhead Press', { tags: ['Push'], gyms: ['Gym B'], sets: [makeSet('2026-09-10')] }),
        // No gym membership — unassigned shows under EVERY gym filter (#961).
        makeExercise('Barbell Row', { tags: ['Pull'], sets: [makeSet('2026-09-05')] }),
      ]
    })

    it('applies the gym filter before tags, so a tag narrows within the gym', () => {
      const f = mount()
      f.activeGymFilter.value = 'Gym A'
      f.activeTagFilters.value = ['Push']
      // Overhead Press is Push, but lives at Gym B — the gym stage removed it first.
      expect(names(f.filteredExercises.value)).toEqual(['Bench Press'])
    })

    it('keeps an unassigned exercise visible under every gym filter', () => {
      const f = mount()
      f.activeGymFilter.value = 'Gym B'
      expect(names(f.filteredExercises.value).sort()).toEqual(['Barbell Row', 'Overhead Press'])
    })

    it('ignores a gym membership naming a gym that is not in the list (orphan rule)', () => {
      const f = mount()
      exercises.value = [makeExercise('Zercher Squat', { gyms: ['Deleted Gym'] })]
      f.activeGymFilter.value = 'Gym A'
      // A fully-orphaned exercise degrades to visible-everywhere rather than hiding.
      expect(names(f.filteredExercises.value)).toEqual(['Zercher Squat'])
    })

    it('orders by recency AFTER filtering, so a filtered subset stays recency-ordered', () => {
      const f = mount()
      f.activeTagFilters.value = ['Push']
      expect(names(f.filteredExercises.value)).toEqual(['Overhead Press', 'Bench Press'])
    })

    it('sinks never-logged exercises and keeps their incoming order as a stable tiebreak', () => {
      const f = mount()
      exercises.value = [
        makeExercise('Never A'),
        makeExercise('Logged', { sets: [makeSet('2026-09-02')] }),
        makeExercise('Never B'),
      ]
      expect(names(f.filteredExercises.value)).toEqual(['Logged', 'Never A', 'Never B'])
    })

    it('searches names AND tags', () => {
      const f = mount()
      f.searchQuery.value = 'pull'
      expect(names(f.filteredExercises.value)).toEqual(['Barbell Row'])
    })
  })

  describe('branch points', () => {
    beforeEach(() => {
      gyms.value = ['Gym A', 'Gym B']
      tags.value = ['Push', 'Pull']
      exercises.value = [
        makeExercise('Bench Press', { tags: ['Push'], gyms: ['Gym A'], sets: [makeSet('2026-09-01')] }),
        makeExercise('Barbell Row', { tags: ['Pull'], gyms: ['Gym A'], sets: [makeSet('2026-09-10')] }),
        makeExercise('Leg Press', { tags: [], gyms: ['Gym B'], sets: [makeSet('2026-09-20')] }),
      ]
    })

    it('exercisesByRecency honours the gym but ignores search and tags (quick-log picker)', () => {
      const f = mount()
      f.activeGymFilter.value = 'Gym A'
      f.searchQuery.value = 'bench'
      f.activeTagFilters.value = ['Push']
      // The picker answers "what am I logging right now?", so it keeps the gym
      // scope and drops the narrowing the list view applied.
      expect(names(f.exercisesByRecency.value)).toEqual(['Barbell Row', 'Bench Press'])
    })

    it('planScopeExercises honours gym + tags but ignores the search query (#1256)', () => {
      const f = mount()
      f.activeGymFilter.value = 'Gym A'
      f.activeTagFilters.value = ['Pull']
      // Set the query directly: toggleTagFilter deliberately clears it.
      f.searchQuery.value = 'bench'
      expect(names(f.planScopeExercises.value)).toEqual(['Barbell Row'])
    })

    it('planScopeExercises keeps store order so plan rows do not reshuffle as sets land', () => {
      const f = mount()
      // Store order is Bench (oldest) → Row → Leg Press (newest); the recency
      // sort would invert it. The plan card must not move rows mid-workout.
      expect(names(f.planScopeExercises.value)).toEqual(['Bench Press', 'Barbell Row', 'Leg Press'])
      expect(names(f.filteredExercises.value)).toEqual(['Leg Press', 'Barbell Row', 'Bench Press'])
    })
  })

  describe('tag chips', () => {
    beforeEach(() => {
      gyms.value = ['Gym A', 'Gym B']
      tags.value = ['Push', 'Pull', 'Legs']
      exercises.value = [
        makeExercise('Bench Press', { tags: ['Push'], gyms: ['Gym A'] }),
        makeExercise('Barbell Row', { tags: ['Pull'], gyms: ['Gym B'] }),
      ]
    })

    it('counts tags within the active gym only, matching what tapping the chip shows', () => {
      const f = mount()
      expect(f.tagCounts.value).toEqual({ Push: 1, Pull: 1 })
      f.activeGymFilter.value = 'Gym A'
      expect(f.tagCounts.value).toEqual({ Push: 1 })
    })

    it('drops a tag carried only by archived exercises', () => {
      const f = mount()
      // 'Legs' is in allTags (the store counts archived rows) but no ACTIVE
      // exercise carries it, so its chip would filter to an empty list.
      expect(f.filteredTags.value).toEqual(['Push', 'Pull'])
    })

    it('narrows chips to the search query but keeps an already-active tag visible', () => {
      const f = mount()
      f.activeTagFilters.value = ['Pull']
      f.searchQuery.value = 'pus'
      expect(f.filteredTags.value).toEqual(['Push', 'Pull'])
    })

    it('toggleTagFilter clears the search, and toggling again removes the tag', () => {
      const f = mount()
      f.searchQuery.value = 'bench'
      f.toggleTagFilter('Push')
      expect(f.searchQuery.value).toBe('')
      expect(f.activeTagFilters.value).toEqual(['Push'])
      f.toggleTagFilter('Push')
      expect(f.activeTagFilters.value).toEqual([])
    })

    it('clearSearchAndTags resets both', () => {
      const f = mount()
      f.searchQuery.value = 'bench'
      f.activeTagFilters.value = ['Push']
      f.clearSearchAndTags()
      expect(f.searchQuery.value).toBe('')
      expect(f.activeTagFilters.value).toEqual([])
    })

    it('prunes an active tag filter once the tag leaves the store', async () => {
      const f = mount()
      f.activeTagFilters.value = ['Push', 'Pull']
      tags.value = ['Pull']
      await nextTick()
      expect(f.activeTagFilters.value).toEqual(['Pull'])
    })
  })

  describe('gym selection persistence', () => {
    it('restores the persisted selection and writes every change back', async () => {
      saveActiveGymFilter('Gym B')
      gyms.value = ['Gym A', 'Gym B']
      const f = mount()
      expect(f.activeGymFilter.value).toBe('Gym B')
      f.toggleGymFilter('Gym A')
      await nextTick()
      expect(loadActiveGymFilter()).toBe('Gym A')
    })

    it('toggleGymFilter is an exclusive select — re-tapping deselects to All Gyms', async () => {
      gyms.value = ['Gym A']
      const f = mount()
      f.toggleGymFilter('Gym A')
      expect(f.activeGymFilter.value).toBe('Gym A')
      f.toggleGymFilter('Gym A')
      await nextTick()
      expect(f.activeGymFilter.value).toBeNull()
      expect(loadActiveGymFilter()).toBeNull()
    })

    it('keeps a persisted selection through the pre-hydration window, filtering nothing', async () => {
      saveActiveGymFilter('Gym B')
      exercises.value = [makeExercise('Bench Press', { gyms: ['Gym A'] })]
      const f = mount() // gyms list still [] — preferences have not hydrated
      await nextTick()
      expect(f.activeGymFilter.value).toBe('Gym B')
      expect(f.effectiveGymFilter.value).toBeNull()
      // Inert, not hiding: a Gym-A-only exercise still renders.
      expect(names(f.filteredExercises.value)).toEqual(['Bench Press'])

      gyms.value = ['Gym A', 'Gym B']
      await nextTick()
      expect(f.effectiveGymFilter.value).toBe('Gym B')
    })

    it('prunes a selection whose gym was deleted on another device', async () => {
      saveActiveGymFilter('Gym B')
      gyms.value = ['Gym A', 'Gym B']
      const f = mount()
      expect(f.effectiveGymFilter.value).toBe('Gym B')
      gyms.value = ['Gym A']
      await nextTick()
      expect(f.activeGymFilter.value).toBeNull()
    })
  })

  describe('derived status', () => {
    beforeEach(() => {
      gyms.value = ['Gym A']
      tags.value = ['Push']
      exercises.value = [
        makeExercise('Bench Press', { tags: ['Push'] }),
        makeExercise('Barbell Row', { tags: ['Pull'] }),
      ]
    })

    it('isFilteringActive covers all three filters, and an inert gym selection does not count', () => {
      const f = mount()
      expect(f.isFilteringActive.value).toBe(false)

      f.searchQuery.value = '   '
      expect(f.isFilteringActive.value).toBe(false)
      f.searchQuery.value = 'bench'
      expect(f.isFilteringActive.value).toBe(true)
      f.searchQuery.value = ''

      f.activeTagFilters.value = ['Push']
      expect(f.isFilteringActive.value).toBe(true)
      f.activeTagFilters.value = []

      f.activeGymFilter.value = 'Not A Gym'
      expect(f.isFilteringActive.value).toBe(false)
      f.activeGymFilter.value = 'Gym A'
      expect(f.isFilteringActive.value).toBe(true)
    })

    it('announces the result tally only while a query is active', () => {
      const f = mount()
      expect(f.searchResultAnnouncement.value).toBe('')
      f.searchQuery.value = 'bench'
      expect(f.searchResultAnnouncement.value).toBe('1 result')
      f.searchQuery.value = 'deadlift'
      expect(f.searchResultAnnouncement.value).toBe('0 results')
      f.searchQuery.value = ''
      expect(f.searchResultAnnouncement.value).toBe('')
    })
  })
})
