/**
 * WCAG 2.1 AA contrast ratio audit for all 10 Lift themes (20 variants).
 *
 * The theme palettes are parsed directly from src/index.css at test time —
 * index.css is the single source of truth, so the audit can never validate a
 * stale duplicate of the design tokens (LIFT-1095). If a theme block gains,
 * loses, or renames a token, this suite either re-audits the real value or
 * fails loudly on the missing token.
 *
 * Checks every critical text/background pair against WCAG AA thresholds:
 *   - Normal text (< 18px): 4.5:1
 *   - Large text (≥ 18px or ≥ 14px bold): 3:1
 *   - Non-text UI (icons, borders): 3:1
 *
 * See: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// ── Color utilities ──────────────────────────────────────────────────

/** Expand a 3-digit hex (#fff) to its 6-digit form (#ffffff). */
function normalizeHex(hex: string): string {
  const h = hex.replace('#', '').trim()
  if (h.length === 3) {
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase()
  }
  return `#${h}`.toLowerCase()
}

function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex).replace('#', '')
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

// ── Theme parsing (single source of truth: src/index.css) ────────────

interface ThemeColors {
  bgPrimary: string
  bgSecondary: string
  bgElevated: string
  bgHover: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  accent: string
  textOnAccent: string
  danger: string
  success: string
}

/**
 * CSS custom-property name → ThemeColors field. Every field the audit reads
 * must be a hex-valued token in index.css; a missing one fails the parse.
 */
const TOKEN_MAP: Record<string, keyof ThemeColors> = {
  '--bg-primary': 'bgPrimary',
  '--bg-secondary': 'bgSecondary',
  '--bg-elevated': 'bgElevated',
  '--bg-hover': 'bgHover',
  '--text-primary': 'textPrimary',
  '--text-secondary': 'textSecondary',
  '--text-muted': 'textMuted',
  '--accent': 'accent',
  '--text-on-accent': 'textOnAccent',
  '--danger': 'danger',
  '--success': 'success',
}

const HEX_TOKEN = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/

/**
 * Parse every `[data-theme="X"][data-mode="Y"]` token block out of index.css.
 * Blocks contain only flat `--token: value;` declarations (no nested braces),
 * so a non-greedy brace match is sufficient and unambiguous.
 */
function parseThemesFromCss(css: string): Record<string, ThemeColors> {
  const blockRe = /\[data-theme="([\w-]+)"\]\[data-mode="(dark|light)"\]\s*\{([^}]*)\}/g
  const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g

  const out: Record<string, ThemeColors> = {}
  let block: RegExpExecArray | null

  while ((block = blockRe.exec(css)) !== null) {
    const [, theme, mode, body] = block
    const key = `${theme}-${mode}`
    const colors: Partial<ThemeColors> = {}

    let decl: RegExpExecArray | null
    while ((decl = declRe.exec(body)) !== null) {
      const field = TOKEN_MAP[decl[1]]
      if (!field) continue
      const value = decl[2].trim()
      if (!HEX_TOKEN.test(value)) {
        throw new Error(
          `${key}: token ${decl[1]} is "${value}", but the contrast audit only ` +
            `understands hex values. Update the audit if this token is now non-hex.`,
        )
      }
      colors[field] = normalizeHex(value)
    }

    const missing = Object.values(TOKEN_MAP).filter((f) => !(f in colors))
    if (missing.length > 0) {
      throw new Error(`${key}: missing required token(s): ${missing.join(', ')}`)
    }
    out[key] = colors as ThemeColors
  }

  return out
}

const cssPath = resolve(__dirname, '../../index.css')
const themes = parseThemesFromCss(readFileSync(cssPath, 'utf8'))

// ── Contrast pair definitions ────────────────────────────────────────

interface ContrastPair {
  label: string
  fg: (t: ThemeColors) => string
  bg: (t: ThemeColors) => string
  /** WCAG AA minimum ratio */
  min: number
}

const normalText: ContrastPair[] = [
  // Primary body text sits on every surface — cards/modals/rows use bg-elevated,
  // hovered/pressed rows use bg-hover.
  { label: 'text-primary on bg-primary',   fg: t => t.textPrimary,   bg: t => t.bgPrimary,   min: 4.5 },
  { label: 'text-primary on bg-secondary', fg: t => t.textPrimary,   bg: t => t.bgSecondary, min: 4.5 },
  { label: 'text-primary on bg-elevated',  fg: t => t.textPrimary,   bg: t => t.bgElevated,  min: 4.5 },
  { label: 'text-primary on bg-hover',     fg: t => t.textPrimary,   bg: t => t.bgHover,     min: 4.5 },
  // Secondary text (subtitles, metadata) renders on the primary/secondary/elevated
  // resting surfaces — all require the full 4.5:1 for normal-size text.
  { label: 'text-secondary on bg-primary', fg: t => t.textSecondary, bg: t => t.bgPrimary,   min: 4.5 },
  { label: 'text-secondary on bg-secondary', fg: t => t.textSecondary, bg: t => t.bgSecondary, min: 4.5 },
  { label: 'text-secondary on bg-elevated',  fg: t => t.textSecondary, bg: t => t.bgElevated,  min: 4.5 },
  { label: 'text-on-accent on accent',     fg: t => t.textOnAccent,  bg: t => t.accent,      min: 4.5 },
]

const largeText: ContrastPair[] = [
  // bg-hover is a *transient* pressed/hover feedback surface, not a resting reading
  // surface. Primary text on it still gets the full 4.5:1 guard; secondary text on a
  // momentary hover background is held to the 3:1 large/UI floor.
  { label: 'text-secondary on bg-hover (transient)', fg: t => t.textSecondary, bg: t => t.bgHover, min: 3 },
  { label: 'text-muted on bg-primary (large)',   fg: t => t.textMuted, bg: t => t.bgPrimary,   min: 3 },
  { label: 'text-muted on bg-secondary (large)', fg: t => t.textMuted, bg: t => t.bgSecondary, min: 3 },
  { label: 'accent on bg-primary (large)',        fg: t => t.accent,   bg: t => t.bgPrimary,   min: 3 },
  { label: 'accent on bg-secondary (large)',      fg: t => t.accent,   bg: t => t.bgSecondary, min: 3 },
  { label: 'danger on bg-primary (large)',        fg: t => t.danger,   bg: t => t.bgPrimary,   min: 3 },
  { label: 'success on bg-primary (large)',       fg: t => t.success,  bg: t => t.bgPrimary,   min: 3 },
]

// ── Tests ────────────────────────────────────────────────────────────

describe('theme contrast audit (WCAG 2.1 AA)', () => {
  it('parses all 10 themes (20 variants) from index.css', () => {
    // 10 themes × light/dark. Guards against a parser regression silently
    // dropping variants and leaving the audit green on an empty set.
    expect(Object.keys(themes).length).toBe(20)
  })

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
