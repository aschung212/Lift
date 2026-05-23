import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import { loadThemeCSS, preloadThemeCSS } from '../lib/themeLoader'
import {
  THEMES, THEME_PREVIEWS, THEME_META_COLORS, THEME_MIGRATION,
  type ThemeId, type ColorMode, type ThemeOption,
} from '../lib/themes'
import { useWeightUnit } from './useWeightUnit'
import { useRestTimer } from './useRestTimer'

// Re-export types and constants so existing `import { … } from 'useTheme'` still works.
// New code should import from the specific module instead.
export { THEMES, THEME_PREVIEWS }
export type { ThemeId, ColorMode, ThemeOption }
export type { WeightUnit } from '../lib/themes'

/** Whether we're running in a browser (not SSR / Node test without JSDOM). */
const isBrowser = typeof document !== 'undefined'

/** Track whether we're in a preview (non-persisted) state */
let previewing = false

function applyTheme(id: string): void {
  if (!isBrowser) return
  document.documentElement.setAttribute('data-theme', id)
  loadThemeCSS(id)
  updateMetaColor()
  localStorage.setItem('app-theme', id)
}

/** Apply theme visually without persisting to localStorage. */
function applyPreview(id: string): void {
  if (!isBrowser) return
  document.documentElement.setAttribute('data-theme', id)
  loadThemeCSS(id)
  updateMetaColor()
}

function getSystemMode(): 'dark' | 'light' {
  if (!isBrowser) return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyResolvedMode(resolved: string): void {
  if (!isBrowser) return
  document.documentElement.setAttribute('data-mode', resolved)
  updateMetaColor()
}

function applyMode(preference: string): void {
  if (!isBrowser) return
  localStorage.setItem('app-mode', preference)
  applyResolvedMode(preference === 'auto' ? getSystemMode() : preference)
}

function updateMetaColor(): void {
  if (!isBrowser) return
  const meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) return
  const themeId = (document.documentElement.getAttribute('data-theme') || 'eternal') as ThemeId
  const mode = (document.documentElement.getAttribute('data-mode') || 'dark') as 'dark' | 'light'
  const colors = THEME_META_COLORS[themeId] ?? THEME_META_COLORS.fire
  meta.setAttribute('content', colors[mode] ?? colors.dark)
}

/** Module-level refs — initialized with defaults, hydrated by initTheme(). */
const currentTheme: Ref<string> = ref('eternal')
const colorMode: Ref<ColorMode> = ref('dark')
const resolvedMode: ComputedRef<'dark' | 'light'> = computed(() =>
  colorMode.value === 'auto' ? getSystemMode() : colorMode.value
)

/** Whether initTheme() has been called. Prevents double-init. */
let _initialized = false

/**
 * Initialize the theme system — reads persisted preferences from localStorage,
 * applies the theme and color mode to the DOM, and sets up watchers + listeners.
 *
 * Call once from main.ts before app.mount() to prevent FOUC. Safe to skip in
 * non-browser environments (SSR, unit tests without JSDOM).
 */
export function initTheme(): void {
  if (_initialized || !isBrowser) return
  _initialized = true

  // Read and migrate persisted theme
  let storedId = localStorage.getItem('app-theme') || 'eternal'
  if (storedId in THEME_MIGRATION) {
    storedId = THEME_MIGRATION[storedId]
    localStorage.setItem('app-theme', storedId)
  }
  const validId = THEMES.find(t => t.id === storedId)?.id ?? 'eternal'

  // Read persisted color mode
  const storedMode = localStorage.getItem('app-mode') || 'dark'
  const validMode: ColorMode = (['light', 'dark', 'auto'] as const).includes(storedMode as ColorMode) ? storedMode as ColorMode : 'auto'

  // Apply immediately to prevent flash
  applyTheme(validId)
  applyMode(validMode)

  // Glass is always on as of the 2026 iOS PWA refresh — the opt-out toggle was
  // removed after data showed no users disabling it. Set the attribute once so
  // any residual [data-glass="off"] rules still in third-party CSS resolve to
  // the glass-on state, and drop the legacy `app-glass` key from localStorage.
  document.documentElement.setAttribute('data-glass', 'on')
  try { localStorage.removeItem('app-glass') } catch { /* ignore */ }

  // Hydrate refs (triggers watchers only if value differs from default)
  currentTheme.value = validId
  colorMode.value = validMode

  // Persist future changes
  watch(currentTheme, applyTheme)
  watch(colorMode, applyMode)

  // Listen for OS theme changes when in auto mode
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  mql.addEventListener('change', () => {
    if (colorMode.value === 'auto') {
      applyResolvedMode(getSystemMode())
    }
  })
}

/**
 * Progression store accessor — set lazily after Pinia is initialized.
 * Uses a getter function so it always reads current Pinia state.
 */
let _getProgressionStore: (() => { progressionEnabled: boolean; starterConfirmed: boolean; unlockedThemes: { id: ThemeId }[] }) | null = null

/** Connect the progression store. Call once after Pinia is ready. */
export function connectProgressionStore(getter: () => { progressionEnabled: boolean; starterConfirmed: boolean; unlockedThemes: { id: ThemeId }[] }): void {
  _getProgressionStore = getter
}

/** Themes available without progression enabled */
const FREE_THEMES: ThemeId[] = ['pearl']

/** Starter themes available during trial period */
const STARTER_THEME_IDS: ThemeId[] = ['fire', 'water', 'luck']

/**
 * Check if a theme is unlocked.
 * Without progression: Pearl + any previously unlocked themes.
 * With progression (trial): Pearl + all starters.
 * With progression (confirmed): based on XP unlocks.
 */
function isThemeUnlocked(id: ThemeId): boolean {
  if (!_getProgressionStore) return FREE_THEMES.includes(id)

  const store = _getProgressionStore()

  if (!store.progressionEnabled) {
    return FREE_THEMES.includes(id) || store.unlockedThemes.some(t => t.id === id)
  }

  // Trial period: all starters unlocked until confirmed
  if (!store.starterConfirmed && STARTER_THEME_IDS.includes(id)) return true

  return store.unlockedThemes.some(t => t.id === id)
}

export function useTheme() {
  // Delegate to focused composables
  const { weightUnit, displayWeight, toLbs } = useWeightUnit()
  const { restTimerEnabled, restTimerAutoStart, setRestTimerEnabled } = useRestTimer()

  /**
   * Select a theme — persists only if unlocked.
   * Returns true if the theme was applied and persisted.
   */
  function selectTheme(id: ThemeId): boolean {
    if (!isThemeUnlocked(id)) return false
    currentTheme.value = id
    return true
  }

  /**
   * Preview a locked theme — applies visually but doesn't persist.
   * Call revertPreview() to restore the real theme.
   */
  function previewTheme(id: ThemeId): void {
    previewing = true
    applyPreview(id)
  }

  /** Revert to the persisted theme after previewing. */
  function revertPreview(): void {
    if (!previewing) return
    previewing = false
    applyPreview(currentTheme.value)
  }

  return {
    // Theme selection + color mode
    currentTheme, THEMES, THEME_PREVIEWS, colorMode, resolvedMode,
    selectTheme, previewTheme, revertPreview, isThemeUnlocked, preloadThemeCSS,
    // Re-exported from focused composables (backward compat)
    restTimerEnabled, restTimerAutoStart, setRestTimerEnabled,
    weightUnit, displayWeight, toLbs,
  }
}
