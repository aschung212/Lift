import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import { usePreferencesStore } from '../stores/preferences'
import { useNotification, useBackgroundTracker } from './useNotification'
import { useRestTimer } from './useRestTimer'
import { loadJSON } from '../lib/storage'
import {
  buildRestTimerActivityState,
  startRestTimerActivity,
  updateRestTimerActivity,
  endRestTimerActivity,
} from '../lib/restTimerActivity'

// ── Defaults ──────────────────────────────────────────────────────
const DEFAULT_PRESETS = [30, 60, 90, 120, 180, 300]
const DEFAULT_WARNING_OPTIONS = [3, 5, 10, 15, 30]

// ── localStorage helpers ──────────────────────────────────────────
function loadPresets(): number[] {
  const stored = loadJSON<number[]>('rest-presets', [], Array.isArray)
  return stored.length > 0 ? [...stored].sort((a, b) => a - b) : [...DEFAULT_PRESETS]
}

function loadDisabledPresets(): number[] {
  return loadJSON<number[]>('rest-presets-disabled', [], Array.isArray)
}

function loadWarningOptions(): number[] {
  const stored = loadJSON<number[]>('rest-warning-options', [], Array.isArray)
  return stored.length > 0 ? [...stored].sort((a, b) => a - b) : [...DEFAULT_WARNING_OPTIONS]
}

function loadWarningTimes(): number[] {
  return loadJSON<number[]>('rest-warnings', [5], Array.isArray)
}

// ── Audio ─────────────────────────────────────────────────────────
let audioCtx: AudioContext | null = null

function ensureAudioCtx() {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
  // Play a short quiet tick to unlock iOS audio on user gesture
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.connect(gain)
  gain.connect(audioCtx.destination)
  osc.frequency.value = 1
  gain.gain.setValueAtTime(0.001, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05)
  osc.start(audioCtx.currentTime)
  osc.stop(audioCtx.currentTime + 0.05)
}

function playWarningBeep(secondsLeft: number) {
  if (!audioCtx) return
  if (audioCtx.state === 'suspended') audioCtx.resume()
  try {
    const t = audioCtx.currentTime
    const freq = Math.min(1100, 500 + (30 - Math.min(secondsLeft, 30)) * 20)
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.frequency.setValueAtTime(freq, t)
    osc.frequency.linearRampToValueAtTime(freq + 120, t + 0.2)
    gain.gain.setValueAtTime(0.2, t)
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.25)
    osc.start(t)
    osc.stop(t + 0.25)
  } catch { /* audio not available */ }
}

function playGoBeep() {
  if (!audioCtx) return
  if (audioCtx.state === 'suspended') audioCtx.resume()
  try {
    const t = audioCtx.currentTime
    for (let i = 0; i < 2; i++) {
      const offset = i * 0.18
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.frequency.value = 1320
      gain.gain.setValueAtTime(0.35, t + offset)
      gain.gain.exponentialRampToValueAtTime(0.01, t + offset + 0.1)
      osc.start(t + offset)
      osc.stop(t + offset + 0.1)
    }
  } catch { /* audio not available */ }
}

function formatTimerAnnouncement(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m > 0 && s > 0) return `${m} minute${m > 1 ? 's' : ''} ${s} second${s !== 1 ? 's' : ''}`
  if (m > 0) return `${m} minute${m > 1 ? 's' : ''}`
  return `${s} second${s !== 1 ? 's' : ''}`
}

export function formatDuration(s: number): string {
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem ? `${m}:${rem.toString().padStart(2, '0')}` : `${m}m`
}

export interface RestTimerController {
  // Reactive state
  timerActive: Ref<boolean>
  timerPaused: Ref<boolean>
  timerSeconds: Ref<number>
  timerStopping: Ref<boolean>
  timerAnnouncement: Ref<string>
  timerDisplay: ComputedRef<string>
  timerProgress: ComputedRef<number>
  timerUrgent: ComputedRef<boolean>
  restDuration: Ref<number>
  editingPresets: Ref<boolean>
  editTab: Ref<'rest' | 'alerts'>
  newPresetValue: Ref<number | null>
  newWarningValue: Ref<number | null>
  restPresets: Ref<number[]>
  disabledPresets: Ref<number[]>
  visiblePresets: ComputedRef<number[]>
  warningOptions: Ref<number[]>
  warningTimes: Ref<number[]>
  presetInputEl: Ref<HTMLInputElement | null>

  // Methods
  startRestTimer: () => void
  stopTimer: () => void
  restartTimer: () => void
  togglePause: () => void
  setRestDuration: (val: number) => void
  addPreset: () => void
  removePreset: (val: number) => void
  togglePresetEnabled: (val: number) => void
  resetAllDefaults: () => void
  addWarningOption: () => void
  removeWarningOption: (val: number) => void
  toggleWarningTime: (val: number) => void
  formatDuration: (s: number) => string
  disableRestTimer: (onDisable: () => void, onRestore: () => void) => void
}

/**
 * Creates a rest timer controller with all timer state and logic.
 *
 * @param onComplete - Called when the timer reaches zero (e.g. to skip to next set)
 * @param showUndo - The undo toast function from the parent
 */
export function useRestTimerController(
  onComplete: () => void,
  showUndo: (msg: string, onUndo: () => void, onCommit: () => void) => void,
): RestTimerController {
  const prefs = usePreferencesStore()
  const { notify: sendNotification, requestPermission: requestNotificationPermission } = useNotification()
  const { wasBackgrounded, startTracking: startBgTracking, stopTracking: stopBgTracking } = useBackgroundTracker()
  const { setRestTimerEnabled } = useRestTimer()

  // ── Core timer state ──────────────────────────────────────────
  const timerActive = ref(false)
  const timerPaused = ref(false)
  const timerSeconds = ref(0)
  const timerStopping = ref(false)
  const timerAnnouncement = ref('')
  const restDuration = ref(parseInt(localStorage.getItem('rest-duration') ?? '90') || 90)

  let timerIntervalId: ReturnType<typeof setInterval> | null = null
  let timerEndTime = 0
  let pausedRemaining = 0
  let lastWarnedAt = -1

  // ── Presets ───────────────────────────────────────────────────
  const editingPresets = ref(false)
  const editTab = ref<'rest' | 'alerts'>('rest')
  const newPresetValue = ref<number | null>(null)
  const presetInputEl = ref<HTMLInputElement | null>(null)

  const restPresets = ref<number[]>(loadPresets())
  const disabledPresets = ref<number[]>(loadDisabledPresets())
  const visiblePresets = computed(() =>
    restPresets.value.filter(s => !disabledPresets.value.includes(s))
  )

  // ── Warnings ──────────────────────────────────────────────────
  const warningOptions = ref<number[]>(loadWarningOptions())
  const warningTimes = ref<number[]>(loadWarningTimes())
  const newWarningValue = ref<number | null>(null)

  // ── Computed ──────────────────────────────────────────────────
  const timerDisplay = computed(() => {
    const m = Math.floor(timerSeconds.value / 60)
    const s = timerSeconds.value % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  })

  const timerProgress = computed(() => {
    if (restDuration.value <= 0) return 0
    return timerSeconds.value / restDuration.value
  })

  const maxWarning = computed(() => warningTimes.value.length ? Math.max(...warningTimes.value) : 0)
  const timerUrgent = computed(() => maxWarning.value > 0 && timerSeconds.value <= maxWarning.value && timerSeconds.value > 0)

  // ── Watchers ──────────────────────────────────────────────────
  watch(editingPresets, (v) => {
    if (v) setTimeout(() => presetInputEl.value?.focus(), 0)
  })

  // ── Live Activity (iOS Lock Screen / Dynamic Island) ──────────
  // Mirrors the running timer to a native Live Activity. No-ops off native iOS.
  function currentActivityState() {
    const paused = timerPaused.value
    const remaining = paused ? pausedRemaining : timerSeconds.value
    return buildRestTimerActivityState({
      durationSeconds: restDuration.value,
      // While paused the OS shows the static remaining value, so the exact
      // endTime is moot — project it forward so it is still self-consistent.
      endTimeMs: paused ? Date.now() + remaining * 1000 : timerEndTime,
      remainingSeconds: remaining,
      paused,
    })
  }

  // ── Timer interval ────────────────────────────────────────────
  function startInterval() {
    if (timerIntervalId !== null) clearInterval(timerIntervalId)
    lastWarnedAt = -1
    timerIntervalId = setInterval(() => {
      if (!timerPaused.value) {
        const remaining = Math.ceil((timerEndTime - Date.now()) / 1000)
        const prev = timerSeconds.value
        timerSeconds.value = Math.max(remaining, 0)
        for (const w of warningTimes.value) {
          if (w < prev && w >= timerSeconds.value && w !== lastWarnedAt) {
            lastWarnedAt = w
            playWarningBeep(w)
            timerAnnouncement.value = `${formatTimerAnnouncement(w)} remaining`
          }
        }
        if (timerSeconds.value <= 0) {
          playGoBeep()
          if (timerIntervalId !== null) clearInterval(timerIntervalId)
          timerIntervalId = null
          timerSeconds.value = 0
          timerAnnouncement.value = 'Rest timer done'
          if (prefs.experience.restTimerNotification) {
            sendNotification('Rest Complete', {
              body: 'Time to get back to work 💪',
              wasBackgrounded: wasBackgrounded.value,
            })
          }
          endRestTimerActivity()
          stopBgTracking()
          if (!editingPresets.value) {
            onComplete()
          }
        }
      }
    }, 250)
  }

  // ── Timer controls ────────────────────────────────────────────
  function startRestTimer() {
    ensureAudioCtx()
    if (prefs.experience.restTimerNotification) {
      requestNotificationPermission()
      startBgTracking()
    }
    timerActive.value = true
    timerPaused.value = false
    timerSeconds.value = restDuration.value
    timerEndTime = Date.now() + restDuration.value * 1000
    timerAnnouncement.value = `Rest timer started, ${formatTimerAnnouncement(restDuration.value)}`
    startInterval()
    startRestTimerActivity(currentActivityState())
  }

  function togglePause() {
    ensureAudioCtx()
    if (!timerPaused.value) {
      pausedRemaining = Math.max(Math.ceil((timerEndTime - Date.now()) / 1000), 0)
      timerPaused.value = true
    } else {
      timerEndTime = Date.now() + pausedRemaining * 1000
      timerPaused.value = false
    }
    updateRestTimerActivity(currentActivityState())
  }

  function stopTimer() {
    timerStopping.value = true
    if (timerIntervalId !== null) clearInterval(timerIntervalId)
    timerIntervalId = null
    timerActive.value = false
    timerPaused.value = false
    timerSeconds.value = 0
    editingPresets.value = false
    newPresetValue.value = null
    endRestTimerActivity()
    setTimeout(() => { timerStopping.value = false }, 0)
  }

  function restartTimer() {
    ensureAudioCtx()
    timerSeconds.value = restDuration.value
    timerEndTime = Date.now() + restDuration.value * 1000
    timerPaused.value = false
    startInterval()
    updateRestTimerActivity(currentActivityState())
  }

  function setRestDuration(val: number) {
    ensureAudioCtx()
    restDuration.value = val
    localStorage.setItem('rest-duration', String(val))
    timerSeconds.value = val
    timerEndTime = Date.now() + val * 1000
    timerPaused.value = false
    startInterval()
    updateRestTimerActivity(currentActivityState())
  }

  // ── Preset management ─────────────────────────────────────────
  function savePresets() {
    localStorage.setItem('rest-presets', JSON.stringify(restPresets.value))
  }

  function saveDisabledPresets() {
    localStorage.setItem('rest-presets-disabled', JSON.stringify(disabledPresets.value))
  }

  function addPreset() {
    if (newPresetValue.value === null) return
    const val = newPresetValue.value
    if (val >= 5 && val <= 600 && !restPresets.value.includes(val)) {
      restPresets.value = [...restPresets.value, val].sort((a, b) => a - b)
      savePresets()
    }
    newPresetValue.value = null
  }

  function removePreset(val: number) {
    if (restPresets.value.length <= 1) return
    restPresets.value = restPresets.value.filter(v => v !== val)
    savePresets()
    if (restDuration.value === val) {
      setRestDuration(restPresets.value[0])
    }
  }

  function togglePresetEnabled(val: number) {
    if (disabledPresets.value.includes(val)) {
      disabledPresets.value = disabledPresets.value.filter(v => v !== val)
    } else {
      if (visiblePresets.value.length <= 1) return
      disabledPresets.value = [...disabledPresets.value, val]
    }
    saveDisabledPresets()
  }

  // ── Warning management ────────────────────────────────────────
  function saveWarningOptions() {
    localStorage.setItem('rest-warning-options', JSON.stringify(warningOptions.value))
  }

  function toggleWarningTime(val: number) {
    if (val === 0) {
      warningTimes.value = []
    } else if (warningTimes.value.includes(val)) {
      warningTimes.value = warningTimes.value.filter(v => v !== val)
    } else {
      warningTimes.value = [...warningTimes.value, val].sort((a, b) => a - b)
    }
    localStorage.setItem('rest-warnings', JSON.stringify(warningTimes.value))
  }

  function addWarningOption() {
    if (newWarningValue.value === null) return
    const val = newWarningValue.value
    if (val >= 1 && val <= 120 && !warningOptions.value.includes(val)) {
      warningOptions.value = [...warningOptions.value, val].sort((a, b) => a - b)
      saveWarningOptions()
    }
    newWarningValue.value = null
  }

  function removeWarningOption(val: number) {
    if (warningOptions.value.length <= 1) return
    warningOptions.value = warningOptions.value.filter(v => v !== val)
    warningTimes.value = warningTimes.value.filter(v => v !== val)
    saveWarningOptions()
    localStorage.setItem('rest-warnings', JSON.stringify(warningTimes.value))
  }

  function resetAllDefaults() {
    restPresets.value = [...DEFAULT_PRESETS]
    savePresets()
    warningOptions.value = [...DEFAULT_WARNING_OPTIONS]
    saveWarningOptions()
    warningTimes.value = [5]
    localStorage.setItem('rest-warnings', JSON.stringify(warningTimes.value))
  }

  // ── Disable (with undo) ───────────────────────────────────────
  function disableRestTimer(onDisable: () => void, onRestore: () => void) {
    const hadActiveTimer = timerActive.value
    const wasPaused = timerPaused.value
    const previousSeconds = timerSeconds.value
    const previousDuration = restDuration.value
    setRestTimerEnabled(false)
    onDisable()
    showUndo('Rest timer disabled', () => {
      setRestTimerEnabled(true)
      if (hadActiveTimer) {
        timerSeconds.value = previousSeconds
        restDuration.value = previousDuration
        timerActive.value = true
        timerPaused.value = wasPaused
        onRestore()
        if (previousSeconds > 0) {
          if (wasPaused) {
            pausedRemaining = previousSeconds
          } else {
            timerEndTime = Date.now() + previousSeconds * 1000
          }
          startInterval()
        }
      }
    }, () => { /* already disabled — no-op on commit */ })
  }

  return {
    timerActive,
    timerPaused,
    timerSeconds,
    timerStopping,
    timerAnnouncement,
    timerDisplay,
    timerProgress,
    timerUrgent,
    restDuration,
    editingPresets,
    editTab,
    newPresetValue,
    newWarningValue,
    restPresets,
    disabledPresets,
    visiblePresets,
    warningOptions,
    warningTimes,
    presetInputEl,
    startRestTimer,
    stopTimer,
    restartTimer,
    togglePause,
    setRestDuration,
    addPreset,
    removePreset,
    togglePresetEnabled,
    resetAllDefaults,
    addWarningOption,
    removeWarningOption,
    toggleWarningTime,
    formatDuration,
    disableRestTimer,
  }
}
