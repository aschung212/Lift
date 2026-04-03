/**
 * WCAG 2.1 AA contrast ratio audit for all 9 Lift themes (18 variants).
 *
 * Checks every critical text/background pair against WCAG AA thresholds:
 *   - Normal text (< 18px): 4.5:1
 *   - Large text (≥ 18px or ≥ 14px bold): 3:1
 *   - Non-text UI (icons, borders): 3:1
 *
 * See: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
 */
import { describe, it, expect } from 'vitest'

// ── Color utilities ──────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/** WCAG 2.x relative luminance */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/** WCAG contrast ratio (1–21) */
function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(hexToRgb(fg))
  const l2 = relativeLuminance(hexToRgb(bg))
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

// ── Theme definitions (hex values from index.css) ────────────────────

interface ThemeColors {
  bgPrimary: string
  bgSecondary: string
  bgElevated: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  accent: string
  textOnAccent: string
  danger: string
  success: string
}

const themes: Record<string, ThemeColors> = {
  'fire-dark': {
    bgPrimary: '#0f0f0f', bgSecondary: '#1a1a1a', bgElevated: '#242424',
    textPrimary: '#f2f2f2', textSecondary: '#888888', textMuted: '#777777',
    accent: '#ff6363', textOnAccent: '#1a0000', danger: '#ff5a5a', success: '#30d158',
  },
  'fire-light': {
    bgPrimary: '#f2eded', bgSecondary: '#ffffff', bgElevated: '#ffffff',
    textPrimary: '#1a1212', textSecondary: '#6e5858', textMuted: '#907878',
    accent: '#dc3545', textOnAccent: '#ffffff', danger: '#dc2626', success: '#0d8a3a',
  },
  'water-dark': {
    bgPrimary: '#0e1420', bgSecondary: '#182030', bgElevated: '#202c40',
    textPrimary: '#e0e8f8', textSecondary: '#7888b0', textMuted: '#687898',
    accent: '#2070d8', textOnAccent: '#ffffff', danger: '#f87171', success: '#34d399',
  },
  'water-light': {
    bgPrimary: '#dde4f5', bgSecondary: '#ffffff', bgElevated: '#ffffff',
    textPrimary: '#1a1a2e', textSecondary: '#60609a', textMuted: '#7878a0',
    accent: '#0066ff', textOnAccent: '#ffffff', danger: '#dc2626', success: '#0d8a3a',
  },
  'luck-dark': {
    bgPrimary: '#0a1210', bgSecondary: '#0f1a16', bgElevated: '#14221c',
    textPrimary: '#e8f0ec', textSecondary: '#88a898', textMuted: '#607868',
    accent: '#d4af37', textOnAccent: '#0a1210', danger: '#ef4444', success: '#4ade80',
  },
  'luck-light': {
    bgPrimary: '#f0f5f2', bgSecondary: '#f8faf9', bgElevated: '#ffffff',
    textPrimary: '#0a1a14', textSecondary: '#3a5a48', textMuted: '#5a7868',
    accent: '#4a6058', textOnAccent: '#ffffff', danger: '#dc2626', success: '#0a7a35',
  },
  'air-dark': {
    bgPrimary: '#101820', bgSecondary: '#182028', bgElevated: '#202830',
    textPrimary: '#e8f0f8', textSecondary: '#8898b0', textMuted: '#687888',
    accent: '#88b8e0', textOnAccent: '#101820', danger: '#f87171', success: '#34d399',
  },
  'air-light': {
    bgPrimary: '#f0f6fa', bgSecondary: '#ffffff', bgElevated: '#ffffff',
    textPrimary: '#1a2030', textSecondary: '#506878', textMuted: '#708090',
    accent: '#2870a0', textOnAccent: '#ffffff', danger: '#dc2626', success: '#0d8a3a',
  },
  'eternal-dark': {
    bgPrimary: '#0c0c0c', bgSecondary: '#161614', bgElevated: '#1e1e1a',
    textPrimary: '#eeeeee', textSecondary: '#a09878', textMuted: '#807860',
    accent: '#c8a84c', textOnAccent: '#0c0c0c', danger: '#f87171', success: '#34d399',
  },
  'eternal-light': {
    bgPrimary: '#f8f6f2', bgSecondary: '#ffffff', bgElevated: '#ffffff',
    textPrimary: '#1a1810', textSecondary: '#6a6050', textMuted: '#8a8070',
    accent: '#8a7020', textOnAccent: '#ffffff', danger: '#dc2626', success: '#4d7c0f',
  },
  'amethyst-dark': {
    bgPrimary: '#111118', bgSecondary: '#1c1c28', bgElevated: '#26263a',
    textPrimary: '#e4e4f4', textSecondary: '#8080b0', textMuted: '#6868a0',
    accent: '#7c50e6', textOnAccent: '#ffffff', danger: '#f87171', success: '#34d399',
  },
  'amethyst-light': {
    bgPrimary: '#ededf5', bgSecondary: '#ffffff', bgElevated: '#ffffff',
    textPrimary: '#18182a', textSecondary: '#5c5890', textMuted: '#7e7aa0',
    accent: '#7c3aed', textOnAccent: '#ffffff', danger: '#dc2626', success: '#0d8a3a',
  },
  'pearl-dark': {
    bgPrimary: '#111111', bgSecondary: '#1a1a1a', bgElevated: '#222222',
    textPrimary: '#f0f0f0', textSecondary: '#a0a0a0', textMuted: '#707070',
    accent: '#d0d0d0', textOnAccent: '#111111', danger: '#ef4444', success: '#4ade80',
  },
  'pearl-light': {
    bgPrimary: '#f4f4f2', bgSecondary: '#ffffff', bgElevated: '#ffffff',
    textPrimary: '#1a1a1a', textSecondary: '#606060', textMuted: '#888888',
    accent: '#505050', textOnAccent: '#ffffff', danger: '#dc2626', success: '#15803d',
  },
  'midnight-dark': {
    bgPrimary: '#080c1a', bgSecondary: '#101428', bgElevated: '#181c34',
    textPrimary: '#d8ddf0', textSecondary: '#8088b0', textMuted: '#606888',
    accent: '#8898d0', textOnAccent: '#080c1a', danger: '#f87171', success: '#34d399',
  },
  'midnight-light': {
    bgPrimary: '#eaecf5', bgSecondary: '#f5f6fc', bgElevated: '#ffffff',
    textPrimary: '#0a1020', textSecondary: '#484870', textMuted: '#686888',
    accent: '#5060a0', textOnAccent: '#ffffff', danger: '#dc2626', success: '#0d8a3a',
  },
  'love-light': {
    bgPrimary: '#f0dff0', bgSecondary: '#ffffff', bgElevated: '#ffffff',
    textPrimary: '#1e1028', textSecondary: '#625098', textMuted: '#887098',
    accent: '#c83080', textOnAccent: '#ffffff', danger: '#dc2626', success: '#0d8a3a',
  },
  'love-dark': {
    bgPrimary: '#1a1020', bgSecondary: '#261830', bgElevated: '#322040',
    textPrimary: '#f0e4f4', textSecondary: '#a080c0', textMuted: '#806898',
    accent: '#f472b6', textOnAccent: '#1a0818', danger: '#f87171', success: '#34d399',
  },
  'earth-dark': {
    bgPrimary: '#141010', bgSecondary: '#1c1614', bgElevated: '#241c18',
    textPrimary: '#e8dcd0', textSecondary: '#a08878', textMuted: '#7a6858',
    accent: '#906040', textOnAccent: '#ffffff', danger: '#ef4444', success: '#84cc16',
  },
  'earth-light': {
    bgPrimary: '#f5efe8', bgSecondary: '#ffffff', bgElevated: '#ffffff',
    textPrimary: '#1a1210', textSecondary: '#6a5444', textMuted: '#8a7464',
    accent: '#7a5438', textOnAccent: '#ffffff', danger: '#dc2626', success: '#4d7c0f',
  },
}

// ── Contrast pair definitions ────────────────────────────────────────

interface ContrastPair {
  label: string
  fg: (t: ThemeColors) => string
  bg: (t: ThemeColors) => string
  /** WCAG AA minimum ratio */
  min: number
}

const normalText: ContrastPair[] = [
  { label: 'text-primary on bg-primary',   fg: t => t.textPrimary,   bg: t => t.bgPrimary,   min: 4.5 },
  { label: 'text-primary on bg-secondary', fg: t => t.textPrimary,   bg: t => t.bgSecondary, min: 4.5 },
  { label: 'text-primary on bg-elevated',  fg: t => t.textPrimary,   bg: t => t.bgElevated,  min: 4.5 },
  { label: 'text-secondary on bg-primary', fg: t => t.textSecondary, bg: t => t.bgPrimary,   min: 4.5 },
  { label: 'text-secondary on bg-secondary', fg: t => t.textSecondary, bg: t => t.bgSecondary, min: 4.5 },
  { label: 'text-on-accent on accent',     fg: t => t.textOnAccent,  bg: t => t.accent,      min: 4.5 },
]

const largeText: ContrastPair[] = [
  { label: 'text-muted on bg-primary (large)',   fg: t => t.textMuted, bg: t => t.bgPrimary,   min: 3 },
  { label: 'text-muted on bg-secondary (large)', fg: t => t.textMuted, bg: t => t.bgSecondary, min: 3 },
  { label: 'accent on bg-primary (large)',        fg: t => t.accent,   bg: t => t.bgPrimary,   min: 3 },
  { label: 'accent on bg-secondary (large)',      fg: t => t.accent,   bg: t => t.bgSecondary, min: 3 },
  { label: 'danger on bg-primary (large)',        fg: t => t.danger,   bg: t => t.bgPrimary,   min: 3 },
  { label: 'success on bg-primary (large)',       fg: t => t.success,  bg: t => t.bgPrimary,   min: 3 },
]

// ── Tests ────────────────────────────────────────────────────────────

describe('theme contrast audit (WCAG 2.1 AA)', () => {
  for (const [name, colors] of Object.entries(themes)) {
    describe(name, () => {
      for (const pair of normalText) {
        it(`${pair.label} ≥ ${pair.min}:1`, () => {
          const ratio = contrastRatio(pair.fg(colors), pair.bg(colors))
          expect(
            ratio,
            `${pair.label}: ${ratio.toFixed(2)}:1 (need ${pair.min}:1) — fg ${pair.fg(colors)} bg ${pair.bg(colors)}`,
          ).toBeGreaterThanOrEqual(pair.min)
        })
      }
      for (const pair of largeText) {
        it(`${pair.label} ≥ ${pair.min}:1`, () => {
          const ratio = contrastRatio(pair.fg(colors), pair.bg(colors))
          expect(
            ratio,
            `${pair.label}: ${ratio.toFixed(2)}:1 (need ${pair.min}:1) — fg ${pair.fg(colors)} bg ${pair.bg(colors)}`,
          ).toBeGreaterThanOrEqual(pair.min)
        })
      }
    })
  }
})
