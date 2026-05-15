import { ref, computed, watch } from 'vue'
import { useRestTimer } from './useRestTimer'
import { useUndoToast } from './useUndoToast'
import { useNotification, useBackgroundTracker } from './useNotification'
import { usePreferencesStore } from '../stores/preferences'

// ── Module-level singleton state ──────────────────────────────────
// Shared across all consumers so RestTimerView, RestTimerBar, and
// WorkoutTracker all reference the same running timer.
let _initialized = false

const timerActive = ref(false)
const timerPaused = ref(false)
const timerSeconds = ref(0)
const timerAnnouncement = ref('')
const timerStopping = ref(false)
const restDuration = ref(90)

const editingPresets = ref(false)
const editTab = ref<'rest' | 'alerts'>('rest')
const newPresetValue = ref<number | null>(null)
const presetInputEl = ref<HTMLInputElement | null>(null)

const DEFAULT_WARNING_OPTIONS = [3, 5, 10, 15, 30]
const warningOptions = ref<number[]>([...DEFAULT_WARNING_OPTIONS])
const warningTimes = ref<number[]>([5])
const newWarningValue = ref<number | null>(null)

const DEFAULT_PRESETS = [30, 60, 90, 120, 180, 300]
const restPresets = ref<number[]>([...DEFAULT_PRESETS])
const disabledPresets = ref<number[]>([])

let timerIntervalId: ReturnType<typeof setInterval> | null = null
let timerEndTime = 0
let pausedRemaining = 0
let lastWarnedAt = -1
let audioCtx: AudioContext | null = null
let _onTimerComplete: (() => void) | null = null

// ── Persistence helpers ───────────────────────────────────────────

function loadWarningOptions(): number[] {
  try {
    const raw = localStorage.getItem('rest-warning-options')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.sort((a: number, b: number) => a - b)
    }
  } catch { /* ignore */ }
  return [...DEFAULT_WARNING_OPTIONS]
}

function saveWarningOptions() {
  localStorage.setItem('rest-warning-options', JSON.stringify(warningOptions.value))
}

function loadWarningTimes(): number[] {
  try {
    const raw = localStorage.getItem('rest-warnings')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch { /* ignore */ }
  return [5]
}

function loadPresets(): number[] {
  try {
    const raw = localStorage.getItem('rest-presets')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.sort((a: number, b: number) => a - b)
    }
  } catch { /* ignore */ }
  return [...DEFAULT_PRESETS]
}

function savePresets() {
  localStorage.setItem('rest-presets', JSON.stringify(restPresets.value))
}

function loadDisabledPresets(): number[] {
  try {
    const raw = localStorage.getItem('rest-presets-disabled')
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

function saveDisabledPresets() {
  localStorage.setItem('rest-presets-disabled', JSON.stringify(disabledPresets.value))
}

// ── Computed display values ───────────────────────────────────────

const timerDisplay = computed(() => {
  const m = Math.floor(timerSeconds.value / 60)
  const s = timerSeconds.value % 60
  return `${m}:${s.toString().padStart(2, '0')}`
})

const timerProgress = computed(() => {
  if (restDuration.value <= 0) return 0
  return timerSeconds.value / restDuration.value
})

const visiblePresets = computed(() =>
  restPresets.value.filter(s => !disabledPresets.value.includes(s))
)

const maxWarning = computed(() => warningTimes.value.length ? Math.max(...warningTimes.value) : 0)
const timerUrgent = computed(() => maxWarning.value > 0 && timerSeconds.value <= maxWarning.value && timerSeconds.value > 0)

// ── Audio ─────────────────────────────────────────────────────────

function ensureAudioCtx() {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
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

// ── Timer interval ────────────────────────────────────────────────

function formatTimerAnnouncement(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m > 0 && s > 0) return `${m} minute${m > 1 ? 's' : ''} ${s} second${s !== 1 ? 's' : ''}`
  if (m > 0) return `${m} minute${m > 1 ? 's' : ''}`
  return `${s} second${s !== 1 ? 's' : ''}`
}

function startInterval() {
  if (timerIntervalId !== null) clearInterval(timerIntervalId)
  lastWarnedAt = -1

  // Lazy-load preferences — can't access at module init time
  const prefs = usePreferencesStore()
  const { notify: sendNotification } = useNotification()
  const { wasBackgrounded, stopTracking: stopBgTracking } = useBackgroundTracker()

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
        stopBgTracking()
        if (!editingPresets.value) {
          _onTimerComplete?.()
        }
      }
    }
  }, 250)
}

// ── Timer controls ────────────────────────────────────────────────

function startTimer() {
  ensureAudioCtx()
  const prefs = usePreferencesStore()
  const { requestPermission: requestNotificationPermission } = useNotification()
  const { startTracking: startBgTracking } = useBackgroundTracker()
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
  setTimeout(() => { timerStopping.value = false }, 0)
}

function restartTimer() {
  ensureAudioCtx()
  timerSeconds.value = restDuration.value
  timerEndTime = Date.now() + restDuration.value * 1000
  timerPaused.value = false
  startInterval()
}

// ── Presets ───────────────────────────────────────────────────────

function togglePresetEnabled(val: number) {
  if (disabledPresets.value.includes(val)) {
    disabledPresets.value = disabledPresets.value.filter(v => v !== val)
  } else {
    if (visiblePresets.value.length <= 1) return
    disabledPresets.value = [...disabledPresets.value, val]
  }
  saveDisabledPresets()
}

function formatDuration(s: number): string {
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem ? `${m}:${rem.toString().padStart(2, '0')}` : `${m}m`
}

function setRestDuration(val: number) {
  ensureAudioCtx()
  restDuration.value = val
  localStorage.setItem('rest-duration', String(val))
  timerSeconds.value = val
  timerEndTime = Date.now() + val * 1000
  timerPaused.value = false
  startInterval()
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

function disableRestTimer(onDismiss: () => void, onRestore?: () => void) {
  const { setRestTimerEnabled } = useRestTimer()
  const { show: showUndo } = useUndoToast()
  const hadActiveTimer = timerActive.value
  const wasPaused = timerPaused.value
  const previousSeconds = timerSeconds.value
  const previousDuration = restDuration.value
  setRestTimerEnabled(false)
  stopTimer()
  onDismiss()
  showUndo('Rest timer disabled', () => {
    setRestTimerEnabled(true)
    if (hadActiveTimer) {
      timerSeconds.value = previousSeconds
      restDuration.value = previousDuration
      timerActive.value = true
      timerPaused.value = wasPaused
      onRestore?.()
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

function handleOverlayClick() {
  if (editingPresets.value) {
    editingPresets.value = false
  }
}

function setOnTimerComplete(fn: () => void) {
  _onTimerComplete = fn
}

function setEditingPresets(val: boolean) {
  editingPresets.value = val
}

function setEditTab(val: 'rest' | 'alerts') {
  editTab.value = val
}

function cleanup() {
  if (timerIntervalId !== null) clearInterval(timerIntervalId)
  timerIntervalId = null
}

// ── Initialization (idempotent) ───────────────────────────────────

function init() {
  if (_initialized) return
  _initialized = true
  restDuration.value = parseInt(localStorage.getItem('rest-duration') ?? '90') || 90
  warningOptions.value = loadWarningOptions()
  warningTimes.value = loadWarningTimes()
  restPresets.value = loadPresets()
  disabledPresets.value = loadDisabledPresets()
}

export function useRestTimerController() {
  init()

  const { restTimerEnabled, restTimerAutoStart } = useRestTimer()

  watch(editingPresets, (v) => {
    if (v) setTimeout(() => presetInputEl.value?.focus(), 0)
  })

  return {
    // State (reactive)
    timerActive,
    timerPaused,
    timerSeconds,
    timerAnnouncement,
    timerStopping,
    restDuration,
    editingPresets,
    editTab,
    newPresetValue,
    presetInputEl,
    restPresets,
    disabledPresets,
    visiblePresets,
    warningOptions,
    warningTimes,
    newWarningValue,

    // Computed
    timerDisplay,
    timerProgress,
    timerUrgent,

    // Settings
    restTimerEnabled,
    restTimerAutoStart,

    // Methods
    startTimer,
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
    handleOverlayClick,
    disableRestTimer,
    setOnTimerComplete,
    setEditingPresets,
    setEditTab,
    cleanup,
  }
}

export type RestTimerController = ReturnType<typeof useRestTimerController>

// ── Test helper: reset singleton state ────────────────────────────
export function _resetForTesting() {
  cleanup()
  _initialized = false
  timerActive.value = false
  timerPaused.value = false
  timerSeconds.value = 0
  timerAnnouncement.value = ''
  timerStopping.value = false
  restDuration.value = 90
  editingPresets.value = false
  editTab.value = 'rest'
  newPresetValue.value = null
  warningOptions.value = [...DEFAULT_WARNING_OPTIONS]
  warningTimes.value = [5]
  newWarningValue.value = null
  restPresets.value = [...DEFAULT_PRESETS]
  disabledPresets.value = []
  audioCtx = null
  _onTimerComplete = null
}
