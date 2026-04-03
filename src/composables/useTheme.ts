import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'

export type ThemeId = 'fire' | 'water' | 'luck' | 'air' | 'eternal' | 'amethyst' | 'pearl' | 'moon' | 'love' | 'oak'
export type ColorMode = 'light' | 'dark' | 'auto'
export type WeightUnit = 'lbs' | 'kg'

export interface ThemeOption {
  id: ThemeId
  label: string
  icon: string
}

interface ThemePreviewColors {
  bg: string
  card: string
  accent: string
  text: string
}

export const THEMES: ThemeOption[] = [
  { id: 'fire',     label: 'Fire',     icon: 'fire' },
  { id: 'water',    label: 'Water',    icon: 'water' },
  { id: 'luck',     label: 'Luck',     icon: 'luck' },
  { id: 'air',      label: 'Air',      icon: 'air' },
  { id: 'eternal',    label: 'Eternal',     icon: 'eternal' },
  { id: 'amethyst', label: 'Amethyst', icon: 'amethyst' },
  { id: 'pearl',    label: 'Pearl',    icon: 'pearl' },
  { id: 'moon',     label: 'Moon',     icon: 'moon' },
  { id: 'love',     label: 'Love',     icon: 'love' },
  { id: 'oak',      label: 'Oak',      icon: 'oak' },
]

export const THEME_PREVIEWS: Record<ThemeId, { dark: ThemePreviewColors; light: ThemePreviewColors }> = {
  fire:     { dark: { bg: '#2a0808', card: '#1a1a1a', accent: '#ff6363', text: '#f2f2f2' }, light: { bg: '#6a1010', card: '#ffffff', accent: '#ff6363', text: '#1a1212' } },
  water:    { dark: { bg: '#0a2848', card: '#182030', accent: '#3388ff', text: '#e0e8f8' }, light: { bg: '#103060', card: '#ffffff', accent: '#60a5fa', text: '#1a1a2e' } },
  luck:    { dark: { bg: '#1a3a2a', card: '#14221c', accent: '#d4af37', text: '#e8f0ec' }, light: { bg: '#2a6848', card: '#f8faf9', accent: '#c0c8c4', text: '#0a1a14' } },
  air:      { dark: { bg: '#2a3a48', card: '#1a2430', accent: '#a8c8e8', text: '#e8f0f8' }, light: { bg: '#88a8c0', card: '#ffffff', accent: '#e8f4ff', text: '#1a2030' } },
  eternal:     { dark: { bg: '#1a1a14', card: '#0c0c0c', accent: '#c8a84c', text: '#eeeeee' }, light: { bg: '#8a7020', card: '#ffffff', accent: '#f8f0d0', text: '#1a1810' } },
  amethyst: { dark: { bg: '#2a2050', card: '#1c1c28', accent: '#8b5cf6', text: '#e4e4f4' }, light: { bg: '#3a2870', card: '#ffffff', accent: '#a78bfa', text: '#18182a' } },
  pearl:    { dark: { bg: '#1a1a1a', card: '#111111', accent: '#d0d0d0', text: '#f0f0f0' }, light: { bg: '#808080', card: '#ffffff', accent: '#f5f5f0', text: '#1a1a1a' } },
  moon:     { dark: { bg: '#0a1028', card: '#141830', accent: '#8090c0', text: '#d0d8f0' }, light: { bg: '#182048', card: '#ffffff', accent: '#a0b0e0', text: '#0a1020' } },
  love:    { dark: { bg: '#3a1028', card: '#261830', accent: '#f472b6', text: '#f0e4f4' }, light: { bg: '#6a2048', card: '#ffffff', accent: '#f472b6', text: '#1e1028' } },
  oak:      { dark: { bg: '#1c1410', card: '#141010', accent: '#906040', text: '#e8dcd0' }, light: { bg: '#6b4c38', card: '#ffffff', accent: '#c89070', text: '#1a1210' } },
}

const THEME_META_COLORS: Record<ThemeId, { dark: string; light: string }> = {
  fire:     { dark: '#0f0f0f', light: '#f2eded' },
  water:    { dark: '#0e1420', light: '#dde4f5' },
  luck:    { dark: '#0a1210', light: '#f0f5f2' },
  air:      { dark: '#101820', light: '#f0f6fa' },
  eternal:     { dark: '#0c0c0c', light: '#f8f6f2' },
  amethyst: { dark: '#111118', light: '#ededf5' },
  pearl:    { dark: '#111111', light: '#f4f4f2' },
  moon:     { dark: '#080c1a', light: '#eaecf5' },
  love:    { dark: '#1a1020', light: '#f0dff0' },
  oak:      { dark: '#141010', light: '#f5efe8' },
}

// Map old theme IDs to new ones for localStorage migration
const THEME_MIGRATION: Record<string, ThemeId> = {
  midnight: 'fire',
  graphite: 'amethyst',
  arctic:   'water',
  forge:    'pearl',
  aaron:    'luck',
  tina:     'love',
  earth:    'luck',
  bloom:    'love',
  metal:    'eternal',
  void:        'eternal',
  sun:         'pearl',
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
  const themeId = (document.documentElement.getAttribute('data-theme') || 'eternal') as ThemeId
  const mode = (document.documentElement.getAttribute('data-mode') || 'dark') as 'dark' | 'light'
  const colors = THEME_META_COLORS[themeId] ?? THEME_META_COLORS.fire
  meta.setAttribute('content', colors[mode] ?? colors.dark)
}

function applyGlass(enabled: boolean): void {
  document.documentElement.setAttribute('data-glass', enabled ? 'on' : 'off')
  localStorage.setItem('app-glass', enabled ? 'on' : 'off')
}

// Apply immediately at import time to prevent flash
let storedId = localStorage.getItem('app-theme') || 'eternal'
// Migrate old theme names
if (storedId in THEME_MIGRATION) {
  storedId = THEME_MIGRATION[storedId]
  localStorage.setItem('app-theme', storedId)
}
const validId  = THEMES.find(t => t.id === storedId)?.id ?? 'eternal'
const storedMode = localStorage.getItem('app-mode') || 'dark'
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
