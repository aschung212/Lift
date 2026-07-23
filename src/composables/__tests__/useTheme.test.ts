import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// Mock matchMedia — no longer required before import (side effects are deferred
// to initTheme()), but still needed when initTheme() is called in tests.
const listeners: Array<() => void> = []
vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn((_: string, cb: () => void) => listeners.push(cb)),
  removeEventListener: vi.fn(),
})))

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn() }
}))

// Module no longer runs side effects at import — safe to import directly.
import { useTheme, initTheme, THEMES, THEME_PREVIEWS, connectProgressionStore } from '../useTheme'
import { useProgressionStore } from '../../stores/progression'

describe('useTheme', () => {
  let theme: ReturnType<typeof useTheme>

  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.setItem.mockClear()
    localStorageMock.getItem.mockClear()
    // The progression store (connected via connectProgressionStore) reads from
    // Pinia, so a Pinia instance must be active before useTheme() is called.
    setActivePinia(createPinia())
    // initTheme() is guarded against double-init in production, but tests need
    // fresh state. We call it here so watchers and DOM attributes are set up.
    // The guard is tested separately below.
    initTheme()
    theme = useTheme()
  })

  describe('theme switching', () => {
    it('defaults to eternal theme', () => {
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

  describe('glass (always on as of 2026 refresh)', () => {
    it('forces data-glass="on" on initTheme() and does not expose a toggle', () => {
      // Assert the durable, order-independent contract rather than a mock
      // call count: initTheme() drops the legacy `app-glass` key and forces
      // glass on. (The removeItem call fires once per module because initTheme
      // is double-init-guarded, so asserting the call count leaked across
      // tests — the isolation-safe check is the resulting DOM + storage state.)
      expect(document.documentElement.getAttribute('data-glass')).toBe('on')
      expect(localStorageMock.getItem('app-glass')).toBeNull()
      // The composable should no longer expose glassEnabled.
      expect((theme as unknown as Record<string, unknown>).glassEnabled).toBeUndefined()
    })
  })

  // Weight-unit conversion and rest-timer persistence are no longer reachable
  // through useTheme (LIFT-881 removed the re-exports); they are covered by
  // useWeightUnit.test.ts and useRestTimer.test.ts respectively.
  describe('does not re-export focused composables (LIFT-881)', () => {
    it('no longer exposes weight-unit or rest-timer state', () => {
      const surface = theme as unknown as Record<string, unknown>
      expect(surface.weightUnit).toBeUndefined()
      expect(surface.displayWeight).toBeUndefined()
      expect(surface.toLbs).toBeUndefined()
      expect(surface.restTimerEnabled).toBeUndefined()
      expect(surface.restTimerAutoStart).toBeUndefined()
      expect(surface.setRestTimerEnabled).toBeUndefined()
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
