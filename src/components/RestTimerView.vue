<template>
  <Teleport to="body">
    <div
      class="repMaxOverlay logSetOverlay"
      @click.self="onOverlayClick"
      @keydown.escape="onClose"
    >
      <div
        ref="sheetEl"
        class="repMaxModal logSetSheet"
        :style="swipe.dragStyle()"
        @click.self="ctrl.handleOverlayClick()"
        role="dialog"
        aria-modal="true"
        aria-label="Rest timer"
      >
        <div ref="handleEl" class="logSetSheetHandle" aria-hidden="true"></div>

        <RestTimerContent
          :exercise-name="exerciseName"
          :ctrl="ctrl"
          @skip-to-next="onSkipToNext"
          @dismiss="onDismiss"
          @close="onClose"
          @restore="emit('restore')"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue'
import { useRestTimerController } from '../composables/useRestTimerController'
import { useFocusTrap } from '../composables/useFocusTrap'
import { useSwipeToDismiss } from '../composables/useSwipeToDismiss'
import RestTimerContent from './RestTimerContent.vue'

defineProps<{
  exerciseName: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'skip-to-next'): void
  (e: 'dismiss'): void
  (e: 'restore'): void
}>()

const ctrl = useRestTimerController()
const focusTrap = useFocusTrap()

const sheetEl = ref<HTMLElement | null>(null)
const handleEl = ref<HTMLElement | null>(null)

const swipe = useSwipeToDismiss({
  threshold: 100,
  onDismiss: () => onClose(),
})

// Activate focus trap and swipe gesture on mount
watch(sheetEl, async (el) => {
  if (el) {
    await nextTick()
    focusTrap.activate(el)
    if (sheetEl.value && handleEl.value) {
      swipe.attach(sheetEl.value, handleEl.value)
    }
  }
}, { immediate: true })

onUnmounted(() => {
  focusTrap.deactivate()
  swipe.detach()
})

function onOverlayClick() {
  if (ctrl.editingPresets.value) {
    ctrl.editingPresets.value = false
  } else {
    onClose()
  }
}

function onClose() {
  emit('close')
}

function onSkipToNext() {
  ctrl.stopTimer()
  emit('skip-to-next')
}

function onDismiss() {
  ctrl.stopTimer()
  emit('dismiss')
}
</script>
