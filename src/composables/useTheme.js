import { ref, watch } from 'vue'

export const THEMES = [
  { id: 'midnight', label: 'Midnight', dot: '#ff6363' },
  { id: 'graphite', label: 'Graphite', dot: '#8b5cf6' },
  { id: 'arctic',   label: 'Arctic',   dot: '#0066ff' },
  { id: 'forge',    label: 'Forge',    dot: '#f59e0b' },
  { id: 'garden',   label: 'Garden',   dot: '#16a34a' },
]

const THEME_COLORS = {
  midnight: '#0f0f0f',
  graphite: '#111118',
  arctic:   '#eeeef5',
  forge:    '#100e0b',
  garden:   '#edf2ed',
}

function applyTheme(id) {
  document.documentElement.setAttribute('data-theme', id)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = THEME_COLORS[id] ?? '#0f0f0f'
  localStorage.setItem('app-theme', id)
}

// Apply immediately at import time to prevent flash
const storedId = localStorage.getItem('app-theme') || 'midnight'
const validId  = THEMES.find(t => t.id === storedId) ? storedId : 'midnight'
applyTheme(validId)

const currentTheme = ref(validId)
watch(currentTheme, applyTheme)

export function useTheme() {
  return { currentTheme, THEMES }
}
