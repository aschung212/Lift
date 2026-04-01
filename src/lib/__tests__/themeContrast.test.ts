/**
 * WCAG 2.1 AA contrast ratio audit for all 6 Lift themes (12 variants).
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
  'midnight-dark': {
    bgPrimary: '#0f0f0f', bgSecondary: '#1a1a1a', bgElevated: '#242424',
    textPrimary: '#f2f2f2', textSecondary: '#888888', textMuted: '#777777',
    accent: '#ff6363', textOnAccent: '#1a0000', danger: '#ff5a5a', success: '#30d158',
  },
  'midnight-light': {
    bgPrimary: '#f2eded', bgSecondary: '#ffffff', bgElevated: '#ffffff',
    textPrimary: '#1a1212', textSecondary: '#6e5858', textMuted: '#907878',
    accent: '#dc3545', textOnAccent: '#ffffff', danger: '#dc2626', success: '#0d8a3a',
  },
  'graphite-dark': {
    bgPrimary: '#111118', bgSecondary: '#1c1c28', bgElevated: '#26263a',
    textPrimary: '#e4e4f4', textSecondary: '#8080b0', textMuted: '#6868a0',
    accent: '#7c50e6', textOnAccent: '#ffffff', danger: '#f87171', success: '#34d399',
  },
  'graphite-light': {
    bgPrimary: '#ededf5', bgSecondary: '#ffffff', bgElevated: '#ffffff',
    textPrimary: '#18182a', textSecondary: '#5c5890', textMuted: '#7e7aa0',
    accent: '#7c3aed', textOnAccent: '#ffffff', danger: '#dc2626', success: '#0d8a3a',
  },
  'arctic-light': {
    bgPrimary: '#dde4f5', bgSecondary: '#ffffff', bgElevated: '#ffffff',
    textPrimary: '#1a1a2e', textSecondary: '#60609a', textMuted: '#7878a0',
    accent: '#0066ff', textOnAccent: '#ffffff', danger: '#dc2626', success: '#0d8a3a',
  },
  'arctic-dark': {
    bgPrimary: '#0e1420', bgSecondary: '#182030', bgElevated: '#202c40',
    textPrimary: '#e0e8f8', textSecondary: '#7888b0', textMuted: '#687898',
    accent: '#2070d8', textOnAccent: '#ffffff', danger: '#f87171', success: '#34d399',
  },
  'forge-dark': {
    bgPrimary: '#100e0b', bgSecondary: '#1c1814', bgElevated: '#262118',
    textPrimary: '#f0e8d8', textSecondary: '#9a8870', textMuted: '#7c7060',
    accent: '#f59e0b', textOnAccent: '#1a1400', danger: '#ef4444', success: '#84cc16',
  },
  'forge-light': {
    bgPrimary: '#f5ede0', bgSecondary: '#ffffff', bgElevated: '#ffffff',
    textPrimary: '#201a10', textSecondary: '#7a6848', textMuted: '#887050',
    accent: '#a85800', textOnAccent: '#ffffff', danger: '#dc2626', success: '#4d7c0f',
  },
  'aaron-dark': {
    bgPrimary: '#0c0f14', bgSecondary: '#141820', bgElevated: '#1c212a',
    textPrimary: '#e8eaee', textSecondary: '#8a9070', textMuted: '#6a7058',
    accent: '#c8a44e', textOnAccent: '#141000', danger: '#ef4444', success: '#7aaa60',
  },
  'aaron-light': {
    bgPrimary: '#eceee8', bgSecondary: '#f6f7f4', bgElevated: '#ffffff',
    textPrimary: '#141820', textSecondary: '#5a6048', textMuted: '#727858',
    accent: '#806a18', textOnAccent: '#ffffff', danger: '#dc2626', success: '#5a8a40',
  },
  'tina-light': {
    bgPrimary: '#f0dff0', bgSecondary: '#ffffff', bgElevated: '#ffffff',
    textPrimary: '#1e1028', textSecondary: '#625098', textMuted: '#887098',
    accent: '#c83080', textOnAccent: '#ffffff', danger: '#dc2626', success: '#0d8a3a',
  },
  'tina-dark': {
    bgPrimary: '#1a1020', bgSecondary: '#261830', bgElevated: '#322040',
    textPrimary: '#f0e4f4', textSecondary: '#a080c0', textMuted: '#806898',
    accent: '#f472b6', textOnAccent: '#1a0818', danger: '#f87171', success: '#34d399',
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
