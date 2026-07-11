<template>
  <Teleport to="body">
    <div v-if="exercise" class="repMaxOverlay" @click.self="emit('close')" @keydown.escape="emit('close')">
      <div class="repMaxModal" role="dialog" aria-modal="true" aria-labelledby="edit-exercise-title">
        <h2 id="edit-exercise-title">Edit Exercise</h2>
        <label class="repMaxLabel">
          Name
          <div class="repMaxInputRow">
            <input
              v-model.trim="editName"
              type="text"
              class="repMaxInput"
              autocomplete="off"
              maxlength="50"
            />
          </div>
        </label>
        <div class="repMaxLabel">
          Tags
          <div class="wtTagPicker">
            <button
              v-for="tag in availableEditTags"
              :key="tag"
              :class="['wtTagPickerChip', { wtTagPickerChipActive: editTags.includes(tag) }]"
              :style="!editTags.includes(tag)
                ? { borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }
                : {}"
              @click="toggleEditTag(tag)"
            >{{ tag }}</button>
            <span v-if="editTagAdding" class="wtTagInlineAdd">
              <input
                v-model.trim="newTagInput"
                type="text"
                autocomplete="off"
                placeholder="Tag name"
                maxlength="30"
                class="wtTagInlineInput"
                aria-label="New tag name"
                ref="editTagInputEl"
                @keyup.enter="addEditTag"
                @blur="finishEditTagAdd"
              />
            </span>
            <button v-else class="wtTagPickerChip wtTagAddChip" @mousedown.prevent @click="startEditTagAdd" aria-label="Add tag">+</button>
          </div>
        </div>
        <!-- Plate calculator settings (iOS grouped style) -->
        <div class="iosSettingsSection">
          <span class="iosSettingsHeader">Input Mode</span>
          <div class="iosSettingsGroup">
            <div class="iosSettingsRow">
              <span class="iosSettingsRowLabel">Plate calculator</span>
              <button
                class="iosToggle"
                :class="{ iosToggleOn: editPlateMode }"
                role="switch"
                :aria-checked="editPlateMode"
                @click="editPlateMode = !editPlateMode"
              >
                <span class="iosToggleKnob"></span>
              </button>
            </div>
            <template v-if="editPlateMode">
              <div class="iosSettingsRow">
                <span class="iosSettingsRowLabel">Counting</span>
                <div class="iosSegmentedControl">
                  <button
                    :class="['iosSegment', { iosSegmentActive: editPlateCountMode === 'per-side' }]"
                    @click="editPlateCountMode = 'per-side'"
                  >Per side</button>
                  <button
                    :class="['iosSegment', { iosSegmentActive: editPlateCountMode === 'total' }]"
                    @click="editPlateCountMode = 'total'"
                  >Total</button>
                </div>
              </div>
              <div class="iosSettingsRow">
                <span class="iosSettingsRowLabel">Starting weight</span>
                <div class="iosStepper">
                  <button class="iosStepperBtn" @click="editBarWeight = Math.max(0, editBarWeight - 5)" aria-label="Decrease weight">−</button>
                  <input
                    v-if="editBarWeightEditing"
                    ref="editBarWeightInputEl"
                    :value="editBarWeight"
                    type="text"
                    inputmode="numeric"
                    autocomplete="off"
                    class="iosStepperInput"
                    aria-label="Starting weight"
                    @focus="($event.target as HTMLInputElement)?.select(); scrollInputAboveKeyboard($event.target as HTMLElement)"
                    @blur="editBarWeight = Math.max(0, Math.min(MAX_WEIGHT, Math.round(Number(($event.target as HTMLInputElement).value) || 0))); editBarWeightEditing = false"
                  />
                  <button v-else class="iosStepperValue iosStepperValueTappable" @click="editBarWeightEditing = true; nextTick(() => editBarWeightInputEl?.focus())">{{ editBarWeight }} {{ weightUnit }}</button>
                  <button class="iosStepperBtn" @click="editBarWeight = Math.min(MAX_WEIGHT, editBarWeight + 5)" aria-label="Increase weight">+</button>
                </div>
              </div>
            </template>
          </div>
        </div>
        <!-- Intensity lens (#770): how many rep rows the PR-anchored intensity
             table calculates when logging this exercise. Default (10) stores
             nothing; any other value is a per-exercise override. -->
        <div class="iosSettingsSection">
          <span class="iosSettingsHeader">Intensity</span>
          <div class="iosSettingsGroup">
            <div class="iosSettingsRow">
              <span class="iosSettingsRowLabel">Rep rows shown</span>
              <div class="iosStepper">
                <button class="iosStepperBtn" @click="adjustIntensityMaxReps(-1)" :disabled="editIntensityMaxReps <= MIN_INTENSITY_MAX_REPS" aria-label="Fewer rep rows">−</button>
                <span class="iosStepperValue">{{ editIntensityMaxReps }}</span>
                <button class="iosStepperBtn" @click="adjustIntensityMaxReps(1)" :disabled="editIntensityMaxReps >= MAX_INTENSITY_MAX_REPS" aria-label="More rep rows">+</button>
              </div>
            </div>
          </div>
          <button
            v-if="editIntensityMaxReps !== DEFAULT_INTENSITY_MAX_REPS"
            class="wtIntensityEditReset"
            @click="resetIntensityMaxReps"
          >Reset to default</button>
          <span class="iosSettingsFooter">How many rep counts (1–{{ editIntensityMaxReps }}) the Intensity table calculates when you log this exercise — from warmups up to PR-beating loads at 100%.</span>
        </div>
        <!-- Coach equipment classification (#931 phase C): explicit kind for the
             AI Coach's strength analytics. "Auto" stores nothing and shows what
             the name heuristic resolves to. -->
        <div class="iosSettingsSection">
          <span class="iosSettingsHeader">Equipment</span>
          <div class="wtTagPicker" role="radiogroup" aria-label="Equipment type">
            <button
              v-for="opt in EQUIPMENT_OPTIONS"
              :key="opt.value ?? 'auto'"
              role="radio"
              :aria-checked="editEquipment === opt.value"
              :class="['wtTagPickerChip', { wtTagPickerChipActive: editEquipment === opt.value }]"
              :style="editEquipment !== opt.value
                ? { borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }
                : {}"
              @click="editEquipment = opt.value"
            >{{ opt.value === null ? `Auto (${autoEquipmentLabel})` : opt.label }}</button>
          </div>
          <span class="iosSettingsFooter">Used by Coach analytics: free-weight lifts anchor strength comparisons; machine and bodyweight numbers are flagged as not standards-comparable.</span>
        </div>
        <div class="repMaxActions">
          <button class="repMaxBtn repMaxBtnCalc" :disabled="!editName" @click="confirmSave">Save</button>
          <button class="repMaxBtn repMaxBtnClose" @click="emit('close')">Cancel</button>
        </div>
        <button
          v-if="isArchived"
          class="wtEditArchiveBtn"
          @click="emit('unarchive')"
        >Unarchive Exercise</button>
        <button
          v-else
          class="wtEditArchiveBtn"
          @click="emit('archive')"
        >Archive Exercise</button>
        <p class="wtEditArchiveHint">Hides this exercise from the main list — sets and PRs are preserved.</p>
        <button
          v-if="!confirmDeleteExercise"
          class="wtEditDeleteBtn"
          @click="confirmDeleteExercise = true"
          aria-label="Delete exercise"
        >Delete Exercise</button>
        <div v-else class="wtEditDeleteConfirm">
          <span class="wtEditDeleteConfirmText">Delete this exercise and all its sets?</span>
          <div class="wtEditDeleteConfirmActions">
            <button class="wtEditDeleteConfirmBtn wtEditDeleteConfirmCancel" @click="confirmDeleteExercise = false">Cancel</button>
            <button class="wtEditDeleteConfirmBtn wtEditDeleteConfirmDanger" @click="emit('delete')">Delete</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts">
import type { PlateCountMode } from '../stores/workout'
import type { ExerciseEquipment } from '../lib/coachAnalytics'

/** Payload emitted on Save — the parent applies it to the store. */
export interface EditExerciseSave {
  name: string
  tags: string[]
  plateMode: boolean
  plateCountMode: PlateCountMode
  barWeight: number
  /** Intensity-table rep-row count; null = use the default (10). */
  intensityMaxReps: number | null
  /** Coach equipment classification; null = Auto (name heuristic). */
  equipment: ExerciseEquipment | null
}
</script>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import type { Exercise } from '../stores/workout'
import { useWeightUnit } from '../composables/useWeightUnit'
import { useFocusTrap } from '../composables/useFocusTrap'
import { scrollInputAboveKeyboard } from '../lib/keyboardViewport'
import { MAX_WEIGHT } from '../lib/inputLimits'
import {
  DEFAULT_INTENSITY_MAX_REPS,
  MIN_INTENSITY_MAX_REPS,
  MAX_INTENSITY_MAX_REPS,
  sanitizeIntensityMaxReps,
} from '../lib/intensityTable'
import { classifyExercise } from '../lib/coachAnalytics'

const props = defineProps<{
  /** Exercise being edited; null renders nothing (modal closed). */
  exercise: Exercise | null
  /** All known tags, for the tag picker chips. */
  allTags: string[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', payload: EditExerciseSave): void
  (e: 'archive'): void
  (e: 'unarchive'): void
  (e: 'delete'): void
}>()

const { weightUnit } = useWeightUnit()

// ── Form state, seeded from the exercise each time the modal opens ──
const editName = ref('')
const editTags = ref<string[]>([])
const newTagInput = ref('')
const editPlateMode = ref(false)
const editPlateCountMode = ref<PlateCountMode>('per-side')
const editBarWeight = ref<number>(45)
const editBarWeightEditing = ref(false)
const editBarWeightInputEl = ref<HTMLInputElement | null>(null)
const confirmDeleteExercise = ref(false)

// ── Intensity lens config (#770) ────────────────────────────────
// How many rep rows (1..N) the PR-anchored intensity table calculates when
// logging this exercise. Default 10; a per-exercise override clamps to [1, 100].
const editIntensityMaxReps = ref<number>(DEFAULT_INTENSITY_MAX_REPS)

function adjustIntensityMaxReps(delta: number) {
  editIntensityMaxReps.value = sanitizeIntensityMaxReps(editIntensityMaxReps.value + delta)
}

function resetIntensityMaxReps() {
  editIntensityMaxReps.value = DEFAULT_INTENSITY_MAX_REPS
}

// ── Coach equipment classification (#931 phase C) ───────────────
// null = "Auto" (store nothing; the name heuristic classifies). The Auto chip
// shows what the heuristic currently resolves to so the user can see whether
// it's already right before overriding.
const EQUIPMENT_OPTIONS: ReadonlyArray<{ value: ExerciseEquipment | null; label: string }> = [
  { value: null, label: 'Auto' },
  { value: 'free_weight', label: 'Free weight' },
  { value: 'machine', label: 'Machine' },
  { value: 'bodyweight', label: 'Bodyweight' },
]
const editEquipment = ref<ExerciseEquipment | null>(null)

const AUTO_LABELS: Record<string, string> = {
  free_weight: 'free weight',
  machine: 'machine',
  bodyweight: 'bodyweight',
  unknown: 'unclassified',
}
const autoEquipmentLabel = computed(() => AUTO_LABELS[classifyExercise(editName.value)] ?? 'unclassified')

const isArchived = computed(() => !!props.exercise?.archived_at)

const focusTrap = useFocusTrap()

watch(() => props.exercise, async (exercise) => {
  if (exercise) {
    editName.value = exercise.name
    editTags.value = [...(exercise.tags || [])]
    editPlateMode.value = exercise.inputMode === 'plates'
    editPlateCountMode.value = exercise.plateCountMode || 'per-side'
    editBarWeight.value = exercise.barWeight ?? (exercise.plateCountMode === 'total' ? 0 : 45)
    editIntensityMaxReps.value = exercise.intensityMaxReps ?? DEFAULT_INTENSITY_MAX_REPS
    editEquipment.value = exercise.equipment ?? null
    newTagInput.value = ''
    editTagAdding.value = false
    confirmDeleteExercise.value = false
    await nextTick()
    const el = document.querySelector<HTMLElement>('[aria-labelledby="edit-exercise-title"]')
    if (el) {
      focusTrap.activate(el)
      // Don't auto-focus the name input — user usually isn't renaming
      ;(document.activeElement as HTMLElement)?.blur()
    }
  } else {
    focusTrap.deactivate()
  }
})

// ── Tag editing ─────────────────────────────────────────────────
const editTagInputEl = ref<HTMLInputElement | null>(null)
const editTagAdding = ref(false)

function startEditTagAdd() {
  editTagAdding.value = true
  nextTick(() => editTagInputEl.value?.focus())
}

function addEditTag() {
  const tag = newTagInput.value.trim()
  if (tag && !editTags.value.includes(tag)) {
    editTags.value.push(tag)
  }
  newTagInput.value = ''
  nextTick(() => editTagInputEl.value?.focus())
}

function finishEditTagAdd() {
  const tag = newTagInput.value.trim()
  if (tag && !editTags.value.includes(tag)) {
    editTags.value.push(tag)
  }
  newTagInput.value = ''
  editTagAdding.value = false
}

function toggleEditTag(tag: string) {
  if (editTags.value.includes(tag)) {
    editTags.value = editTags.value.filter(t => t !== tag)
  } else {
    editTags.value.push(tag)
  }
}

// All known tags, including any on this exercise that might not be in allTags yet
const availableEditTags = computed(() => {
  const all = new Set([...props.allTags, ...editTags.value])
  return [...all]
})

function confirmSave() {
  if (!props.exercise || !editName.value) return
  // Auto-add any pending tag text
  const pendingTag = newTagInput.value.trim()
  if (pendingTag && !editTags.value.includes(pendingTag)) {
    editTags.value.push(pendingTag)
  }
  // Store nothing when the rep count matches the default (keeps the override
  // clear); otherwise persist the per-exercise value.
  emit('save', {
    name: editName.value,
    tags: [...editTags.value],
    plateMode: editPlateMode.value,
    plateCountMode: editPlateCountMode.value,
    barWeight: editBarWeight.value,
    intensityMaxReps: editIntensityMaxReps.value === DEFAULT_INTENSITY_MAX_REPS ? null : editIntensityMaxReps.value,
    equipment: editEquipment.value,
  })
}
</script>
