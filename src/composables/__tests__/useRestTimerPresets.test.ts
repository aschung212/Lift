import { describe, it, expect, beforeEach } from 'vitest'
import { getLocalStorageMock } from '../../__tests__/helpers'
import { useRestTimerPresets, DEFAULT_PRESETS } from '../useRestTimerPresets'

const localStorageMock = getLocalStorageMock()

describe('useRestTimerPresets', () => {
  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.setItem.mockClear()
  })

  it('defaults to the built-in preset ladder when storage is empty', () => {
    const p = useRestTimerPresets()
    expect(p.restPresets.value).toEqual(DEFAULT_PRESETS)
    expect(p.disabledPresets.value).toEqual([])
    expect(p.visiblePresets.value).toEqual(DEFAULT_PRESETS)
  })

  it('loads and sorts stored presets', () => {
    localStorage.setItem('rest-presets', JSON.stringify([120, 30, 60]))
    const p = useRestTimerPresets()
    expect(p.restPresets.value).toEqual([30, 60, 120])
  })

  it('adds a valid preset and persists it, then clears the input', () => {
    const p = useRestTimerPresets()
    p.newPresetValue.value = 45
    p.addPreset()
    expect(p.restPresets.value).toContain(45)
    expect(p.restPresets.value).toEqual([...p.restPresets.value].sort((a, b) => a - b))
    expect(p.newPresetValue.value).toBeNull()
    expect(localStorageMock.setItem).toHaveBeenCalledWith('rest-presets', JSON.stringify(p.restPresets.value))
  })

  it('rejects out-of-range or duplicate presets', () => {
    const p = useRestTimerPresets()
    const before = [...p.restPresets.value]
    p.newPresetValue.value = 4 // below min
    p.addPreset()
    p.newPresetValue.value = 601 // above max
    p.addPreset()
    p.newPresetValue.value = before[0] // duplicate
    p.addPreset()
    expect(p.restPresets.value).toEqual(before)
  })

  it('removes a preset and returns null when it was not the active duration', () => {
    const p = useRestTimerPresets()
    const target = p.restPresets.value[1]
    const fallback = p.removePreset(target, /* currentDuration */ p.restPresets.value[0])
    expect(p.restPresets.value).not.toContain(target)
    expect(fallback).toBeNull()
  })

  it('returns the first remaining preset as fallback when the active one is removed', () => {
    const p = useRestTimerPresets()
    const active = p.restPresets.value[2]
    const fallback = p.removePreset(active, active)
    expect(fallback).toBe(p.restPresets.value[0])
    expect(fallback).not.toBe(active)
  })

  it('refuses to remove the last preset', () => {
    const p = useRestTimerPresets()
    p.restPresets.value = [90]
    const fallback = p.removePreset(90, 90)
    expect(p.restPresets.value).toEqual([90])
    expect(fallback).toBeNull()
  })

  it('toggles a preset disabled and back, persisting each time', () => {
    const p = useRestTimerPresets()
    const val = p.restPresets.value[0]
    p.togglePresetEnabled(val)
    expect(p.disabledPresets.value).toContain(val)
    expect(p.visiblePresets.value).not.toContain(val)
    p.togglePresetEnabled(val)
    expect(p.disabledPresets.value).not.toContain(val)
  })

  it('refuses to disable the last visible preset', () => {
    const p = useRestTimerPresets()
    p.restPresets.value = [60, 90]
    p.togglePresetEnabled(60)
    p.togglePresetEnabled(90) // would leave zero visible
    expect(p.visiblePresets.value.length).toBe(1)
  })

  it('resets to the default ladder', () => {
    const p = useRestTimerPresets()
    p.restPresets.value = [15]
    p.resetToDefaults()
    expect(p.restPresets.value).toEqual(DEFAULT_PRESETS)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('rest-presets', JSON.stringify(DEFAULT_PRESETS))
  })
})
