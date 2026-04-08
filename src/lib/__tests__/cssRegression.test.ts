/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'

const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf-8')

/**
 * Regression tests for CSS bugs caught during manual testing.
 * These verify structural properties of the CSS to prevent
 * accidental moves/deletions during future edits.
 */

// Helper: extract lines between a selector and its closing brace
function getRuleLines(selector: string, source = css): string[] {
  // Match the selector at the start of a line to avoid matching it inside another selector
  const needle = '\n' + selector + ' {'
  const idx = source.indexOf(needle)
  if (idx === -1) return []
  const start = source.indexOf('{', idx) + 1
  let depth = 1
  let end = start
  while (depth > 0 && end < source.length) {
    if (source[end] === '{') depth++
    if (source[end] === '}') depth--
    end++
  }
  return source.slice(start, end - 1).split('\n').map((l: string) => l.trim()).filter(Boolean)
}

// Helper: extract the <style> block from a Vue SFC
function getVueStyleBlock(componentPath: string): string {
  const content = readFileSync(resolve(__dirname, '../../components', componentPath), 'utf-8')
  const match = content.match(/<style[^>]*>([\s\S]*?)<\/style>/)
  return match ? match[1] : ''
}

describe('CSS regression tests', () => {
  describe('.tabContent base rule', () => {
    const lines = getRuleLines('.tabContent')

    // Regression: padding was accidentally moved to .modal-open override,
    // breaking scroll on the main exercise list (PR #37)
    it('has padding-top', () => {
      expect(lines.some(l => l.startsWith('padding-top'))).toBe(true)
    })

    it('has padding-bottom for tab bar clearance', () => {
      expect(lines.some(l => l.startsWith('padding-bottom'))).toBe(true)
    })

    it('has overflow-y: auto for scrolling', () => {
      expect(lines.some(l => l.includes('overflow-y') && l.includes('auto'))).toBe(true)
    })
  })

  describe('html.modal-open .tabContent override', () => {
    const lines = getRuleLines('html.modal-open .tabContent')

    // Regression: must lock scroll on the container, not the overlay (PR #27)
    it('sets overflow: hidden to lock scroll', () => {
      expect(lines.some(l => l.includes('overflow') && l.includes('hidden'))).toBe(true)
    })

    it('sets touch-action: none for iOS', () => {
      expect(lines.some(l => l.includes('touch-action') && l.includes('none'))).toBe(true)
    })

    // Regression: padding should NOT be in this override (PR #37)
    it('does not contain padding-top (belongs in base rule)', () => {
      expect(lines.some(l => l.startsWith('padding-top'))).toBe(false)
    })

    it('does not contain padding-bottom (belongs in base rule)', () => {
      expect(lines.some(l => l.startsWith('padding-bottom'))).toBe(false)
    })
  })

  describe('.repMaxOverlay', () => {
    const lines = getRuleLines('.repMaxOverlay')

    // Regression: drag handle hidden behind Dynamic Island in PWA mode (PR #22)
    it('has safe-area-inset-top padding for Dynamic Island', () => {
      expect(lines.some(l => l.includes('safe-area-inset-top'))).toBe(true)
    })
  })

  describe('.settingsSheet', () => {
    const lines = getRuleLines('.settingsSheet')

    // Regression: drag handle hidden behind Dynamic Island in PWA mode (PR #28)
    it('accounts for safe-area-inset-top in max-height', () => {
      expect(lines.some(l => l.includes('safe-area-inset-top'))).toBe(true)
    })
  })

  describe('.wtDetailTabs segmented control', () => {
    const lines = getRuleLines('.wtDetailTabs')

    it('has border-radius for pill shape', () => {
      expect(lines.some(l => l.includes('border-radius'))).toBe(true)
    })

    it('uses bg-secondary background', () => {
      expect(lines.some(l => l.includes('--bg-secondary'))).toBe(true)
    })
  })

  describe('.wtSetCard date-grouped card', () => {
    const lines = getRuleLines('.wtSetCard')

    it('has border-radius for rounded corners', () => {
      expect(lines.some(l => l.includes('border-radius'))).toBe(true)
    })

    it('has border for visibility in light themes', () => {
      expect(lines.some(l => l.includes('border') && l.includes('--border'))).toBe(true)
    })

    it('uses bg-elevated background', () => {
      expect(lines.some(l => l.includes('--bg-elevated'))).toBe(true)
    })
  })

  describe('.wtGraphWrap chart card', () => {
    const lines = getRuleLines('.wtGraphWrap')

    it('has border-radius for rounded corners', () => {
      expect(lines.some(l => l.includes('border-radius'))).toBe(true)
    })

    it('has border for visibility in light themes', () => {
      expect(lines.some(l => l.includes('border') && l.includes('--border'))).toBe(true)
    })
  })

  describe('.settingsScrollBody', () => {
    const lines = getRuleLines('.settingsScrollBody')

    it('exists as separate scroll container from settingsSheet', () => {
      expect(lines.length).toBeGreaterThan(0)
    })

    it('has overflow-y: auto', () => {
      expect(lines.some(l => l.includes('overflow-y') && l.includes('auto'))).toBe(true)
    })
  })

  describe('.settingsSegment weight goal control', () => {
    const lines = getRuleLines('.settingsSegment')

    it('has border-radius for pill shape', () => {
      expect(lines.some(l => l.includes('border-radius'))).toBe(true)
    })
  })

  describe('.settingsInput', () => {
    const lines = getRuleLines('.settingsInput')

    it('has min-height for touch targets', () => {
      expect(lines.some(l => l.includes('min-height') && l.includes('44px'))).toBe(true)
    })
  })

  describe('.wtSetBtn equal-width action buttons', () => {
    const lines = getRuleLines('.wtSetBtn')

    it('uses flex: 1 for equal widths', () => {
      expect(lines.some(l => l.includes('flex') && l.includes('1'))).toBe(true)
    })

    it('has min-height for touch targets', () => {
      expect(lines.some(l => l.includes('min-height') && l.includes('44px'))).toBe(true)
    })
  })

  describe('Vue component touch target compliance', () => {
    // jsdom does not apply scoped CSS from Vue SFCs, so getComputedStyle
    // cannot verify sizing in component tests. These CSS regression tests
    // read the stylesheet source directly to assert 44px touch targets.

    describe('.mgViewToggle in MuscleGroupChart', () => {
      const style = getVueStyleBlock('MuscleGroupChart.vue')
      const lines = getRuleLines('.mgViewToggle', style)

      it('has width: 44px for iOS HIG touch target', () => {
        expect(lines.some(l => l.includes('width') && l.includes('44px'))).toBe(true)
      })

      it('has height: 44px for iOS HIG touch target', () => {
        expect(lines.some(l => l.includes('height') && l.includes('44px'))).toBe(true)
      })
    })

    describe('.mgRow in MuscleGroupChart (LIFT-97)', () => {
      const style = getVueStyleBlock('MuscleGroupChart.vue')
      const lines = getRuleLines('.mgRow', style)

      it('has min-height: 44px for iOS HIG touch target', () => {
        expect(lines.some(l => l.includes('min-height') && l.includes('44px'))).toBe(true)
      })
    })
  })

  describe('.wtTimerEditResetBtn touch target (LIFT-79)', () => {
    const lines = getRuleLines('.wtTimerEditResetBtn')

    it('has min-height: 44px for iOS HIG compliance', () => {
      expect(lines.some(l => l.includes('min-height') && l.includes('44px'))).toBe(true)
    })

    it('has adequate padding (not 4px)', () => {
      const paddingLine = lines.find(l => l.startsWith('padding'))
      expect(paddingLine).toBeDefined()
      // Ensure padding is at least 8px vertically
      expect(paddingLine).not.toMatch(/padding:\s*4px/)
    })
  })

  describe('.wtTimerPresetSm touch target (LIFT-79)', () => {
    const lines = getRuleLines('.wtTimerPresetSm')

    it('has min-height: 44px for iOS HIG compliance', () => {
      expect(lines.some(l => l.includes('min-height') && l.includes('44px'))).toBe(true)
    })
  })

  describe('.wtTimerEditCountdown touch target (LIFT-79)', () => {
    const lines = getRuleLines('.wtTimerEditCountdown')

    it('has min-height: 44px for iOS HIG compliance', () => {
      expect(lines.some(l => l.includes('min-height') && l.includes('44px'))).toBe(true)
    })
  })

  describe('brace balance (LIFT-252)', () => {
    // Regression: an extra closing brace in index.css caused a CSS minifier
    // warning ("unexpected }") that could silently drop rules in production.
    it('index.css has balanced braces', () => {
      let depth = 0
      const lines = css.split('\n')
      for (let i = 0; i < lines.length; i++) {
        for (const ch of lines[i]) {
          if (ch === '{') depth++
          if (ch === '}') depth--
        }
        if (depth < 0) {
          expect.fail(`Extra closing brace at line ${i + 1}: "${lines[i].trim()}"`)
        }
      }
      if (depth !== 0) {
        expect.fail(`Brace imbalance: ${depth > 0 ? depth + ' unclosed' : Math.abs(depth) + ' extra closing'} brace(s)`)
      }
    })

    it('Vue component style blocks have balanced braces', () => {
      const componentsDir = resolve(__dirname, '../../components')
      const vueFiles = readdirSync(componentsDir).filter((f: string) => f.endsWith('.vue'))
      for (const file of vueFiles) {
        const content = readFileSync(resolve(componentsDir, file), 'utf-8')
        const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/)
        if (!styleMatch) continue
        let depth = 0
        const lines = styleMatch[1].split('\n')
        for (let i = 0; i < lines.length; i++) {
          for (const ch of lines[i]) {
            if (ch === '{') depth++
            if (ch === '}') depth--
          }
        }
        if (depth !== 0) {
          expect.fail(`${file}: brace imbalance (${depth > 0 ? depth + ' unclosed' : Math.abs(depth) + ' extra closing'})`)
        }
      }
    })
  })

  describe('.srOnly screen-reader utility (LIFT-77)', () => {
    it('has position: absolute and clip to hide visually', () => {
      const lines = getRuleLines('.srOnly')
      expect(lines.length).toBeGreaterThan(0)
      expect(lines.some(l => l.startsWith('position: absolute'))).toBe(true)
      expect(lines.some(l => l.startsWith('clip: rect(0, 0, 0, 0)'))).toBe(true)
      expect(lines.some(l => l.startsWith('overflow: hidden'))).toBe(true)
    })
  })

  describe('spacing scale compliance (4/8/12/16/24/32)', () => {
    // Valid spacing values: 0, 1, 2, 4, 8, 12, 16, 24, 32, and multiples of 8 above 32
    const SCALE = new Set([0, 1, 2, 4, 8, 12, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128])
    const isOnScale = (v: number) => SCALE.has(v) || (v >= 32 && v % 8 === 0)

    const spacingProps = /^\s*(padding|margin|gap|padding-top|padding-bottom|padding-left|padding-right|margin-top|margin-bottom|margin-left|margin-right|row-gap|column-gap)\s*:/
    const pxVal = /-?\d+(?=px)/g

    function findViolations(): { line: number; text: string; values: number[] }[] {
      const violations: { line: number; text: string; values: number[] }[] = []
      css.split('\n').forEach((text, i) => {
        if (!spacingProps.test(text)) return
        if (text.includes('calc(') || text.includes('env(')) return
        const offScale: number[] = []
        let match
        pxVal.lastIndex = 0
        while ((match = pxVal.exec(text)) !== null) {
          const abs = Math.abs(parseInt(match[0], 10))
          if (abs > 2 && !isOnScale(abs)) offScale.push(abs)
        }
        if (offScale.length > 0) violations.push({ line: i + 1, text: text.trim(), values: offScale })
      })
      return violations
    }

    it('has no off-scale spacing values in index.css', () => {
      const violations = findViolations()
      if (violations.length > 0) {
        const report = violations.map(v => `  L${v.line}: ${v.text} (off-scale: ${v.values.join(', ')}px)`).join('\n')
        expect.fail(`Found ${violations.length} spacing scale violation(s):\n${report}`)
      }
    })

    it('has no off-scale spacing values in Vue component style blocks', () => {
      const componentsDir = resolve(__dirname, '../../components')
      const vueFiles = readdirSync(componentsDir).filter((f: string) => f.endsWith('.vue'))
      const allViolations: { file: string; line: number; text: string; values: number[] }[] = []

      for (const file of vueFiles) {
        const content = readFileSync(resolve(componentsDir, file), 'utf-8')
        const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/)
        if (!styleMatch) continue
        const styleBlock = styleMatch[1]
        const styleStartLine = content.slice(0, content.indexOf(styleMatch[0])).split('\n').length
        styleBlock.split('\n').forEach((text, i) => {
          if (!spacingProps.test(text)) return
          if (text.includes('calc(') || text.includes('env(')) return
          const offScale: number[] = []
          let match
          pxVal.lastIndex = 0
          while ((match = pxVal.exec(text)) !== null) {
            const abs = Math.abs(parseInt(match[0], 10))
            if (abs > 2 && !isOnScale(abs)) offScale.push(abs)
          }
          if (offScale.length > 0) allViolations.push({ file, line: styleStartLine + i, text: text.trim(), values: offScale })
        })
      }

      if (allViolations.length > 0) {
        const report = allViolations.map(v => `  ${v.file}:${v.line}: ${v.text} (off-scale: ${v.values.join(', ')}px)`).join('\n')
        expect.fail(`Found ${allViolations.length} spacing scale violation(s) in Vue components:\n${report}`)
      }
    })
  })

  describe('no hardcoded colors in component rules (LIFT-279)', () => {
    // Matches hex colors (#xxx, #xxxx, #xxxxxx, #xxxxxxxx) in CSS property values.
    // Excludes: theme token definitions ([data-theme=...][data-mode=...] blocks),
    // comments, SVG/image data URIs, and :root/:where selectors.
    const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/

    // Lines that are legitimate exceptions (theme token definitions, comments, etc.)
    function isException(line: string, lineIndex: number): boolean {
      const trimmed = line.trim()
      // Comment lines
      if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) return true
      // CSS custom property definitions (theme tokens)
      if (trimmed.startsWith('--')) return true
      // Data URIs, SVG references, background-image with url()
      if (trimmed.includes('url(')) return true
      // Gradient mesh definitions (theme-specific decorative gradients)
      if (trimmed.includes('radial-gradient') || trimmed.includes('linear-gradient')) return true
      // Shadow definitions using rgba/hsla (not hex)
      if (!HEX_COLOR.test(trimmed)) return true
      return false
    }

    // Check if a line is inside a theme token block ([data-theme=...][data-mode=...])
    function isInThemeBlock(lineIndex: number, lines: string[]): boolean {
      // Walk backwards to find the nearest selector
      for (let i = lineIndex - 1; i >= 0; i--) {
        const l = lines[i].trim()
        if (l.includes('[data-theme=') && l.includes('[data-mode=')) return true
        // If we hit a closing brace without finding a theme selector, we're not in a theme block
        if (l === '}') return false
      }
      return false
    }

    it('index.css component rules use only CSS custom properties for colors', () => {
      const lines = css.split('\n')
      const violations: { line: number; text: string }[] = []

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (isException(line, i)) continue
        if (isInThemeBlock(i, lines)) continue
        // Only check color-related properties
        const trimmed = line.trim()
        if (!/^\s*(color|background|border|border-color|border-bottom-color|border-top-color|border-left-color|border-right-color|outline-color|box-shadow)\s*:/.test(line)) continue
        if (HEX_COLOR.test(trimmed)) {
          violations.push({ line: i + 1, text: trimmed })
        }
      }

      if (violations.length > 0) {
        const report = violations.map(v => `  L${v.line}: ${v.text}`).join('\n')
        expect.fail(`Found ${violations.length} hardcoded color(s) — use CSS custom properties instead:\n${report}`)
      }
    })
  })
})
