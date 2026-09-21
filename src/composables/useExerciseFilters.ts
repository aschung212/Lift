/**
 * The exercise-list filter stack (LIFT-915) — gym → search → tags → recency.
 *
 * WorkoutTracker's list surfaces all read from one pipeline, and the ORDER of
 * its stages is load-bearing rather than incidental:
 *
 *   1. the gym filter is exclusive (AND) and applied FIRST (#961), so tags and
 *      the search narrow *within* the gym you are training at;
 *   2. search and tags narrow that base;
 *   3. recency ordering (#936) is applied LAST, so a tag- or search-filtered
 *      subset stays recency-ordered too.
 *
 * Three consumers branch off that pipeline at different stages and must keep
 * doing so: the quick-log picker takes the gym-scoped list WITHOUT search or
 * tags (`exercisesByRecency`), the session-plan card takes gym + tags but
 * neither the search nor the recency sort (`planScopeExercises`, #1256), and
 * the main list takes all of it (`filteredExercises`). Extracting the stack
 * into one composable is what keeps those three branch points visible next to
 * each other instead of ~200 lines apart in a 3,400-line component.
 *
 * The composable owns the filter STATE as well as the derivations, including
 * the device-local persistence of the active gym ("which gym am I at" is not a
 * synced preference, #961) and the two pruning watchers that keep a selection
 * from outliving the tag or gym it names.
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { Exercise } from '../stores/workout'
import { setDayKey } from '../lib/dates'
import { loadActiveGymFilter, matchesGymFilter, saveActiveGymFilter } from '../lib/gyms'

export interface UseExerciseFiltersOptions {
  /** Active (non-archived) exercises — the base population for every list surface. */
  activeExercises: () => Exercise[]
  /** Every tag in the store. Chips narrow this to tags on an active exercise. */
  allTags: () => readonly string[]
  /** The synced gym list. Async-hydrated, so it reads `[]` before `init()` lands. */
  allGyms: () => readonly string[]
}

export interface UseExerciseFiltersReturn {
  /** Free-text query over exercise names AND their tags. */
  searchQuery: Ref<string>
  /** Additive (OR) tag filter. */
  activeTagFilters: Ref<string[]>
  /** The device-local gym selection, as stored. May name a gym that no longer exists. */
  activeGymFilter: Ref<string | null>
  /** The gym selection actually applied — inert until the gym exists in the list. */
  effectiveGymFilter: ComputedRef<string | null>
  /** Active exercises narrowed to the effective gym — the base for every list surface. */
  gymFilteredExercises: ComputedRef<Exercise[]>
  /** Exercise count per tag within the active gym — the "Push 23" chip suffix. */
  tagCounts: ComputedRef<Record<string, number>>
  /** Tag chips to render, narrowed by the search query. */
  filteredTags: ComputedRef<string[]>
  /** Gym-scoped, recency-ordered, unfiltered — the quick-log picker's list. */
  exercisesByRecency: ComputedRef<Exercise[]>
  /** The main list: gym → search → tags → recency. */
  filteredExercises: ComputedRef<Exercise[]>
  /** Gym + tags, no search and no recency sort — the session-plan scope (#1256). */
  planScopeExercises: ComputedRef<Exercise[]>
  /** Polite live-region text for the search tally; empty while no query is active. */
  searchResultAnnouncement: ComputedRef<string>
  /** True when any of the three filters is narrowing the list. */
  isFilteringActive: ComputedRef<boolean>
  /** Exclusive select: tapping the active gym deselects back to "All Gyms". */
  toggleGymFilter: (gym: string) => void
  /** Apply/remove a tag filter, clearing any search query. */
  toggleTagFilter: (tag: string) => void
  /** The "All" chip — clear both the search and any active tags. */
  clearSearchAndTags: () => void
}

export function useExerciseFilters(
  options: UseExerciseFiltersOptions,
): UseExerciseFiltersReturn {
  const { activeExercises, allTags, allGyms } = options

  // ── Gym filtering (#961) ─────────────────────────────────────────
  // Exclusive (AND) filter applied BEFORE the additive tag filter: pick the gym
  // you're training at and exercises assigned only to other gyms disappear.
  // The gym list is a synced preference; the ACTIVE selection is device-local
  // ("which gym am I at" doesn't belong on other devices).
  const activeGymFilter = ref<string | null>(loadActiveGymFilter())

  /**
   * The filter actually applied. A persisted selection is only honored once the
   * gym exists in the (async-hydrated) list — before hydration, and for a gym
   * deleted on another device, the filter is inert rather than hiding rows.
   */
  const effectiveGymFilter = computed(() =>
    activeGymFilter.value && allGyms().includes(activeGymFilter.value)
      ? activeGymFilter.value
      : null
  )

  /** Active exercises narrowed to the effective gym — the base for every list surface. */
  const gymFilteredExercises = computed(() => {
    const gym = effectiveGymFilter.value
    const base = activeExercises()
    if (!gym) return base
    const gyms = allGyms()
    return base.filter(e => matchesGymFilter(e.gyms, gym, gyms))
  })

  function toggleGymFilter(gym: string) {
    // Exclusive select: tapping the active gym deselects back to "All Gyms".
    activeGymFilter.value = activeGymFilter.value === gym ? null : gym
  }

  watch(activeGymFilter, saveActiveGymFilter)

  // Reset a stale selection when its gym is renamed/deleted. Only prune against
  // a NON-EMPTY list: during the pre-hydration window the list is [] and pruning
  // would wipe the persisted device-local selection (effectiveGymFilter already
  // keeps the filter inert until the gym exists).
  watch(() => allGyms(), (gyms) => {
    if (gyms.length > 0 && activeGymFilter.value && !gyms.includes(activeGymFilter.value)) {
      activeGymFilter.value = null
    }
  })

  // ── Search & tag filtering ──────────────────────────────────────
  const searchQuery = ref('')
  const activeTagFilters = ref<string[]>([])

  // Remove stale tags from active filters
  watch(() => allTags(), (tags) => {
    activeTagFilters.value = activeTagFilters.value.filter(t => tags.includes(t))
  })

  /**
   * Count of exercises carrying each tag — powers the "Push 23" suffix on tag
   * chips. Counts only active (non-archived) exercises — narrowed to the active
   * gym (#961) — so that the chip count matches what tapping the tag will
   * actually show. Tags that exist solely on archived exercises are filtered
   * out by `filteredTags` below.
   */
  const tagCounts = computed<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    for (const e of gymFilteredExercises.value) {
      for (const t of e.tags || []) {
        map[t] = (map[t] || 0) + 1
      }
    }
    return map
  })

  /**
   * Tag chips visible in the filter row. When the user is searching we narrow
   * the row to tags that match the query (so typing "shoulders" also filters
   * the chips), plus any currently-active tag so the user can see + toggle it
   * back off without clearing the search first.
   */
  const filteredTags = computed<string[]>(() => {
    // Only surface tags that exist on at least one active (non-archived)
    // exercise. Otherwise tapping a chip filters to an empty list because the
    // archived section is hidden whenever a filter is active.
    const tags = allTags().filter(t => (tagCounts.value[t] || 0) > 0)
    const q = searchQuery.value.trim().toLowerCase()
    if (!q) return tags
    return tags.filter(t =>
      t.toLowerCase().includes(q) || activeTagFilters.value.includes(t)
    )
  })

  function toggleTagFilter(tag: string) {
    // Tapping a tag chip commits the user's intent: clear the search and apply
    // the tag as a filter. If the tag was already active, tapping deactivates it.
    const wasActive = activeTagFilters.value.includes(tag)
    searchQuery.value = ''
    if (wasActive) {
      activeTagFilters.value = activeTagFilters.value.filter(t => t !== tag)
    } else {
      activeTagFilters.value = [...activeTagFilters.value, tag]
    }
  }

  /** "All" chip — clear both the search and any active tags. */
  function clearSearchAndTags() {
    searchQuery.value = ''
    activeTagFilters.value = []
  }

  /**
   * Most recent activity day-key per exercise — the max `setDayKey` across all
   * of its sets, INCLUDING today (a set logged today floats the exercise to the
   * top). Exercises never logged map to '' and sort to the bottom. Built once
   * per set-data change so the recency sort in `filteredExercises` stays
   * O(n·log n) rather than O(n·m) rescanned on every render. (#936)
   */
  const lastActivityByExercise = computed(() => {
    const map = new Map<string, string>()
    for (const ex of activeExercises()) {
      let latest = ''
      for (const s of ex.sets) {
        const day = setDayKey(s.date)
        if (day > latest) latest = day
      }
      map.set(ex.id, latest)
    }
    return map
  })

  /**
   * Sort a list of exercises by most-recent activity (descending) without
   * mutating the input. `.sort` is stable, so equal-recency exercises (including
   * never-logged, key '') keep their incoming order, preserving any manual
   * drag/keyboard reorder as a tiebreaker. (#936)
   */
  function sortByRecency(list: readonly Exercise[]): Exercise[] {
    const activity = lastActivityByExercise.value
    return list.slice().sort((a, b) => {
      const ka = activity.get(a.id) ?? ''
      const kb = activity.get(b.id) ?? ''
      if (ka === kb) return 0
      return ka < kb ? 1 : -1
    })
  }

  /**
   * Active exercises ordered by recency, with no search/tag filter — feeds the
   * "Choose Exercise" quick-log picker so the next exercise to train sits at the
   * top of that list too. (#936) Gym-scoped (#961): the picker exists to answer
   * "what am I logging right now?", so it respects the active gym like the list.
   */
  const exercisesByRecency = computed(() => sortByRecency(gymFilteredExercises.value))

  const filteredExercises = computed(() => {
    // Gym filter first (#961) — exclusive AND; search/tags narrow within it.
    let result: readonly Exercise[] = gymFilteredExercises.value
    // Text search — check both name and tags so "Push" matches tag-filtered rows.
    const q = searchQuery.value.trim().toLowerCase()
    if (q) {
      result = result.filter(e => {
        if (e.name.toLowerCase().includes(q)) return true
        const tags = e.tags || []
        return tags.some(t => t.toLowerCase().includes(q))
      })
    }
    // Tag filter
    if (activeTagFilters.value.length > 0) {
      result = result.filter(e => {
        const tags = e.tags || []
        return activeTagFilters.value.some(t => tags.includes(t))
      })
    }
    // Recency ordering (#936): most recently logged exercise first, so the next
    // exercise to perform is the easiest to reach. Applied AFTER filtering so
    // tag / search subsets stay recency-ordered too — the most recent exercise
    // within a muscle group floats to the top of that filtered view.
    return sortByRecency(result)
  })

  /**
   * Screen-reader announcement for the live search-result count (#989, WCAG 2.2
   * SC 4.1.3 Status Messages). The visible `.wtSearchCount` badge is aria-hidden
   * and only mounts while typing, so it can't reliably announce; this string
   * feeds a persistent polite live region that voices the tally as the query
   * narrows. Empty while no query is active so nothing is spoken on clear.
   */
  const searchResultAnnouncement = computed(() => {
    if (!searchQuery.value) return ''
    const n = filteredExercises.value.length
    return `${n} result${n !== 1 ? 's' : ''}`
  })

  /**
   * True when the list is showing a filtered subset of exercises (either a
   * text search query or one-or-more active tag filters). Long-press
   * reorder is disabled in this state because `v-for` gives us indices
   * into the filtered subset, and those indices are meaningless to the
   * store, which splices the unfiltered `exercises` array. Dropping a
   * filtered-index 0 row would move the absolute-index 0 row — usually
   * a completely different exercise the user can't even see.
   *
   * Fixes: reordering while searching silently scrambled unrelated rows
   * (previously only the tag-filter path was gated).
   */
  const isFilteringActive = computed(() =>
    activeTagFilters.value.length > 0 ||
    searchQuery.value.trim() !== '' ||
    effectiveGymFilter.value !== null
  )

  // ── Guided session plan (#1256) ─────────────────────────────────
  /**
   * Scope for the "repeat last session" plan: gym + tag filtered, WITHOUT the
   * search query and WITHOUT the recency sort. Search means "find one specific
   * exercise" (the card hides there), and the today-inclusive recency sort
   * reshuffles as sets land — a just-logged exercise would jump to the top of
   * the plan mid-workout. Store order is stable, so rows stay put.
   */
  const planScopeExercises = computed(() => {
    const result = gymFilteredExercises.value
    if (activeTagFilters.value.length === 0) return result
    return result.filter(e => {
      const tags = e.tags || []
      return activeTagFilters.value.some(t => tags.includes(t))
    })
  })

  return {
    searchQuery,
    activeTagFilters,
    activeGymFilter,
    effectiveGymFilter,
    gymFilteredExercises,
    tagCounts,
    filteredTags,
    exercisesByRecency,
    filteredExercises,
    planScopeExercises,
    searchResultAnnouncement,
    isFilteringActive,
    toggleGymFilter,
    toggleTagFilter,
    clearSearchAndTags,
  }
}
