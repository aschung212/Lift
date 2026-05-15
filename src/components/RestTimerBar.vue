<template>
  <button
    v-if="ctrl.restTimerEnabled.value && !showModal"
    class="wtRestBar"
    :class="{ wtRestBarActive: ctrl.timerActive.value && !showModal, wtRestBarUrgent: ctrl.timerUrgent.value && ctrl.timerActive.value && !showModal }"
    @click="onBarClick"
  >
    <template v-if="ctrl.timerActive.value">
      <div class="wtRestBarProgress" :style="{ width: (ctrl.timerProgress.value * 100) + '%' }"></div>
      <svg class="wtRestBarIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span class="wtRestBarTime">{{ ctrl.timerDisplay.value }}</span>
      <span class="wtRestBarLabel">remaining</span>
    </template>
    <template v-else>
      <svg class="wtRestBarIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span class="wtRestBarLabel">Start Rest Timer</span>
    </template>
  </button>
</template>

<script setup lang="ts">
import { useRestTimerController } from '../composables/useRestTimerController'

defineProps<{
  showModal: boolean
}>()

const emit = defineEmits<{
  (e: 'open-timer'): void
}>()

const ctrl = useRestTimerController()

function onBarClick() {
  emit('open-timer')
  if (!ctrl.timerActive.value) {
    ctrl.startTimer()
  }
}
</script>
