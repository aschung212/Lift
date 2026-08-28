<template>
  <Teleport to="body">
    <div v-if="open" class="repMaxOverlay" @click.self="emit('close')" @keydown.escape="emit('close')">
      <div class="repMaxModal" role="dialog" aria-modal="true" aria-labelledby="timeline-picker-title">
        <h2 id="timeline-picker-title">Choose Exercise</h2>
        <div class="wtExPickerList">
          <button
            v-for="ex in exercises"
            :key="ex.id"
            class="wtExPickerRow"
            @click="emit('select', ex.id)"
          >
            <span class="wtExPickerName">{{ ex.name }}</span>
            <span class="wtChevron">›</span>
          </button>
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
import type { Exercise } from '../stores/workout'

defineProps<{
  open: boolean
  /** Active (non-archived) exercises offered for quick-logging. */
  exercises: Exercise[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', exerciseId: string): void
  (e: 'create-new'): void
}>()
</script>
