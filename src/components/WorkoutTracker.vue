<template>
  <!-- Main card -->
  <div class="wtCard">
    <div class="wtCardHeader">
      <h2 class="wtTitle">Exercise Tracker</h2>
      <button class="wtLogBtn" @click="openNewExerciseModal">+ New Exercise</button>
    </div>

    <!-- Tag filter chips -->
    <div v-if="store.allTags.length > 0" class="wtTagFilterBar">
      <button
        v-for="tag in store.allTags"
        :key="tag"
        :class="['wtTagChip', { wtTagChipActive: activeTagFilters.includes(tag) }]"
        :style="activeTagFilters.includes(tag) ? {} : { borderColor: getTagColor(tag).border, color: getTagColor(tag).border }"
        @click="toggleTagFilter(tag)"
      >{{ tag }}</button>
      <button
        v-if="activeTagFilters.length > 0"
        class="wtTagClearBtn"
        @click="activeTagFilters = []"
      >Clear</button>
    </div>

    <p v-if="store.exercises.length === 0" class="wtEmpty">
      No exercises yet. Hit "+ New Exercise" to add your first one.
    </p>

    <ul v-else class="wtExerciseList" ref="exerciseListEl">
      <li
        v-for="(exercise, index) in filteredExercises"
        :key="exercise.id"
        class="wtExerciseItem"
        :class="{
          'wt-dragging': activeTagFilters.length === 0 && dragState.dragging && dragState.fromIndex === index,
          'wt-drag-over': activeTagFilters.length === 0 && dragState.dragging && dragState.overIndex === index && dragState.fromIndex !== index,
        }"
        :data-index="index"
      >
        <!-- Row: grip handle + expand toggle + per-exercise log button -->
        <div class="wtExerciseHeader">
          <span
            v-if="activeTagFilters.length === 0"
            class="wtDragHandle"
            @touchstart.prevent="onDragStart(index, $event)"
            @mousedown="onDragStart(index, $event)"
            aria-label="Drag to reorder"
          >⠿</span>
          <button
            class="wtExerciseRow"
            @click="toggleExpand(exercise.id)"
            :aria-expanded="expandedId === exercise.id"
          >
            <span class="wtExerciseName">{{ exercise.name }}</span>
            <span class="wtExerciseMeta">
              PR: {{ store.getExercisePR(exercise.id) || '—' }} lbs
              &nbsp;·&nbsp;
              {{ exercise.sets.length }} set{{ exercise.sets.length !== 1 ? 's' : '' }}
            </span>
            <span class="wtChevron">{{ expandedId === exercise.id ? '▲' : '▼' }}</span>
          </button>
          <template v-if="expandedId === exercise.id">
            <button
              class="wtExHeaderIconBtn"
              @click="openEditExerciseModal(exercise)"
              aria-label="Edit exercise"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
            </button>
            <button
              class="wtExHeaderIconBtn wtExHeaderIconBtnDel"
              @click="confirmDeleteId = exercise.id"
              aria-label="Delete exercise"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
            </button>
          </template>
          <button
            class="wtExerciseLogBtn"
            @click="openLogForExercise(exercise.id)"
            aria-label="Log a set for {{ exercise.name }}"
          >+ Log</button>
        </div>

        <!-- Expanded: graph → all sets → clear -->
        <div v-if="expandedId === exercise.id" class="wtExpandedPanel">
          <!-- Progress graph -->
          <ExerciseGraph :exercise="exercise" />

          <!-- All sets list (newest first) -->
          <ul class="wtSetList">
            <li v-if="exercise.sets.length === 0" class="wtSetEmpty">No sets logged yet.</li>
            <li
              v-for="set in visibleSets(exercise)"
              :key="set.id"
              class="wtSetRow"
              :class="{
                wtSetRowPR: set.estimated1RM === store.getExercisePR(exercise.id),
                'wtSetRowActive': activeSetId === set.id,
              }"
              @click="toggleSetActions(set.id)"
            >
              <span class="wtSetDate">{{ formatDate(set.date) }}</span>
              <span class="wtSetDetail">{{ set.weight }} lbs × {{ set.reps }}</span>
              <span class="wtSet1RM">
                ~{{ set.estimated1RM }} lbs
                <span v-if="set.estimated1RM === store.getExercisePR(exercise.id)" class="wtSetPR">🏆</span>
              </span>
              <div v-if="activeSetId === set.id" class="wtSetActions">
                <button
                  class="wtSetBtn"
                  @click.stop="openEditModal(exercise, set)"
                  aria-label="Edit set"
                >Edit</button>
                <button
                  class="wtSetBtn wtSetBtnDel"
                  @click.stop="store.deleteSet(exercise.id, set.id); logEvent('set_delete')"
                  aria-label="Delete set"
                >Delete</button>
              </div>
            </li>
          </ul>

          <!-- Show all toggle -->
          <div v-if="exercise.sets.length > SET_LIMIT" class="wtClearWrap">
            <button class="wtShowAllBtn" @click="toggleShowAll(exercise.id)">
              {{ showAllSets.has(exercise.id) ? 'Show less' : `Show all ${exercise.sets.length} sets` }}
            </button>
          </div>

          <!-- Clear all sets -->
          <div v-if="exercise.sets.length > 0" class="wtClearWrap">
            <button class="wtClearBtn" @click="confirmClearId = exercise.id">
              Clear all sets
            </button>
          </div>
        </div>
      </li>
    </ul>
  </div>

  <!-- Log / Edit Set Modal -->
  <Teleport to="body">
    <div v-if="showModal" class="repMaxOverlay" @click.self="closeModal">
      <div class="repMaxModal">
        <h2>{{ modalTitle }}</h2>

        <!-- New exercise mode: name + tags input -->
        <template v-if="!isEditMode && selectedExerciseId === '__new__'">
          <label class="repMaxLabel">
            Exercise name
            <div class="repMaxInputRow">
              <input
                v-model.trim="newExerciseName"
                type="text"
                placeholder="e.g. Bench Press"
                class="repMaxInput"
                autocomplete="off"
              />
            </div>
          </label>
          <div class="repMaxLabel">
            Tags
            <div class="wtTagPicker" v-if="allNewExerciseTags.length">
              <button
                v-for="tag in allNewExerciseTags"
                :key="tag"
                :class="['wtTagPickerChip', { wtTagPickerChipActive: newExerciseTags.includes(tag) }]"
                :style="newExerciseTags.includes(tag)
                  ? { borderColor: getTagColor(tag).border, background: getTagColor(tag).bg, color: getTagColor(tag).border }
                  : { borderColor: 'var(--border)', color: 'var(--text-secondary)' }"
                @click="toggleNewExerciseTag(tag)"
              >{{ tag }}</button>
            </div>
            <div class="wtTagAddRow">
              <input
                v-model.trim="newExerciseTagInput"
                type="text"
                placeholder="New tag..."
                class="repMaxInput"
                @keyup.enter="addNewExerciseTag"
              />
              <button class="wtTagAddBtn" @click="addNewExerciseTag" :disabled="!newExerciseTagInput">+</button>
            </div>
          </div>
        </template>

        <!-- Log for existing exercise mode: show name as subtitle -->
        <p v-else-if="isLogForExercise" class="wtModalSubtitle">{{ selectedExerciseName }}</p>

        <!-- Date: always visible -->
        <label class="repMaxLabel">
          Date
          <input
            v-model="date"
            type="date"
            :max="todayISO()"
            class="repMaxInput wtDateInput"
          />
        </label>

        <!-- Weight + Reps -->
        <div class="wtInputRow">
          <label class="repMaxLabel" style="flex:1">
            Weight
            <div class="repMaxInputRow">
              <input
                v-model.number="weight"
                type="number"
                inputmode="decimal"
                min="0"
                step="any"
                placeholder="135"
                class="repMaxInput"
              />
              <span class="repMaxUnit">lbs</span>
            </div>
          </label>

          <label class="repMaxLabel" style="flex:1">
            Reps
            <div class="repMaxInputRow">
              <input
                v-model.number="reps"
                type="number"
                inputmode="numeric"
                min="1"
                max="30"
                placeholder="8"
                class="repMaxInput"
              />
            </div>
          </label>
        </div>

        <!-- Live 1RM estimate -->
        <div v-if="liveEstimate" class="repMaxResult">
          <span class="repMaxResultLabel">Estimated 1RM</span>
          <span class="repMaxResultValue">{{ liveEstimate }} lbs</span>
          <span v-if="isNewPR" class="wtPrBadge">New PR! 🏆</span>
        </div>

        <div class="repMaxActions">
          <button class="repMaxBtn repMaxBtnCalc" :disabled="!canSave" @click="saveSet">
            {{ isEditMode ? 'Save Changes' : 'Save' }}
          </button>
          <button class="repMaxBtn repMaxBtnClose" @click="closeModal">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Confirm Clear All Modal -->
  <Teleport to="body">
    <div v-if="confirmClearId !== null" class="repMaxOverlay" @click.self="confirmClearId = null">
      <div class="repMaxModal wtConfirmModal">
        <div class="wtConfirmIcon">⚠️</div>
        <h2>Clear All Sets?</h2>
        <p class="wtConfirmText">
          This will permanently delete all
          <strong>{{ confirmClearExercise?.sets.length }}</strong>
          set{{ confirmClearExercise?.sets.length !== 1 ? 's' : '' }} for
          <strong>{{ confirmClearExercise?.name }}</strong>.
          This cannot be undone.
        </p>
        <div class="repMaxActions">
          <button class="repMaxBtn wtConfirmBtnDanger" @click="confirmClear">Clear All</button>
          <button class="repMaxBtn repMaxBtnClose" @click="confirmClearId = null">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Edit Exercise Modal -->
  <Teleport to="body">
    <div v-if="editTarget !== null" class="repMaxOverlay" @click.self="editTarget = null">
      <div class="repMaxModal">
        <h2>Edit Exercise</h2>
        <label class="repMaxLabel">
          Name
          <div class="repMaxInputRow">
            <input
              v-model.trim="editName"
              type="text"
              class="repMaxInput"
              autocomplete="off"
            />
          </div>
        </label>
        <div class="repMaxLabel">
          Tags
          <div class="wtTagPicker" v-if="availableEditTags.length">
            <button
              v-for="tag in availableEditTags"
              :key="tag"
              :class="['wtTagPickerChip', { wtTagPickerChipActive: editTags.includes(tag) }]"
              :style="editTags.includes(tag)
                ? { borderColor: getTagColor(tag).border, background: getTagColor(tag).bg, color: getTagColor(tag).border }
                : { borderColor: 'var(--border)', color: 'var(--text-secondary)' }"
              @click="toggleEditTag(tag)"
            >{{ tag }}</button>
          </div>
          <div class="wtTagAddRow">
            <input
              v-model.trim="newTagInput"
              type="text"
              placeholder="New tag..."
              class="repMaxInput"
              @keyup.enter="addEditTag"
            />
            <button class="wtTagAddBtn" @click="addEditTag" :disabled="!newTagInput">+</button>
          </div>
        </div>
        <div class="repMaxActions">
          <button class="repMaxBtn repMaxBtnCalc" :disabled="!editName" @click="confirmEditExercise">Save</button>
          <button class="repMaxBtn repMaxBtnClose" @click="editTarget = null">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Confirm Delete Exercise Modal -->
  <Teleport to="body">
    <div v-if="confirmDeleteId !== null" class="repMaxOverlay" @click.self="confirmDeleteId = null">
      <div class="repMaxModal wtConfirmModal">
        <div class="wtConfirmIcon">⚠️</div>
        <h2>Delete Exercise?</h2>
        <p class="wtConfirmText">
          This will permanently delete
          <strong>{{ confirmDeleteExercise?.name }}</strong>
          and all <strong>{{ confirmDeleteExercise?.sets.length }}</strong>
          set{{ confirmDeleteExercise?.sets.length !== 1 ? 's' : '' }}.
          This cannot be undone.
        </p>
        <div class="repMaxActions">
          <button class="repMaxBtn wtConfirmBtnDanger" @click="confirmDelete">Delete</button>
          <button class="repMaxBtn repMaxBtnClose" @click="confirmDeleteId = null">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, watch, onUnmounted } from 'vue'
import { useWorkoutStore } from '../stores/workout'
import { useAnalytics } from '../composables/useAnalytics'
import { getTagColor } from '../lib/tagColors'
import ExerciseGraph from './ExerciseGraph.vue'

const store = useWorkoutStore()
const { logEvent } = useAnalytics()

// ── Tag filtering ────────────────────────────────────────────────
const activeTagFilters = ref([])

function toggleTagFilter(tag) {
  const idx = activeTagFilters.value.indexOf(tag)
  if (idx >= 0) {
    activeTagFilters.value = activeTagFilters.value.filter(t => t !== tag)
  } else {
    activeTagFilters.value = [...activeTagFilters.value, tag]
  }
}

const filteredExercises = computed(() => {
  if (activeTagFilters.value.length === 0) return store.exercises
  return store.exercises.filter(e => {
    const tags = e.tags || []
    return activeTagFilters.value.some(t => tags.includes(t))
  })
})

// Remove stale tags from active filters
watch(() => store.allTags, (tags) => {
  activeTagFilters.value = activeTagFilters.value.filter(t => tags.includes(t))
})

// ── Card state ────────────────────────────────────────────────────
const expandedId = ref(null)
const showAllSets = ref(new Set())
const SET_LIMIT = 10

function toggleExpand(id) {
  expandedId.value = expandedId.value === id ? null : id
}

// ── Drag-to-reorder ─────────────────────────────────────────────
const exerciseListEl = ref(null)
const dragState = reactive({ dragging: false, fromIndex: -1, overIndex: -1 })

function getItemIndexFromPoint(clientY) {
  const list = exerciseListEl.value
  if (!list) return -1
  const items = list.querySelectorAll('.wtExerciseItem')
  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect()
    if (clientY >= rect.top && clientY <= rect.bottom) return i
    // If between items, snap to closest
    if (clientY < rect.top) return Math.max(0, i)
  }
  return items.length - 1
}

function onDragStart(index, event) {
  dragState.dragging = true
  dragState.fromIndex = index
  dragState.overIndex = index

  const onMove = (e) => {
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    const idx = getItemIndexFromPoint(clientY)
    if (idx !== -1) dragState.overIndex = idx
  }

  const onEnd = () => {
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)

    if (dragState.fromIndex !== dragState.overIndex) {
      store.reorderExercise(dragState.fromIndex, dragState.overIndex)
      logEvent('exercise_reorder')
    }

    dragState.dragging = false
    dragState.fromIndex = -1
    dragState.overIndex = -1
  }

  document.addEventListener('touchmove', onMove, { passive: true })
  document.addEventListener('touchend', onEnd, { once: true })
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onEnd, { once: true })
}

// ── Set actions (tap-to-reveal) ──────────────────────────────────
const activeSetId = ref(null)

function toggleSetActions(setId) {
  activeSetId.value = activeSetId.value === setId ? null : setId
}

function toggleShowAll(id) {
  const next = new Set(showAllSets.value)
  next.has(id) ? next.delete(id) : next.add(id)
  showAllSets.value = next
}

function visibleSets(exercise) {
  const reversed = [...exercise.sets].reverse()
  return showAllSets.value.has(exercise.id) ? reversed : reversed.slice(0, SET_LIMIT)
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Converts a stored ISO string back to the local YYYY-MM-DD for a date input
function isoToLocalDate(iso) {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayISO() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

// ── Log / Edit modal state ────────────────────────────────────────
const showModal = ref(false)
const editingSet = ref(null) // { exerciseId, setId } when editing, null when logging
const selectedExerciseId = ref('')
const newExerciseName = ref('')
const newExerciseTags = ref([])
const newExerciseTagInput = ref('')
const weight = ref(null)
const reps = ref(null)
const date = ref(todayISO())

const isEditMode = computed(() => editingSet.value !== null)

// True when logging a set for a known, pre-selected exercise
const isLogForExercise = computed(() =>
  !isEditMode.value &&
  selectedExerciseId.value !== '' &&
  selectedExerciseId.value !== '__new__'
)

const selectedExerciseName = computed(() =>
  store.exercises.find(e => e.id === selectedExerciseId.value)?.name ?? ''
)

const modalTitle = computed(() => {
  if (isEditMode.value) return 'Edit Set'
  if (selectedExerciseId.value === '__new__') return 'New Exercise'
  return 'Log a Set'
})

// Open modal to log a brand-new exercise
function openNewExerciseModal() {
  editingSet.value = null
  selectedExerciseId.value = '__new__'
  newExerciseTags.value = []
  newExerciseTagInput.value = ''
  showModal.value = true
}

function addNewExerciseTag() {
  const tag = newExerciseTagInput.value.trim()
  if (tag && !newExerciseTags.value.includes(tag)) {
    newExerciseTags.value.push(tag)
  }
  newExerciseTagInput.value = ''
}

function removeNewExerciseTag(tag) {
  newExerciseTags.value = newExerciseTags.value.filter(t => t !== tag)
}

const allNewExerciseTags = computed(() => {
  const all = new Set([...store.allTags, ...newExerciseTags.value])
  return [...all]
})

function toggleNewExerciseTag(tag) {
  if (newExerciseTags.value.includes(tag)) {
    newExerciseTags.value = newExerciseTags.value.filter(t => t !== tag)
  } else {
    newExerciseTags.value.push(tag)
  }
}

// Open modal pre-targeted at a specific existing exercise
function openLogForExercise(exerciseId) {
  editingSet.value = null
  selectedExerciseId.value = exerciseId
  date.value = todayISO()
  showModal.value = true
}

// Open modal to edit an existing set
function openEditModal(exercise, set) {
  editingSet.value = { exerciseId: exercise.id, setId: set.id }
  selectedExerciseId.value = exercise.id
  date.value = isoToLocalDate(set.date)
  weight.value = set.weight
  reps.value = set.reps
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  editingSet.value = null
  selectedExerciseId.value = ''
  newExerciseName.value = ''
  newExerciseTags.value = []
  newExerciseTagInput.value = ''
  weight.value = null
  reps.value = null
  date.value = todayISO()
}

const liveEstimate = computed(() => {
  if (!weight.value || weight.value <= 0 || !reps.value || reps.value < 1) return null
  if (reps.value === 1) return Math.round(weight.value)
  return Math.round(weight.value * (1 + reps.value / 30))
})

const isNewPR = computed(() => {
  if (!liveEstimate.value || isEditMode.value) return false
  const id = selectedExerciseId.value
  if (!id || id === '__new__') return false
  const pr = store.getExercisePR(id)
  return pr > 0 && liveEstimate.value > pr
})

const canSave = computed(() => {
  const hasWeight = weight.value > 0
  const hasReps = reps.value >= 1
  if (isEditMode.value) return hasWeight && hasReps
  if (selectedExerciseId.value === '__new__') return newExerciseName.value.length > 0 && hasWeight && hasReps
  return selectedExerciseId.value !== '' && hasWeight && hasReps
})

function saveSet() {
  if (!canSave.value) return
  if (isEditMode.value) {
    store.updateSet(editingSet.value.exerciseId, editingSet.value.setId, weight.value, reps.value, date.value)
    logEvent('set_edit')
  } else {
    let exerciseId = selectedExerciseId.value
    if (exerciseId === '__new__') {
      // Auto-add any pending tag text
      const pendingTag = newExerciseTagInput.value.trim()
      if (pendingTag && !newExerciseTags.value.includes(pendingTag)) {
        newExerciseTags.value.push(pendingTag)
      }
      exerciseId = store.addExercise(newExerciseName.value, newExerciseTags.value)
      logEvent('exercise_add', { name: newExerciseName.value })
    }
    store.logSet(exerciseId, weight.value, reps.value, date.value)
    logEvent('set_log')
  }
  closeModal()
}

// ── Confirm clear state ───────────────────────────────────────────
const confirmClearId = ref(null)

const confirmClearExercise = computed(() =>
  confirmClearId.value !== null
    ? store.exercises.find(e => e.id === confirmClearId.value)
    : null
)

function confirmClear() {
  if (confirmClearId.value === null) return
  const count = confirmClearExercise.value?.sets.length ?? 0
  store.clearSets(confirmClearId.value)
  confirmClearId.value = null
  logEvent('sets_clear_all', { count })
}

// ── Edit exercise state (rename + tags) ──────────────────────────
const editTarget = ref(null)
const editName = ref('')
const editTags = ref([])
const newTagInput = ref('')

function openEditExerciseModal(exercise) {
  editTarget.value = exercise.id
  editName.value = exercise.name
  editTags.value = [...(exercise.tags || [])]
  newTagInput.value = ''
}

function addEditTag() {
  const tag = newTagInput.value.trim()
  if (tag && !editTags.value.includes(tag)) {
    editTags.value.push(tag)
  }
  newTagInput.value = ''
}

function removeEditTag(tag) {
  editTags.value = editTags.value.filter(t => t !== tag)
}

function toggleEditTag(tag) {
  if (editTags.value.includes(tag)) {
    editTags.value = editTags.value.filter(t => t !== tag)
  } else {
    editTags.value.push(tag)
  }
}

// All known tags, including any on this exercise that might not be in allTags yet
const availableEditTags = computed(() => {
  const all = new Set([...store.allTags, ...editTags.value])
  return [...all]
})

function confirmEditExercise() {
  if (!editTarget.value || !editName.value) return
  // Auto-add any pending tag text
  const pendingTag = newTagInput.value.trim()
  if (pendingTag && !editTags.value.includes(pendingTag)) {
    editTags.value.push(pendingTag)
  }
  store.renameExercise(editTarget.value, editName.value)
  store.updateExerciseTags(editTarget.value, editTags.value)
  editTarget.value = null
  logEvent('exercise_edit')
}

// ── Delete exercise state ─────────────────────────────────────────
const confirmDeleteId = ref(null)

const confirmDeleteExercise = computed(() =>
  confirmDeleteId.value !== null
    ? store.exercises.find(e => e.id === confirmDeleteId.value)
    : null
)

function confirmDelete() {
  if (confirmDeleteId.value === null) return
  if (expandedId.value === confirmDeleteId.value) expandedId.value = null
  store.deleteExercise(confirmDeleteId.value)
  confirmDeleteId.value = null
  logEvent('exercise_delete')
}
</script>
