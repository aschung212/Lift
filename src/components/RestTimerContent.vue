<!-- eslint-disable vue/no-mutating-props -- ctrl is a controller object; its refs are designed to be mutated -->
<template>
  <div v-if="ctrl.timerUrgent.value && !ctrl.timerPaused.value && !ctrl.editingPresets.value" class="wtTimerFlash"></div>

  <template v-if="ctrl.editingPresets.value">
    <h2>Edit Times</h2>
    <button class="wtTimerEditCountdown" @click="ctrl.togglePause()" :aria-label="ctrl.timerPaused.value ? 'Resume timer' : 'Pause timer'">
      {{ ctrl.timerDisplay.value }}
      <svg v-if="!ctrl.timerPaused.value && ctrl.timerSeconds.value > 0" class="wtTimerPauseIcon" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
      <svg v-else-if="ctrl.timerPaused.value" class="wtTimerPauseIcon" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
    </button>
    <div class="wtTimerEditTabs">
      <button :class="['wtTimerEditTab', { wtTimerEditTabActive: ctrl.editTab.value === 'rest' }]" @click="ctrl.editTab.value = 'rest'">Rest Times</button>
      <button :class="['wtTimerEditTab', { wtTimerEditTabActive: ctrl.editTab.value === 'alerts' }]" @click="ctrl.editTab.value = 'alerts'">Alerts</button>
    </div>
    <div class="wtTimerEditListScroll">
      <template v-if="ctrl.editTab.value === 'rest'">
        <div v-for="s in ctrl.restPresets.value" :key="s" class="wtTimerEditRow wtTimerEditListItem">
          <span class="wtTimerEditItemLabel">{{ ctrl.formatDuration(s) }}</span>
          <button
            :class="['glassToggle', { on: !ctrl.disabledPresets.value.includes(s) }]"
            @click="ctrl.togglePresetEnabled(s)"
            role="switch"
            :aria-checked="!ctrl.disabledPresets.value.includes(s)"
            :aria-label="ctrl.disabledPresets.value.includes(s) ? 'Enable ' + s : 'Disable ' + s"
          ><span class="glassToggleThumb"></span></button>
          <button
            class="wtTimerEditDeleteBtn"
            :disabled="ctrl.restPresets.value.length <= 1"
            @click="ctrl.removePreset(s)"
            :aria-label="'Remove ' + ctrl.formatDuration(s) + ' preset'"
          >&times;</button>
        </div>
      </template>
      <template v-else>
        <div v-for="s in ctrl.warningOptions.value" :key="s" class="wtTimerEditRow wtTimerEditListItem">
          <span class="wtTimerEditItemLabel">{{ s }}s before</span>
          <button
            :class="['glassToggle', { on: ctrl.warningTimes.value.includes(s) }]"
            @click="ctrl.toggleWarningTime(s)"
            role="switch"
            :aria-checked="ctrl.warningTimes.value.includes(s)"
            :aria-label="ctrl.warningTimes.value.includes(s) ? 'Disable ' + s + 's alert' : 'Enable ' + s + 's alert'"
          ><span class="glassToggleThumb"></span></button>
          <button
            class="wtTimerEditDeleteBtn"
            :disabled="ctrl.warningOptions.value.length <= 1"
            @click="ctrl.removeWarningOption(s)"
            :aria-label="'Remove ' + s + 's warning'"
          >&times;</button>
        </div>
      </template>
    </div>
    <div v-if="ctrl.editTab.value === 'rest'" class="wtTimerEditRow" style="margin-top: var(--space-2)">
      <input class="wtTimerEditInput" type="number" inputmode="numeric" autocomplete="off" v-model.number="ctrl.newPresetValue.value" placeholder="Add seconds" min="5" max="600" @keyup.enter="ctrl.addPreset()" :ref="(el: any) => { ctrl.presetInputEl.value = el }" aria-label="Timer preset seconds" />
      <button class="wtTimerEditAddBtn" :disabled="!ctrl.newPresetValue.value" @click="ctrl.addPreset()">Add</button>
    </div>
    <div v-else class="wtTimerEditRow" style="margin-top: var(--space-2)">
      <input class="wtTimerEditInput" type="number" inputmode="numeric" autocomplete="off" v-model.number="ctrl.newWarningValue.value" placeholder="Add seconds" min="1" max="120" @keyup.enter="ctrl.addWarningOption()" aria-label="Warning alert seconds" />
      <button class="wtTimerEditAddBtn" :disabled="!ctrl.newWarningValue.value" @click="ctrl.addWarningOption()">Add</button>
    </div>
    <button class="wtTimerEditResetBtn" @click="ctrl.resetAllDefaults()">Reset to defaults</button>
    <button class="wtTimerEditResetBtn wtTimerDisableBtn" @click="onDisable">Disable Rest Timer</button>
    <div class="repMaxActions">
      <button class="repMaxBtn repMaxBtnCalc" @click="ctrl.editingPresets.value = false">Done</button>
    </div>
  </template>

  <template v-else>
    <p v-if="exerciseName" class="wtTimerExName">{{ exerciseName }}</p>

    <!-- Circular progress ring -->
    <div :class="['wtTimerRingWrap', { wtTimerRingUrgent: ctrl.timerUrgent.value }]">
      <svg class="wtTimerRing" viewBox="0 0 200 200" aria-hidden="true">
        <circle class="wtTimerRingBg" cx="100" cy="100" r="88" />
        <circle
          class="wtTimerRingFill"
          cx="100" cy="100" r="88"
          :stroke-dasharray="2 * Math.PI * 88"
          :stroke-dashoffset="2 * Math.PI * 88 * (1 - ctrl.timerProgress.value)"
        />
      </svg>
      <div class="wtTimerRingInner" aria-hidden="true">
        <span :class="['wtTimerTime', { wtTimerTimeDone: ctrl.timerSeconds.value === 0 }]">{{ ctrl.timerDisplay.value }}</span>
        <span class="wtTimerLabel">{{ ctrl.timerSeconds.value === 0 ? 'Done' : 'remaining' }}</span>
      </div>
      <span class="srOnly" aria-live="polite" aria-atomic="true">{{ ctrl.timerAnnouncement.value }}</span>
    </div>

    <!-- Play / Pause / Restart -->
    <div class="wtTimerControls">
      <button v-if="ctrl.timerSeconds.value === 0" class="wtTimerControlBtn" @click="ctrl.restartTimer()" aria-label="Restart">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="28" height="28"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
      </button>
      <button v-else-if="ctrl.timerPaused.value" class="wtTimerControlBtn" @click="ctrl.togglePause()" aria-label="Resume">
        <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
      <button v-else class="wtTimerControlBtn" @click="ctrl.togglePause()" aria-label="Pause">
        <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
      </button>
    </div>

    <!-- Duration presets -->
    <div class="wtTimerPresets">
      <button
        v-for="s in ctrl.visiblePresets.value"
        :key="s"
        :class="['wtTimerPreset', { wtTimerPresetActive: ctrl.restDuration.value === s }]"
        @click="ctrl.setRestDuration(s)"
      >{{ ctrl.formatDuration(s) }}</button>
    </div>

    <!-- Actions -->
    <div class="repMaxActions">
      <button v-if="exerciseName" class="repMaxBtn repMaxBtnCalc" @click="onSkipToNext">Log Next</button>
      <button class="repMaxBtn repMaxBtnClose" @click="emit('close')">Done</button>
    </div>
    <div class="wtTimerFooter">
      <button class="wtTimerFooterLink" @click="ctrl.editingPresets.value = true" aria-label="Timer settings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <button class="wtTimerFooterLink wtTimerStopLink" @click="onDismiss">Stop</button>
    </div>
  </template>
</template>

<script setup lang="ts">
import type { RestTimerController } from '../composables/useRestTimerController'

const props = defineProps<{
  exerciseName: string
  ctrl: RestTimerController
}>()

const emit = defineEmits<{
  (e: 'skip-to-next'): void
  (e: 'dismiss'): void
  (e: 'close'): void
  (e: 'restore'): void
}>()

function onSkipToNext() {
  props.ctrl.stopTimer()
  emit('skip-to-next')
}

function onDismiss() {
  props.ctrl.stopTimer()
  emit('dismiss')
}

function onDisable() {
  props.ctrl.disableRestTimer(() => {
    emit('dismiss')
  }, () => {
    emit('restore')
  })
}
</script>
