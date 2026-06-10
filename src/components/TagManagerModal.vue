<template>
  <Teleport to="body">
    <div v-if="open" class="repMaxOverlay" @click.self="emit('close')" @keydown.escape="emit('close')">
      <div class="repMaxModal" role="dialog" aria-modal="true" aria-labelledby="tag-manager-title">
        <h2 id="tag-manager-title">Manage Tags</h2>
        <p v-if="allTags.length === 0 && !tagManagerAdding" class="wtEmpty" style="margin: var(--space-4) 0">No tags yet. Tap + to create one.</p>
        <ul class="wtTagManagerList">
          <li v-for="tag in allTags" :key="tag" class="wtTagManagerItemWrap">
            <div class="wtTagManagerItem">
              <template v-if="renamingTag === tag">
                <input
                  v-model.trim="renameTagValue"
                  type="text"
                  autocomplete="off"
                  maxlength="30"
                  class="repMaxInput wtTagManagerInput"
                  aria-label="Rename tag"
                  @keyup.enter="confirmRenameTag"
                  @keyup.escape="renamingTag = null"
                  ref="renameTagInputEl"
                />
                <button class="wtTagManagerSaveBtn" @click="confirmRenameTag" :disabled="!renameTagValue" aria-label="Save tag name">✓</button>
                <button class="wtTagManagerCancelBtn" @click="renamingTag = null" aria-label="Cancel rename">✕</button>
              </template>
              <template v-else>
                <button class="wtTagManagerExpandBtn" @click="toggleTagExpand(tag)" :aria-expanded="expandedTag === tag" :aria-label="'Show exercises for ' + tag">
                  <span class="wtTagManagerExpandIcon" :class="{ expanded: expandedTag === tag }">›</span>
                </button>
                <span class="wtTagManagerLabel" @click="toggleTagExpand(tag)" role="button" tabindex="0" @keydown.enter="toggleTagExpand(tag)" @keydown.space.prevent="toggleTagExpand(tag)">{{ tag }}</span>
                <span class="wtTagManagerCount">{{ tagExerciseCount(tag) }}</span>
                <button class="wtTagManagerEditBtn" @click="startRenameTag(tag)" aria-label="Rename tag">✎</button>
                <button class="wtTagManagerDeleteBtn" @click="emit('delete-tag', tag)" aria-label="Delete tag">✕</button>
              </template>
            </div>
            <ul v-if="expandedTag === tag" class="wtTagExerciseList">
                <li v-for="exercise in exercises" :key="exercise.id">
                  <button class="wtTagExerciseRow" @click="emit('toggle-exercise-tag', exercise.id, tag)">
                    <span class="wtTagExerciseRowName">{{ exercise.name }}</span>
                    <svg v-if="exercise.tags.includes(tag)" class="wtTagExerciseCheck" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="20 6 9 17 4 12"/></svg>
                  </button>
                </li>
              </ul>
          </li>
        </ul>
        <div v-if="tagManagerAdding" class="wtTagManagerAddRow">
          <input
            v-model.trim="tagManagerNewName"
            type="text"
            autocomplete="off"
            placeholder="Tag name"
            maxlength="30"
            class="repMaxInput"
            aria-label="New tag name"
            ref="tagManagerInputEl"
            @keyup.enter="confirmTagManagerAdd"
            @keyup.escape="cancelTagManagerAdd"
          />
          <button class="wtTagAddBtn" @mousedown.prevent @click="confirmTagManagerAdd" :disabled="!tagManagerNewName" aria-label="Create tag">✓</button>
        </div>
        <div class="repMaxActions">
          <button v-if="!tagManagerAdding" class="repMaxBtn repMaxBtnCalc" @click="startTagManagerAdd">+ New Tag</button>
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

const props = defineProps<{
  open: boolean
  allTags: string[]
  /** All exercises (including archived) — drives per-tag counts and the membership list. */
  exercises: Exercise[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'create-tag', name: string): void
  (e: 'rename-tag', oldName: string, newName: string): void
  (e: 'delete-tag', name: string): void
  (e: 'toggle-exercise-tag', exerciseId: string, tag: string): void
}>()

const renamingTag = ref<string | null>(null)
const renameTagValue = ref('')
const renameTagInputEl = ref<HTMLInputElement[] | null>(null)
const expandedTag = ref<string | null>(null)
const tagManagerAdding = ref(false)
const tagManagerNewName = ref('')
const tagManagerInputEl = ref<HTMLInputElement | null>(null)

const focusTrap = useFocusTrap()

// Reset transient UI state on every open, then trap focus in the dialog.
watch(() => props.open, async (open) => {
  if (open) {
    renamingTag.value = null
    expandedTag.value = null
    tagManagerAdding.value = false
    tagManagerNewName.value = ''
    await nextTick()
    const el = document.querySelector<HTMLElement>('[aria-labelledby="tag-manager-title"]')
    if (el) focusTrap.activate(el)
  } else {
    focusTrap.deactivate()
  }
})

function startTagManagerAdd() {
  tagManagerAdding.value = true
  nextTick(() => tagManagerInputEl.value?.focus())
}

function confirmTagManagerAdd() {
  const tag = tagManagerNewName.value.trim()
  if (tag && !props.allTags.includes(tag)) {
    emit('create-tag', tag)
    expandedTag.value = tag
  }
  tagManagerNewName.value = ''
  tagManagerAdding.value = false
}

function cancelTagManagerAdd() {
  tagManagerNewName.value = ''
  tagManagerAdding.value = false
}

function toggleTagExpand(tag: string) {
  expandedTag.value = expandedTag.value === tag ? null : tag
}

function tagExerciseCount(tag: string): number {
  return props.exercises.filter(e => (e.tags || []).includes(tag)).length
}

function startRenameTag(tag: string) {
  renamingTag.value = tag
  renameTagValue.value = tag
  nextTick(() => {
    if (renameTagInputEl.value && renameTagInputEl.value.length > 0) {
      renameTagInputEl.value[0].focus()
      renameTagInputEl.value[0].select()
    }
  })
}

function confirmRenameTag() {
  if (!renamingTag.value || !renameTagValue.value) return
  emit('rename-tag', renamingTag.value, renameTagValue.value)
  renamingTag.value = null
}
</script>
