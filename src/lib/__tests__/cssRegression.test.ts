/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf-8')

/**
 * Regression tests for CSS bugs caught during manual testing.
 * These verify structural properties of the CSS to prevent
 * accidental moves/deletions during future edits.
 */

// Helper: extract lines between a selector and its closing brace
function getRuleLines(selector: string): string[] {
  // Match the selector at the start of a line to avoid matching it inside another selector
  const needle = '\n' + selector + ' {'
  const idx = css.indexOf(needle)
  if (idx === -1) return []
  const start = css.indexOf('{', idx) + 1
  let depth = 1
  let end = start
  while (depth > 0 && end < css.length) {
    if (css[end] === '{') depth++
    if (css[end] === '}') depth--
    end++
  }
  return css.slice(start, end - 1).split('\n').map((l: string) => l.trim()).filter(Boolean)
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
  })
})
