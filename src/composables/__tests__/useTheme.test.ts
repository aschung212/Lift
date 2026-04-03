import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// Mock matchMedia before importing useTheme (it runs at import time)
const listeners: Array<() => void> = []
vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn((_: string, cb: () => void) => listeners.push(cb)),
  removeEventListener: vi.fn(),
})))

// Must import after mocks are set up (module runs side effects at import)
const { useTheme, THEMES, THEME_PREVIEWS } = await import('../useTheme')

describe('useTheme', () => {
  let theme: ReturnType<typeof useTheme>

  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.setItem.mockClear()
    localStorageMock.getItem.mockClear()
    theme = useTheme()
  })

  describe('theme switching', () => {
    it('defaults to metal theme', () => {
      expect(theme.currentTheme.value).toBe('void')
    })

    it('switches theme when currentTheme is updated', async () => {
      theme.currentTheme.value = 'water'
      await nextTick()
      expect(theme.currentTheme.value).toBe('water')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('app-theme', 'water')
    })

    it('exposes all available themes', () => {
      expect(THEMES).toHaveLength(9)
      const ids = THEMES.map(t => t.id)
      expect(ids).toContain('fire')
      expect(ids).toContain('water')
      expect(ids).toContain('luck')
      expect(ids).toContain('air')
      expect(ids).toContain('void')
      expect(ids).toContain('amethyst')
      expect(ids).toContain('sun')
      expect(ids).toContain('moon')
      expect(ids).toContain('love')
    })

    it('provides theme previews with dark and light variants', () => {
      for (const id of Object.keys(THEME_PREVIEWS)) {
        expect(THEME_PREVIEWS[id]).toHaveProperty('dark')
        expect(THEME_PREVIEWS[id]).toHaveProperty('light')
        expect(THEME_PREVIEWS[id].dark).toHaveProperty('bg')
        expect(THEME_PREVIEWS[id].dark).toHaveProperty('accent')
      }
    })
  })

  describe('color mode toggling', () => {
    it('defaults to auto mode', () => {
      expect(theme.colorMode.value).toBe('auto')
    })

    it('switches to dark mode', () => {
      theme.colorMode.value = 'dark'
      expect(theme.colorMode.value).toBe('dark')
      expect(theme.resolvedMode.value).toBe('dark')
    })

    it('switches to light mode', () => {
      theme.colorMode.value = 'light'
      expect(theme.resolvedMode.value).toBe('light')
    })

    it('resolves auto mode based on system preference', () => {
      // matchMedia mock returns matches: false (light), so auto → light
      theme.colorMode.value = 'auto'
      expect(theme.resolvedMode.value).toBe('light')
    })
  })

  describe('glass toggle', () => {
    it('toggles glass morphism on and off', async () => {
      theme.glassEnabled.value = false
      await nextTick()
      expect(theme.glassEnabled.value).toBe(false)
      expect(localStorageMock.setItem).toHaveBeenCalledWith('app-glass', 'off')

      theme.glassEnabled.value = true
      await nextTick()
      expect(theme.glassEnabled.value).toBe(true)
      expect(localStorageMock.setItem).toHaveBeenCalledWith('app-glass', 'on')
    })
  })

  describe('weight unit conversion', () => {
    it('returns lbs values unchanged when unit is lbs', () => {
      theme.weightUnit.value = 'lbs'
      expect(theme.displayWeight(225)).toBe(225)
    })

    it('converts lbs to kg when unit is kg', () => {
      theme.weightUnit.value = 'kg'
      // 225 lbs * 0.453592 = 102.1
      expect(theme.displayWeight(225)).toBeCloseTo(102.1, 1)
    })

    it('converts kg input back to lbs with toLbs', () => {
      theme.weightUnit.value = 'kg'
      // 100 kg / 0.453592 ≈ 220.5
      expect(theme.toLbs(100)).toBeCloseTo(220.5, 0)
    })

    it('toLbs returns value unchanged when unit is lbs', () => {
      theme.weightUnit.value = 'lbs'
      expect(theme.toLbs(225)).toBe(225)
    })
  })

  describe('rest timer', () => {
    it('persists rest timer preference to localStorage', async () => {
      theme.restTimerEnabled.value = false
      await nextTick()
      expect(localStorageMock.setItem).toHaveBeenCalledWith('rest-timer', 'off')
      theme.restTimerEnabled.value = true
      await nextTick()
      expect(localStorageMock.setItem).toHaveBeenCalledWith('rest-timer', 'on')
    })
  })
})
