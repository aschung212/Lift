<template>
  <Teleport to="body">
    <div v-if="open" class="repMaxOverlay" @click.self="emit('close')" @keydown.escape="emit('close')">
      <div class="repMaxModal" role="dialog" aria-modal="true" aria-labelledby="gym-manager-title">
        <h2 id="gym-manager-title">Manage Gyms</h2>
        <p v-if="gyms.length === 0 && !gymAdding" class="wtEmpty" style="margin: var(--space-4) 0">No gyms yet. Tap + to create one and filter exercises by where you train.</p>
        <ul class="wtTagManagerList">
          <li v-for="gym in gyms" :key="gym" class="wtTagManagerItemWrap">
            <div class="wtTagManagerItem">
              <template v-if="renamingGym === gym">
                <input
                  v-model.trim="renameGymValue"
                  type="text"
                  autocomplete="off"
                  :maxlength="GYM_NAME_MAX_LENGTH"
                  class="repMaxInput wtTagManagerInput"
                  aria-label="Rename gym"
                  @keyup.enter="confirmRenameGym"
                  @keyup.escape="renamingGym = null"
                  ref="renameGymInputEl"
                />
                <button class="wtTagManagerSaveBtn" @click="confirmRenameGym" :disabled="!renameGymValue" aria-label="Save gym name">✓</button>
                <button class="wtTagManagerCancelBtn" @click="renamingGym = null" aria-label="Cancel rename">✕</button>
              </template>
              <template v-else>
                <button class="wtTagManagerExpandBtn" @click="toggleGymExpand(gym)" :aria-expanded="expandedGym === gym" :aria-label="'Show exercises for ' + gym">
                  <span class="wtTagManagerExpandIcon" :class="{ expanded: expandedGym === gym }">›</span>
                </button>
                <span class="wtTagManagerLabel" @click="toggleGymExpand(gym)" role="button" tabindex="0" @keydown.enter="toggleGymExpand(gym)" @keydown.space.prevent="toggleGymExpand(gym)">{{ gym }}</span>
                <span class="wtTagManagerCount">{{ gymExerciseCount(gym) }}</span>
                <button class="wtTagManagerEditBtn" @click="startRenameGym(gym)" aria-label="Rename gym">✎</button>
                <button class="wtTagManagerDeleteBtn" @click="emit('delete-gym', gym)" aria-label="Delete gym">✕</button>
              </template>
            </div>
            <ul v-if="expandedGym === gym" class="wtTagExerciseList">
              <li v-for="exercise in exercises" :key="exercise.id">
                <button class="wtTagExerciseRow" @click="emit('toggle-exercise-gym', exercise.id, gym)">
                  <span class="wtTagExerciseRowName">{{ exercise.name }}</span>
                  <svg v-if="(exercise.gyms || []).includes(gym)" class="wtTagExerciseCheck" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
              </li>
            </ul>
          </li>
        </ul>
        <div v-if="gymAdding" class="wtTagManagerAddRow">
          <input
            v-model.trim="gymNewName"
            type="text"
            autocomplete="off"
            placeholder="Gym name"
            :maxlength="GYM_NAME_MAX_LENGTH"
            class="repMaxInput"
            aria-label="New gym name"
            ref="gymAddInputEl"
            @keyup.enter="confirmGymAdd"
            @keyup.escape="cancelGymAdd"
          />
          <button class="wtTagAddBtn" @mousedown.prevent @click="confirmGymAdd" :disabled="!gymNewName" aria-label="Create gym">✓</button>
        </div>
        <span class="iosSettingsFooter">Exercises with no gym assigned show at every gym.</span>
        <div class="repMaxActions">
          <button v-if="!gymAdding" class="repMaxBtn repMaxBtnCalc" :disabled="gyms.length >= MAX_GYMS" @click="startGymAdd">+ New Gym</button>
          <button class="repMaxBtn repMaxBtnClose" @click="emit('close')">Done</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { Exercise } from '../stores/workout'
import { useFocusTrap } from '../composables/useFocusTrap'
import { MAX_GYMS, GYM_NAME_MAX_LENGTH } from '../lib/gyms'

const props = defineProps<{
  open: boolean
  /** The synced gym list (preferences store). */
  gyms: string[]
  /**
   * All exercises (including archived) — drives per-gym counts and the
   * membership checklist. Hosts must bind a FRESH-IDENTITY array (e.g.
   * `computed(() => [...store.exercises])`): the workout store mutates
   * exercises in place behind a shallowRef, and a stable array identity lets
   * Vue skip this modal's re-render on membership toggles (#963).
   */
  exercises: Exercise[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'create-gym', name: string): void
  (e: 'rename-gym', oldName: string, newName: string): void
  (e: 'delete-gym', name: string): void
  (e: 'toggle-exercise-gym', exerciseId: string, gym: string): void
}>()

const renamingGym = ref<string | null>(null)
const renameGymValue = ref('')
const renameGymInputEl = ref<HTMLInputElement[] | null>(null)
const expandedGym = ref<string | null>(null)
const gymAdding = ref(false)
const gymNewName = ref('')
const gymAddInputEl = ref<HTMLInputElement | null>(null)

const focusTrap = useFocusTrap()

// Reset transient UI state on every open, then trap focus in the dialog.
watch(() => props.open, async (open) => {
  if (open) {
    renamingGym.value = null
    expandedGym.value = null
    gymAdding.value = false
    gymNewName.value = ''
    await nextTick()
    const el = document.querySelector<HTMLElement>('[aria-labelledby="gym-manager-title"]')
    if (el) focusTrap.activate(el)
  } else {
    focusTrap.deactivate()
  }
})

function startGymAdd() {
  gymAdding.value = true
  nextTick(() => gymAddInputEl.value?.focus())
}

function confirmGymAdd() {
  const gym = gymNewName.value.trim()
  if (gym && !props.gyms.includes(gym)) {
    emit('create-gym', gym)
    // Expand the new gym so bulk assignment is the immediate next step.
    expandedGym.value = gym
  }
  gymNewName.value = ''
  gymAdding.value = false
}

function cancelGymAdd() {
  gymNewName.value = ''
  gymAdding.value = false
}

function toggleGymExpand(gym: string) {
  expandedGym.value = expandedGym.value === gym ? null : gym
}

/** Explicit members only — "unassigned shows everywhere" is deliberately not counted. */
function gymExerciseCount(gym: string): number {
  return props.exercises.filter(e => (e.gyms || []).includes(gym)).length
}

function startRenameGym(gym: string) {
  renamingGym.value = gym
  renameGymValue.value = gym
  nextTick(() => {
    if (renameGymInputEl.value && renameGymInputEl.value.length > 0) {
      renameGymInputEl.value[0].focus()
      renameGymInputEl.value[0].select()
    }
  })
}

function confirmRenameGym() {
  if (!renamingGym.value || !renameGymValue.value) return
  emit('rename-gym', renamingGym.value, renameGymValue.value)
  renamingGym.value = null
}
</script>
