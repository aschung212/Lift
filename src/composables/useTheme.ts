import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'

export type ThemeId = 'midnight' | 'graphite' | 'arctic' | 'forge' | 'aaron' | 'tina'
export type ColorMode = 'light' | 'dark' | 'auto'
export type WeightUnit = 'lbs' | 'kg'

export interface ThemeOption {
  id: ThemeId
  label: string
  dot: string
}

interface ThemePreviewColors {
  bg: string
  card: string
  accent: string
  text: string
}

export const THEMES: ThemeOption[] = [
  { id: 'midnight', label: 'Midnight', dot: '#ff6363' },
  { id: 'graphite', label: 'Graphite', dot: '#8b5cf6' },
  { id: 'arctic',   label: 'Arctic',   dot: '#0066ff' },
  { id: 'forge',    label: 'Forge',    dot: '#f59e0b' },
  { id: 'aaron',    label: 'Aaron',    dot: '#c9a84c' },
  { id: 'tina',     label: 'Tina',     dot: '#ec4899' },
]

export const THEME_PREVIEWS: Record<ThemeId, { dark: ThemePreviewColors; light: ThemePreviewColors }> = {
  midnight: { dark: { bg: '#0f0f0f', card: '#1a1a1a', accent: '#ff6363', text: '#f2f2f2' }, light: { bg: '#f2eded', card: '#ffffff', accent: '#dc3545', text: '#1a1212' } },
  graphite: { dark: { bg: '#111118', card: '#1c1c28', accent: '#8b5cf6', text: '#e4e4f4' }, light: { bg: '#ededf5', card: '#ffffff', accent: '#7c3aed', text: '#18182a' } },
  arctic:   { dark: { bg: '#0e1420', card: '#182030', accent: '#3388ff', text: '#e0e8f8' }, light: { bg: '#dde4f5', card: '#ffffff', accent: '#0066ff', text: '#1a1a2e' } },
  forge:    { dark: { bg: '#100e0b', card: '#1c1814', accent: '#f59e0b', text: '#f0e8d8' }, light: { bg: '#f5ede0', card: '#ffffff', accent: '#d97706', text: '#201a10' } },
  aaron:    { dark: { bg: '#0f0f0f', card: '#1a1816', accent: '#c9a84c', text: '#f0ece4' }, light: { bg: '#f2efe8', card: '#faf8f4', accent: '#96800e', text: '#1a1810' } },
  tina:     { dark: { bg: '#1a1020', card: '#261830', accent: '#f472b6', text: '#f0e4f4' }, light: { bg: '#f0dff0', card: '#ffffff', accent: '#ec4899', text: '#1e1028' } },
}

const THEME_META_COLORS: Record<ThemeId, { dark: string; light: string }> = {
  midnight: { dark: '#0f0f0f', light: '#f2eded' },
  graphite: { dark: '#111118', light: '#ededf5' },
  arctic:   { dark: '#0e1420', light: '#dde4f5' },
  forge:    { dark: '#100e0b', light: '#f5ede0' },
  aaron:    { dark: '#0f0f0f', light: '#f2efe8' },
  tina:     { dark: '#1a1020', light: '#f0dff0' },
}

function applyTheme(id: string): void {
  document.documentElement.setAttribute('data-theme', id)
  updateMetaColor()
  localStorage.setItem('app-theme', id)
}

function getSystemMode(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyResolvedMode(resolved: string): void {
  document.documentElement.setAttribute('data-mode', resolved)
  updateMetaColor()
}

function applyMode(preference: string): void {
  localStorage.setItem('app-mode', preference)
  applyResolvedMode(preference === 'auto' ? getSystemMode() : preference)
}

function updateMetaColor(): void {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) return
  const themeId = (document.documentElement.getAttribute('data-theme') || 'midnight') as ThemeId
  const mode = (document.documentElement.getAttribute('data-mode') || 'dark') as 'dark' | 'light'
  const colors = THEME_META_COLORS[themeId] ?? THEME_META_COLORS.midnight
  meta.setAttribute('content', colors[mode] ?? colors.dark)
}

function applyGlass(enabled: boolean): void {
  document.documentElement.setAttribute('data-glass', enabled ? 'on' : 'off')
  localStorage.setItem('app-glass', enabled ? 'on' : 'off')
}

// Apply immediately at import time to prevent flash
const storedId = localStorage.getItem('app-theme') || 'midnight'
const validId  = THEMES.find(t => t.id === storedId)?.id ?? 'midnight'
const storedMode = localStorage.getItem('app-mode') || 'auto'
const validMode: ColorMode = (['light', 'dark', 'auto'] as const).includes(storedMode as ColorMode) ? storedMode as ColorMode : 'auto'
applyTheme(validId)
applyMode(validMode)

const storedGlass = localStorage.getItem('app-glass') !== 'off'
applyGlass(storedGlass)

const currentTheme: Ref<string> = ref(validId)
const colorMode: Ref<ColorMode> = ref(validMode)
const resolvedMode: ComputedRef<'dark' | 'light'> = computed(() =>
  colorMode.value === 'auto' ? getSystemMode() : colorMode.value
)
const glassEnabled: Ref<boolean> = ref(storedGlass)
const restTimerEnabled: Ref<boolean> = ref(localStorage.getItem('rest-timer') !== 'off')
const restTimerAutoStart: Ref<boolean> = ref(localStorage.getItem('rest-timer-autostart') !== 'off')
const weightUnit: Ref<WeightUnit> = ref((localStorage.getItem('weight-unit') || 'lbs') as WeightUnit)
watch(currentTheme, applyTheme)
watch(colorMode, applyMode)
watch(glassEnabled, applyGlass)

// Listen for OS theme changes when in auto mode
const mql = window.matchMedia('(prefers-color-scheme: dark)')
mql.addEventListener('change', () => {
  if (colorMode.value === 'auto') {
    applyResolvedMode(getSystemMode())
  }
})
watch(restTimerEnabled, (v) => localStorage.setItem('rest-timer', v ? 'on' : 'off'))
watch(restTimerAutoStart, (v) => localStorage.setItem('rest-timer-autostart', v ? 'on' : 'off'))
watch(weightUnit, (v) => localStorage.setItem('weight-unit', v))

export function useTheme() {
  // Weight conversion helpers — data is always stored in lbs
  function displayWeight(lbs: number): number {
    if (weightUnit.value === 'kg') return +(lbs * 0.453592).toFixed(1)
    return lbs
  }
  function toLbs(value: number): number {
    if (weightUnit.value === 'kg') return +(value / 0.453592).toFixed(1)
    return value
  }

  return { currentTheme, THEMES, THEME_PREVIEWS, colorMode, resolvedMode, glassEnabled, restTimerEnabled, restTimerAutoStart, weightUnit, displayWeight, toLbs }
}
