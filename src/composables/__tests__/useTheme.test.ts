import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// Mock matchMedia before importing useTheme (it runs at import time)
const listeners: Array<() => void> = []
vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn((_: string, cb: () => void) => listeners.push(cb)),
  removeEventListener: vi.fn(),
})))

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn() }
}))

// Must import after mocks are set up (module runs side effects at import)
const { useTheme, THEMES, THEME_PREVIEWS, connectProgressionStore } = await import('../useTheme')
const { useProgressionStore } = await import('../../stores/progression')

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
      expect(theme.currentTheme.value).toBe('eternal')
    })

    it('switches theme when currentTheme is updated', async () => {
      theme.currentTheme.value = 'water'
      await nextTick()
      expect(theme.currentTheme.value).toBe('water')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('app-theme', 'water')
    })

    it('exposes all available themes', () => {
      expect(THEMES).toHaveLength(10)
      const ids = THEMES.map(t => t.id)
      expect(ids).toContain('fire')
      expect(ids).toContain('water')
      expect(ids).toContain('luck')
      expect(ids).toContain('air')
      expect(ids).toContain('eternal')
      expect(ids).toContain('amethyst')
      expect(ids).toContain('pearl')
      expect(ids).toContain('midnight')
      expect(ids).toContain('love')
      expect(ids).toContain('earth')
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
    it('defaults to dark mode', () => {
      expect(theme.colorMode.value).toBe('dark')
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

  describe('theme lock/unlock', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
      connectProgressionStore(() => useProgressionStore())
    })

    it('only Pearl unlocked when progression is not enabled', () => {
      expect(theme.isThemeUnlocked('pearl')).toBe(true)
      expect(theme.isThemeUnlocked('fire')).toBe(false)
      expect(theme.isThemeUnlocked('eternal')).toBe(false)
    })

    it('choosing a starter activates progression with trial period', () => {
      const store = useProgressionStore()
      store.setStarterTheme('fire')
      expect(store.progressionEnabled).toBe(true)
      expect(theme.isThemeUnlocked('pearl')).toBe(true)
      // Trial period: all starters unlocked
      expect(theme.isThemeUnlocked('fire')).toBe(true)
      expect(theme.isThemeUnlocked('water')).toBe(true)
      expect(theme.isThemeUnlocked('luck')).toBe(true)
      // Non-starters still locked
      expect(theme.isThemeUnlocked('eternal')).toBe(false)
    })

    it('pearl is always unlocked when progression is enabled', () => {
      const store = useProgressionStore()
      store.progressionEnabled = true
      store.unlockedThemes = [{ id: 'pearl', unlockedAt: '2026-01-01' }]
      expect(theme.isThemeUnlocked('pearl')).toBe(true)
    })

    it('locked theme returns false when starter is confirmed', () => {
      const store = useProgressionStore()
      store.progressionEnabled = true
      store.starterConfirmed = true
      store.unlockedThemes = [{ id: 'pearl', unlockedAt: '2026-01-01' }, { id: 'fire', unlockedAt: '2026-01-01' }]
      expect(theme.isThemeUnlocked('fire')).toBe(true)
      expect(theme.isThemeUnlocked('water')).toBe(false) // no longer in trial
      expect(theme.isThemeUnlocked('eternal')).toBe(false)
    })

    it('previously unlocked themes stay available when progression is disabled', () => {
      const store = useProgressionStore()
      store.progressionEnabled = false
      store.unlockedThemes = [{ id: 'pearl', unlockedAt: '2026-01-01' }, { id: 'fire', unlockedAt: '2026-01-01' }]

      expect(theme.isThemeUnlocked('pearl')).toBe(true)
      expect(theme.isThemeUnlocked('fire')).toBe(true)
      expect(theme.isThemeUnlocked('eternal')).toBe(false)
    })

    it('selectTheme persists an unlocked theme', () => {
      const store = useProgressionStore()
      store.progressionEnabled = true
      store.unlockedThemes = [{ id: 'pearl', unlockedAt: '2026-01-01' }, { id: 'fire', unlockedAt: '2026-01-01' }]

      const result = theme.selectTheme('fire')
      expect(result).toBe(true)
      expect(theme.currentTheme.value).toBe('fire')
    })

    it('selectTheme rejects a locked theme', () => {
      const store = useProgressionStore()
      store.progressionEnabled = true
      store.unlockedThemes = [{ id: 'pearl', unlockedAt: '2026-01-01' }]

      const prev = theme.currentTheme.value
      const result = theme.selectTheme('eternal')
      expect(result).toBe(false)
      expect(theme.currentTheme.value).toBe(prev)
    })

    it('previewTheme applies CSS without persisting', async () => {
      theme.currentTheme.value = 'pearl'
      await nextTick()
      localStorageMock.setItem.mockClear()

      theme.previewTheme('fire')
      expect(document.documentElement.getAttribute('data-theme')).toBe('fire')
      // Should NOT have persisted 'fire' to localStorage after the preview
      const themeCalls = localStorageMock.setItem.mock.calls.filter(
        (c: unknown[]) => c[0] === 'app-theme'
      )
      expect(themeCalls.every((c: unknown[]) => c[1] !== 'fire')).toBe(true)
    })

    it('revertPreview restores the persisted theme', async () => {
      theme.currentTheme.value = 'pearl'
      await nextTick()

      theme.previewTheme('fire')
      expect(document.documentElement.getAttribute('data-theme')).toBe('fire')

      theme.revertPreview()
      expect(document.documentElement.getAttribute('data-theme')).toBe('pearl')
    })

    it('revertPreview is a no-op when not previewing', () => {
      theme.currentTheme.value = 'pearl'
      theme.revertPreview() // should not throw or change anything
      expect(theme.currentTheme.value).toBe('pearl')
    })
  })
})
