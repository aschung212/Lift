<template>
  <Teleport to="body">
    <div v-if="open" class="repMaxOverlay" @click.self="emit('close')" @keydown.escape="emit('close')">
      <div class="repMaxModal" role="dialog" aria-modal="true" aria-labelledby="exercise-manager-title">
        <h2 id="exercise-manager-title">Manage Exercises</h2>

        <div v-if="exercises.length >= SEARCH_THRESHOLD" class="wtSearchBar">
          <svg class="wtSearchIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            v-model.trim="searchQuery"
            type="search"
            class="wtSearchInput"
            placeholder="Search exercises…"
            aria-label="Search exercises"
          />
          <span v-if="searchQuery" class="wtSearchCount" aria-hidden="true">{{ visibleExercises.length }} result{{ visibleExercises.length !== 1 ? 's' : '' }}</span>
        </div>

        <p v-if="exercises.length === 0" class="wtEmpty" style="margin: var(--space-4) 0">No exercises yet. Log a set to create your first one.</p>
        <p v-else-if="visibleExercises.length === 0" class="wtEmpty" style="margin: var(--space-4) 0">No exercises match that search.</p>

        <ul v-else class="wtTagManagerList">
          <li v-for="exercise in visibleExercises" :key="exercise.id" class="wtTagManagerItemWrap">
            <div class="wtTagManagerItem">
              <button
                class="wtTagManagerExpandBtn"
                :aria-expanded="expandedId === exercise.id"
                :aria-label="'Edit gyms and tags for ' + exercise.name"
                @click="toggleExpand(exercise.id)"
              >
                <span class="wtTagManagerExpandIcon" :class="{ expanded: expandedId === exercise.id }">›</span>
              </button>
              <span
                class="wtExManagerLabel"
                role="button"
                tabindex="0"
                @click="toggleExpand(exercise.id)"
                @keydown.enter="toggleExpand(exercise.id)"
                @keydown.space.prevent="toggleExpand(exercise.id)"
              >
                <span class="wtExManagerName">{{ exercise.name }}</span>
                <span class="wtExManagerSummary">{{ gymSummary(exercise) }}</span>
              </span>
            </div>

            <div v-if="expandedId === exercise.id" class="wtExManagerDetail">
              <span class="wtExManagerSectionLabel">Gyms</span>
              <div v-if="gyms.length" class="wtTagPicker" role="group" :aria-label="'Gyms for ' + exercise.name">
                <button
                  v-for="gym in gyms"
                  :key="gym"
                  :aria-pressed="hasGym(exercise, gym)"
                  :class="['wtTagPickerChip', { wtTagPickerChipActive: hasGym(exercise, gym) }]"
                  :style="!hasGym(exercise, gym)
                    ? { borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }
                    : {}"
                  @click="emit('toggle-exercise-gym', exercise.id, gym)"
                >{{ gym }}</button>
              </div>
              <span v-else class="wtExManagerSectionEmpty">No gyms yet — create one under Settings › Gyms.</span>

              <span class="wtExManagerSectionLabel">Tags</span>
              <div v-if="allTags.length" class="wtTagPicker" role="group" :aria-label="'Tags for ' + exercise.name">
                <button
                  v-for="tag in allTags"
                  :key="tag"
                  :aria-pressed="exercise.tags.includes(tag)"
                  :class="['wtTagPickerChip', { wtTagPickerChipActive: exercise.tags.includes(tag) }]"
                  :style="!exercise.tags.includes(tag)
                    ? { borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }
                    : {}"
                  @click="emit('toggle-exercise-tag', exercise.id, tag)"
                >{{ tag }}</button>
              </div>
              <span v-else class="wtExManagerSectionEmpty">No tags yet — create one from the Tags row on the workout tab.</span>
            </div>
          </li>
        </ul>

        <span class="iosSettingsFooter">Exercises with no gym assigned show at every gym.</span>
        <div class="repMaxActions">
          <button class="repMaxBtn repMaxBtnClose" @click="emit('close')">Done</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * ExerciseManagerModal (#1252) — the exercise-first inverse of
 * GymManagerModal.
 *
 * The gym manager answers "which exercises are at this gym?"; sweeping the
 * other way ("which gyms is THIS exercise at, and is one missing?") meant
 * opening every gym in turn and transposing the matrix in your head. The
 * per-exercise view existed only inside EditExerciseModal — one exercise at a
 * time, behind the log-set gear, and buried among name / plate calculator /
 * intensity / archive / delete.
 *
 * Scope is deliberately membership-only: no exercise create/rename/archive/
 * delete and no inline gym/tag creation. Those already have owners
 * (EditExerciseModal, GymManagerModal, TagManagerModal), and a second path to
 * the destructive ones would violate the one-interaction-path rule.
 */
import { ref, computed, watch, nextTick } from 'vue'
import type { Exercise } from '../stores/workout'
import { useFocusTrap } from '../composables/useFocusTrap'

/**
 * Exercise count at which the search field appears. Mirrors WorkoutTracker's
 * own `>= 5` search threshold in spirit — below it the whole list fits on
 * screen and a search box is just chrome.
 */
const SEARCH_THRESHOLD = 8

const props = defineProps<{
  open: boolean
  /**
   * All exercises (including archived) — the rows, and the source of each
   * row's live gym/tag membership. Hosts must bind a FRESH-IDENTITY array
   * (e.g. `computed(() => [...store.exercises])`): the workout store mutates
   * exercises in place behind a shallowRef, so a stable array identity lets
   * Vue skip this modal's re-render and the chips would freeze while the
   * modal stays open (#963).
   */
  exercises: Exercise[]
  /** The synced gym list (preferences store) — chips in each row's Gym section. */
  gyms: string[]
  /** All known tags — chips in each row's Tags section. */
  allTags: string[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toggle-exercise-gym', exerciseId: string, gym: string): void
  (e: 'toggle-exercise-tag', exerciseId: string, tag: string): void
}>()

const expandedId = ref<string | null>(null)
const searchQuery = ref('')

const focusTrap = useFocusTrap()

// Reset transient UI state on every open, then trap focus in the dialog.
watch(() => props.open, async (open) => {
  if (open) {
    expandedId.value = null
    searchQuery.value = ''
    await nextTick()
    const el = document.querySelector<HTMLElement>('[aria-labelledby="exercise-manager-title"]')
    if (el) focusTrap.activate(el)
  } else {
    focusTrap.deactivate()
  }
})

/**
 * Active exercises first, alphabetical within each group, archived last.
 *
 * Deliberately NOT the recency order the workout tab uses (#936): that list is
 * a logging surface where "what am I training now" wins, while this one is a
 * lookup surface — you arrive knowing the exercise's name and want to find it.
 * Archived exercises stay listed (the gym/tag managers include them too) but
 * sink to the bottom, since they are not part of a day-to-day audit.
 */
const sortedExercises = computed((): Exercise[] => {
  const byName = (a: Exercise, b: Exercise) => a.name.localeCompare(b.name)
  const active = props.exercises.filter(e => !e.archived_at).sort(byName)
  const archived = props.exercises.filter(e => !!e.archived_at).sort(byName)
  return [...active, ...archived]
})

const visibleExercises = computed((): Exercise[] => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return sortedExercises.value
  return sortedExercises.value.filter(e => e.name.toLowerCase().includes(query))
})

function toggleExpand(exerciseId: string) {
  expandedId.value = expandedId.value === exerciseId ? null : exerciseId
}

function hasGym(exercise: Exercise, gym: string): boolean {
  return (exercise.gyms || []).includes(gym)
}

/**
 * The collapsed row's second line. Gym membership only — spotting a gap there
 * is the whole reason this surface exists, and it is the one field with no
 * other read-out in the app (tag membership is already visible in the workout
 * tab's tag chips and the tag manager's counts).
 *
 * Only gyms that still exist in the synced list are named, matching
 * `matchesGymFilter`'s orphan rule: an exercise whose every gym was renamed or
 * deleted on another device is effectively unassigned, so it reads "All gyms"
 * here rather than naming a gym the user can no longer see.
 */
function gymSummary(exercise: Exercise): string {
  const known = (exercise.gyms || []).filter(g => props.gyms.includes(g))
  const membership = known.length ? known.join(' · ') : 'All gyms'
  return exercise.archived_at ? `Archived · ${membership}` : membership
}
</script>
