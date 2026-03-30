import { ref, watch } from 'vue'

export const THEMES = [
  { id: 'midnight', label: 'Midnight', dot: '#ff6363' },
  { id: 'graphite', label: 'Graphite', dot: '#8b5cf6' },
  { id: 'arctic',   label: 'Arctic',   dot: '#0066ff' },
  { id: 'forge',    label: 'Forge',    dot: '#f59e0b' },
  { id: 'aaron',    label: 'Aaron',    dot: '#4a7a2a' },
  { id: 'tina',     label: 'Tina',     dot: '#ec4899' },
]

const THEME_META_COLORS = {
  midnight: { dark: '#0f0f0f', light: '#f2eded' },
  graphite: { dark: '#111118', light: '#ededf5' },
  arctic:   { dark: '#0e1420', light: '#dde4f5' },
  forge:    { dark: '#100e0b', light: '#f5ede0' },
  aaron:    { dark: '#0b0d09', light: '#eef0e8' },
  tina:     { dark: '#1a1020', light: '#f0dff0' },
}

function applyTheme(id) {
  document.documentElement.setAttribute('data-theme', id)
  updateMetaColor()
  localStorage.setItem('app-theme', id)
}

function applyMode(mode) {
  document.documentElement.setAttribute('data-mode', mode)
  updateMetaColor()
  localStorage.setItem('app-mode', mode)
}

function updateMetaColor() {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) return
  const themeId = document.documentElement.getAttribute('data-theme') || 'midnight'
  const mode = document.documentElement.getAttribute('data-mode') || 'dark'
  const colors = THEME_META_COLORS[themeId] ?? THEME_META_COLORS.midnight
  meta.content = colors[mode] ?? colors.dark
}

function applyGlass(enabled) {
  document.documentElement.setAttribute('data-glass', enabled ? 'on' : 'off')
  localStorage.setItem('app-glass', enabled ? 'on' : 'off')
}

// Apply immediately at import time to prevent flash
const storedId = localStorage.getItem('app-theme') || 'midnight'
const validId  = THEMES.find(t => t.id === storedId)?.id ?? 'midnight'
const storedMode = localStorage.getItem('app-mode') || 'dark'
const validMode = storedMode === 'light' ? 'light' : 'dark'
applyTheme(validId)
applyMode(validMode)

const storedGlass = localStorage.getItem('app-glass') !== 'off'
applyGlass(storedGlass)

const currentTheme = ref(validId)
const colorMode = ref(validMode)
const glassEnabled = ref(storedGlass)
watch(currentTheme, applyTheme)
watch(colorMode, applyMode)
watch(glassEnabled, applyGlass)

export function useTheme() {
  return { currentTheme, THEMES, colorMode, glassEnabled }
}
