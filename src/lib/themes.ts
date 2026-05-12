export type ThemeId = 'fire' | 'water' | 'luck' | 'air' | 'eternal' | 'amethyst' | 'pearl' | 'midnight' | 'love' | 'earth'
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
  { id: 'eternal',  label: 'Eternal',    icon: 'eternal' },
  { id: 'pearl',    label: 'Origin',     icon: 'pearl' },
  { id: 'midnight', label: 'Fortitude',  icon: 'midnight' },
  { id: 'fire',     label: 'Intensity',  icon: 'fire' },
  { id: 'water',    label: 'Flow',       icon: 'water' },
  { id: 'earth',    label: 'Stability',  icon: 'earth' },
  { id: 'luck',     label: 'Luck',       icon: 'luck' },
  { id: 'amethyst', label: 'Focus',      icon: 'amethyst' },
  { id: 'air',      label: 'Energy',     icon: 'air' },
  { id: 'love',     label: 'Love',       icon: 'love' },
]

export const THEME_PREVIEWS: Record<ThemeId, { dark: ThemePreviewColors; light: ThemePreviewColors }> = {
  fire:     { dark: { bg: '#2a0808', card: '#1a1a1a', accent: '#ff6363', text: '#f2f2f2' }, light: { bg: '#6a1010', card: '#ffffff', accent: '#ff6363', text: '#1a1212' } },
  water:    { dark: { bg: '#0a2848', card: '#182030', accent: '#3388ff', text: '#e0e8f8' }, light: { bg: '#103060', card: '#ffffff', accent: '#60a5fa', text: '#1a1a2e' } },
  luck:    { dark: { bg: '#1a3a2a', card: '#14221c', accent: '#d4af37', text: '#e8f0ec' }, light: { bg: '#2a6848', card: '#f8faf9', accent: '#c0c8c4', text: '#0a1a14' } },
  air:      { dark: { bg: '#1a1800', card: '#121008', accent: '#ffd700', text: '#f8f4e0' }, light: { bg: '#8a7800', card: '#ffffff', accent: '#ffdd33', text: '#1a1800' } },
  eternal:     { dark: { bg: '#1a1a14', card: '#0c0c0c', accent: '#c8a84c', text: '#eeeeee' }, light: { bg: '#8a7020', card: '#ffffff', accent: '#f8f0d0', text: '#1a1810' } },
  amethyst: { dark: { bg: '#2a2050', card: '#1c1c28', accent: '#8b5cf6', text: '#e4e4f4' }, light: { bg: '#3a2870', card: '#ffffff', accent: '#a78bfa', text: '#18182a' } },
  pearl:    { dark: { bg: '#1a1a1a', card: '#111111', accent: '#d0d0d0', text: '#f0f0f0' }, light: { bg: '#808080', card: '#ffffff', accent: '#f5f5f0', text: '#1a1a1a' } },
  midnight:     { dark: { bg: '#0a1028', card: '#141830', accent: '#8090c0', text: '#d0d8f0' }, light: { bg: '#182048', card: '#ffffff', accent: '#a0b0e0', text: '#0a1020' } },
  love:    { dark: { bg: '#3a1028', card: '#261830', accent: '#f472b6', text: '#f0e4f4' }, light: { bg: '#6a2048', card: '#ffffff', accent: '#f472b6', text: '#1e1028' } },
  earth:      { dark: { bg: '#1c1410', card: '#141010', accent: '#906040', text: '#e8dcd0' }, light: { bg: '#6b4c38', card: '#ffffff', accent: '#c89070', text: '#1a1210' } },
}

export const THEME_META_COLORS: Record<ThemeId, { dark: string; light: string }> = {
  fire:     { dark: '#0f0f0f', light: '#f2eded' },
  water:    { dark: '#0e1420', light: '#dde4f5' },
  luck:    { dark: '#0a1210', light: '#f0f5f2' },
  air:      { dark: '#0c0a00', light: '#f8f6e8' },
  eternal:     { dark: '#0c0c0c', light: '#f8f6f2' },
  amethyst: { dark: '#111118', light: '#ededf5' },
  pearl:    { dark: '#111111', light: '#f4f4f2' },
  midnight:     { dark: '#080c1a', light: '#eaecf5' },
  love:    { dark: '#1a1020', light: '#f0dff0' },
  earth:      { dark: '#141010', light: '#f5efe8' },
}

// Map old theme IDs to new ones for localStorage migration
export const THEME_MIGRATION: Record<string, ThemeId> = {
  graphite: 'amethyst',
  arctic:   'water',
  forge:    'pearl',
  aaron:    'luck',
  tina:     'love',
  bloom:    'love',
  metal:    'eternal',
  void:     'eternal',
  sun:      'pearl',
  moon:     'midnight',
  oak:      'earth',
}
