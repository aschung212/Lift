<template>
  <Teleport to="body">
    <div v-if="open" class="repMaxOverlay" @click.self="emit('close')" @keydown.escape="emit('close')">
      <div class="repMaxModal" role="dialog" aria-modal="true" :aria-labelledby="titleId">
        <h2 :id="titleId">Choose Exercise</h2>

        <div v-if="exercises.length >= SEARCH_THRESHOLD" class="wtSearchBar">
          <svg class="wtSearchIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            v-model.trim="searchQuery"
            type="search"
            autocomplete="off"
            class="wtSearchInput"
            placeholder="Search exercises…"
            aria-label="Search exercises"
          />
          <span v-if="searchQuery" class="wtSearchCount" aria-hidden="true">{{ visibleExercises.length }} result{{ visibleExercises.length !== 1 ? 's' : '' }}</span>
          <span class="srOnly" role="status" aria-live="polite" aria-atomic="true">{{ searchResultAnnouncement }}</span>
        </div>

        <div class="wtExPickerList">
          <button
            v-for="ex in visibleExercises"
            :key="ex.id"
            class="wtExPickerRow"
            @click="emit('select', ex.id)"
          >
            <span class="wtExPickerName">{{ ex.name }}</span>
            <span class="wtChevron">›</span>
          </button>
          <p v-if="searchQuery && visibleExercises.length === 0" class="wtEmpty wtExPickerEmpty">
            No exercises match that search.
          </p>
          <button
            class="wtExPickerRow wtExPickerNew"
            @click="emit('create-new')"
          >
            <span class="wtExPickerName">+ New exercise</span>
            <span class="wtChevron">›</span>
          </button>
        </div>
        <div class="repMaxActions">
          <button class="repMaxBtn repMaxBtnClose" @click="emit('close')">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Exercise } from '../stores/workout'

/**
 * Exercise count at which the search field appears (LIFT-1462).
 *
 * Derived from the point the list stops fitting, which is the same rule
 * WorkoutTracker's `>= 5` and ExerciseManagerModal's `>= 8` each applied to
 * their own surface: `.wtExPickerList` caps at 300px and every row is 44px
 * plus a 1px divider, so with the always-present "+ New exercise" row this
 * list begins to scroll at SIX exercises. Five puts the field on screen one
 * exercise before that, so a scrolling picker never lacks one — the sibling
 * threshold of 8 would leave exactly the 6- and 7-exercise lists scrolling
 * with no way to jump.
 */
const SEARCH_THRESHOLD = 5

const props = withDefaults(defineProps<{
  open: boolean
  /** Active (non-archived) exercises offered for quick-logging. */
  exercises: Exercise[]
  /**
   * Id of the `<h2>` this dialog is labelled by. Per-host rather than a shared
   * constant because both hosts live under `<KeepAlive>` and each finds its own
   * dialog with a `useModal` selector — one id across two mounted hosts is a
   * duplicate id waiting to trap focus in the wrong tab's picker.
   */
  titleId?: string
}>(), {
  titleId: 'timeline-picker-title',
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', exerciseId: string): void
  (e: 'create-new'): void
}>()

const searchQuery = ref('')

/**
 * The query is transient UI state, not a preference: the sheet is dismissed and
 * re-opened between sets, and a stale filter would silently hide the exercise
 * the user came back for. The component stays mounted across opens (both hosts
 * render it unconditionally and gate on `open`), so the reset has to be
 * explicit.
 *
 * Deliberately no autofocus on the field: iOS shows the caret but withholds the
 * keyboard for a programmatically-focused input, which reads as a dead control
 * — the user's first tap raises it.
 */
watch(() => props.open, (open) => {
  if (open) searchQuery.value = ''
})

/**
 * Name-only, and in the order the host handed us — recency for the Workouts
 * tab's quick-log (#936), store order for CalendarView's backfill. Filtering
 * must not re-sort: "what am I training right now" is the whole reason the
 * quick-log list is recency-ordered, and it should survive narrowing.
 *
 * Tags are deliberately NOT matched, unlike the exercise list's search: a
 * picker row renders its name and nothing else, so a tag hit would return rows
 * with no visible reason for matching, and this sheet has no tag chips to
 * explain them.
 */
const visibleExercises = computed((): Exercise[] => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return props.exercises
  return props.exercises.filter(e => e.name.toLowerCase().includes(query))
})

/**
 * Screen-reader announcement for the result tally (#989, WCAG 2.2 SC 4.1.3).
 * The visible `.wtSearchCount` badge is aria-hidden and only mounts while a
 * query is active, so it can't announce; this feeds a live region that is
 * present for as long as the search bar is. Empty with no query so nothing is
 * spoken on clear.
 */
const searchResultAnnouncement = computed(() => {
  if (!searchQuery.value) return ''
  const n = visibleExercises.value.length
  return `${n} result${n !== 1 ? 's' : ''}`
})
</script>
