import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { loadJSON } from '../lib/storage'

// ── Defaults ──────────────────────────────────────────────────────
export const DEFAULT_PRESETS = [30, 60, 90, 120, 180, 300]

// ── localStorage helpers ──────────────────────────────────────────
function loadPresets(): number[] {
  const stored = loadJSON<number[]>('rest-presets', [], Array.isArray)
  return stored.length > 0 ? [...stored].sort((a, b) => a - b) : [...DEFAULT_PRESETS]
}

function loadDisabledPresets(): number[] {
  return loadJSON<number[]>('rest-presets-disabled', [], Array.isArray)
}

export interface RestTimerPresets {
  restPresets: Ref<number[]>
  disabledPresets: Ref<number[]>
  visiblePresets: ComputedRef<number[]>
  newPresetValue: Ref<number | null>
  presetInputEl: Ref<HTMLInputElement | null>
  addPreset: () => void
  /** Removes a preset. Returns the fallback preset to switch to when the
   *  removed value was the active duration, otherwise null. */
  removePreset: (val: number, currentDuration: number) => number | null
  togglePresetEnabled: (val: number) => void
  resetToDefaults: () => void
}

/**
 * Owns the rest-timer duration presets: the enabled/disabled preset sets,
 * their localStorage persistence, and add/remove/toggle CRUD. Extracted from
 * useRestTimerController (LIFT-879) so preset management can be reasoned about
 * and tested in isolation from the countdown loop and audio.
 */
export function useRestTimerPresets(): RestTimerPresets {
  const restPresets = ref<number[]>(loadPresets())
  const disabledPresets = ref<number[]>(loadDisabledPresets())
  const newPresetValue = ref<number | null>(null)
  const presetInputEl = ref<HTMLInputElement | null>(null)

  const visiblePresets = computed(() =>
    restPresets.value.filter(s => !disabledPresets.value.includes(s))
  )

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

  function removePreset(val: number, currentDuration: number): number | null {
    if (restPresets.value.length <= 1) return null
    restPresets.value = restPresets.value.filter(v => v !== val)
    savePresets()
    return currentDuration === val ? restPresets.value[0] : null
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

  function resetToDefaults() {
    restPresets.value = [...DEFAULT_PRESETS]
    savePresets()
  }

  return {
    restPresets,
    disabledPresets,
    visiblePresets,
    newPresetValue,
    presetInputEl,
    addPreset,
    removePreset,
    togglePresetEnabled,
    resetToDefaults,
  }
}
