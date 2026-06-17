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
        <!-- Warmup ramp (LIFT-725): per-exercise custom ramp. Each step is an
             intensity (% of working weight) + a rep target. No steps = no ramp;
             matching the default stores nothing (the default applies). -->
        <div class="iosSettingsSection">
          <span class="iosSettingsHeader">Warmup Ramp</span>
          <div class="iosSettingsGroup">
            <div
              v-for="(step, i) in editWarmupSteps"
              :key="i"
              class="wtWarmupEditRow"
            >
              <div class="wtWarmupEditRowHead">
                <span class="iosSettingsRowLabel">Warm-up {{ i + 1 }}</span>
                <button
                  class="wtWarmupEditRemove"
                  @click="removeWarmupStep(i)"
                  :aria-label="`Remove warm-up ${i + 1}`"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
              </div>
              <div class="wtWarmupEditFields">
                <div class="wtWarmupEditField">
                  <span class="wtWarmupEditFieldLabel">Intensity</span>
                  <div class="iosStepper">
                    <button class="iosStepperBtn" @click="adjustWarmupPct(i, -PCT_STEP)" :aria-label="`Decrease warm-up ${i + 1} intensity`">−</button>
                    <span class="iosStepperValue">{{ step.pctInt }}%</span>
                    <button class="iosStepperBtn" @click="adjustWarmupPct(i, PCT_STEP)" :aria-label="`Increase warm-up ${i + 1} intensity`">+</button>
                  </div>
                </div>
                <div class="wtWarmupEditField">
                  <span class="wtWarmupEditFieldLabel">Reps</span>
                  <div class="iosStepper">
                    <button class="iosStepperBtn" @click="adjustWarmupReps(i, -1)" :aria-label="`Decrease warm-up ${i + 1} reps`">−</button>
                    <span class="iosStepperValue">{{ step.reps }}</span>
                    <button class="iosStepperBtn" @click="adjustWarmupReps(i, 1)" :aria-label="`Increase warm-up ${i + 1} reps`">+</button>
                  </div>
                </div>
              </div>
            </div>
            <p v-if="editWarmupSteps.length === 0" class="wtWarmupEditEmpty">
              No warm-up sets — this exercise won't suggest a ramp.
            </p>
            <button
              v-if="editWarmupSteps.length < MAX_WARMUP_STEPS"
              class="wtWarmupEditAdd"
              @click="addWarmupStep"
            >+ Add warm-up set</button>
          </div>
          <button
            v-if="!isDefaultWarmup"
            class="wtWarmupEditReset"
            @click="resetWarmupScheme"
          >Reset to default</button>
          <span class="iosSettingsFooter">Lighter primer sets that ramp up to your working weight, shown when you log this exercise.</span>
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
import type { WarmupSchemeStep } from '../lib/warmupGenerator'

/** Payload emitted on Save — the parent applies it to the store. */
export interface EditExerciseSave {
  name: string
  tags: string[]
  plateMode: boolean
  plateCountMode: PlateCountMode
  barWeight: number
  /** Custom warmup ramp; null = use the default ramp, [] = no warmup for this exercise. */
  warmupScheme: WarmupSchemeStep[] | null
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
  DEFAULT_WARMUP_SCHEME,
  MAX_WARMUP_STEPS,
  MIN_WARMUP_PCT,
  MAX_WARMUP_PCT,
  MIN_WARMUP_REPS,
  MAX_WARMUP_REPS,
  schemesEqual,
} from '../lib/warmupGenerator'

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

// ── Warmup ramp editor (LIFT-725) ───────────────────────────────
// Steps are edited in whole-percent space (the steppers move in 5% notches)
// and converted to fractions on save. pctInt 40 ↔ scheme pct 0.4.
const PCT_STEP = 5
const MIN_PCT_INT = Math.round(MIN_WARMUP_PCT * 100)
const MAX_PCT_INT = Math.round(MAX_WARMUP_PCT * 100)
const editWarmupSteps = ref<{ pctInt: number; reps: number }[]>([])

/** Build the {pct,reps} scheme the form currently represents. */
function currentWarmupScheme(): WarmupSchemeStep[] {
  return editWarmupSteps.value.map(s => ({ pct: s.pctInt / 100, reps: s.reps }))
}

/** True when the form matches the built-in default — used to hide "Reset". */
const isDefaultWarmup = computed(() => schemesEqual(currentWarmupScheme(), DEFAULT_WARMUP_SCHEME))

function adjustWarmupPct(i: number, delta: number) {
  const step = editWarmupSteps.value[i]
  if (!step) return
  step.pctInt = Math.min(MAX_PCT_INT, Math.max(MIN_PCT_INT, step.pctInt + delta))
}

function adjustWarmupReps(i: number, delta: number) {
  const step = editWarmupSteps.value[i]
  if (!step) return
  step.reps = Math.min(MAX_WARMUP_REPS, Math.max(MIN_WARMUP_REPS, step.reps + delta))
}

function removeWarmupStep(i: number) {
  editWarmupSteps.value.splice(i, 1)
}

function addWarmupStep() {
  if (editWarmupSteps.value.length >= MAX_WARMUP_STEPS) return
  const last = editWarmupSteps.value[editWarmupSteps.value.length - 1]
  // New step continues the ramp: a notch heavier than the last, same reps.
  const pctInt = last ? Math.min(MAX_PCT_INT, last.pctInt + 10) : 50
  editWarmupSteps.value.push({ pctInt, reps: last ? last.reps : 5 })
}

function resetWarmupScheme() {
  editWarmupSteps.value = DEFAULT_WARMUP_SCHEME.map(s => ({ pctInt: Math.round(s.pct * 100), reps: s.reps }))
}

const isArchived = computed(() => !!props.exercise?.archived_at)

const focusTrap = useFocusTrap()

watch(() => props.exercise, async (exercise) => {
  if (exercise) {
    editName.value = exercise.name
    editTags.value = [...(exercise.tags || [])]
    editPlateMode.value = exercise.inputMode === 'plates'
    editPlateCountMode.value = exercise.plateCountMode || 'per-side'
    editBarWeight.value = exercise.barWeight ?? (exercise.plateCountMode === 'total' ? 0 : 45)
    // undefined → seed with the default ramp; [] → seed empty (no warmup).
    const seed = exercise.warmupScheme ?? DEFAULT_WARMUP_SCHEME
    editWarmupSteps.value = seed.map(s => ({ pctInt: Math.round(s.pct * 100), reps: s.reps }))
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
  // Store nothing when the ramp matches the default (keeps the override clear);
  // otherwise persist the custom scheme ([] = explicitly no warmup).
  const scheme = currentWarmupScheme()
  emit('save', {
    name: editName.value,
    tags: [...editTags.value],
    plateMode: editPlateMode.value,
    plateCountMode: editPlateCountMode.value,
    barWeight: editBarWeight.value,
    warmupScheme: isDefaultWarmup.value ? null : scheme,
  })
}
</script>
