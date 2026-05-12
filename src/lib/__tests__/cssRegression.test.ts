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

    describe('.mgHeader in MuscleGroupChart', () => {
      const style = getVueStyleBlock('MuscleGroupChart.vue')
      const lines = getRuleLines('.mgHeader', style)

      it('has min-height: 44px for iOS HIG touch target', () => {
        expect(lines.some(l => l.includes('min-height') && l.includes('44px'))).toBe(true)
      })
    })

    describe('.mgRow in MuscleGroupChart', () => {
      const style = getVueStyleBlock('MuscleGroupChart.vue')
      const lines = getRuleLines('.mgRow', style)

      it('has min-height: 44px for iOS HIG touch target', () => {
        expect(lines.some(l => l.includes('min-height') && l.includes('44px'))).toBe(true)
      })
    })
  })

  describe('.wtTimerEditResetBtn touch target', () => {
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

  describe('.wtTimerPresetSm touch target', () => {
    const lines = getRuleLines('.wtTimerPresetSm')

    it('has min-height: 44px for iOS HIG compliance', () => {
      expect(lines.some(l => l.includes('min-height') && l.includes('44px'))).toBe(true)
    })
  })

  describe('.wtTimerEditCountdown touch target', () => {
    const lines = getRuleLines('.wtTimerEditCountdown')

    it('has min-height: 44px for iOS HIG compliance', () => {
      expect(lines.some(l => l.includes('min-height') && l.includes('44px'))).toBe(true)
    })
  })

  describe('brace balance', () => {
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

  describe('.srOnly screen-reader utility', () => {
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

  describe('.wtDateBtnWrap date subtitle tap target', () => {
    // Regression: the date "Today" subtitle in the log modal became an
    // inline <span> wrapper during the modal redesign (d4974c2). With
    // display:inline, the absolutely-positioned overlay <input type="date">
    // only covered the 44x17px inline text box — below iOS's 44pt minimum
    // and unreliable for native picker activation. Fix (c16fc0b) requires
    // inline-block + padding to produce a proper touch target.
    const lines = getRuleLines('.wtDateBtnWrap')

    it('is display: inline-block (not inline or flex)', () => {
      expect(lines.some(l => l.startsWith('display: inline-block'))).toBe(true)
    })

    it('has padding to expand the touch target above 44pt', () => {
      // Text height is ~17pt; needs at least 16px padding top+bottom to reach 44pt
      const paddingLine = lines.find(l => l.startsWith('padding'))
      expect(paddingLine, 'padding rule missing on .wtDateBtnWrap').toBeTruthy()
      const match = paddingLine!.match(/padding:\s*(\d+)px/)
      expect(match, `padding value parse failed: ${paddingLine}`).toBeTruthy()
      expect(Number(match![1])).toBeGreaterThanOrEqual(14)
    })

    it('has negative margin to preserve visible layout', () => {
      expect(lines.some(l => l.startsWith('margin') && l.includes('-'))).toBe(true)
    })

    it('position: relative for the absolute overlay input', () => {
      expect(lines.some(l => l.startsWith('position: relative'))).toBe(true)
    })
  })

  describe('.wtDateOverlayInput picker-trigger integrity', () => {
    const lines = getRuleLines('.wtDateOverlayInput')

    it('is position: absolute with inset: 0 to cover the wrap', () => {
      expect(lines.some(l => l.startsWith('position: absolute'))).toBe(true)
      expect(lines.some(l => l.startsWith('inset: 0'))).toBe(true)
    })

    it('has z-index to sit above the label span', () => {
      // Without z-index, real touches on iOS may land on the static-positioned
      // label sibling instead of the input — which never opens the picker.
      expect(lines.some(l => l.startsWith('z-index'))).toBe(true)
    })

    it('does NOT have pointer-events: none', () => {
      // A prior fix attempt (reverted in b437ffe) added pointer-events:none
      // which caused iOS Safari to refuse showPicker() entirely.
      expect(lines.every(l => !l.startsWith('pointer-events: none'))).toBe(true)
    })
  })

  describe('WCAG 2.4.7/2.4.11 focus-visible indicators (#547)', () => {
    // Regression: 11 input elements had outline:none with only border-color
    // changes on :focus — insufficient for low-vision users per WCAG 2.4.11.
    // Fix: add box-shadow ring on :focus-visible for all affected inputs.

    const inputsWithFocusRing = [
      { selector: '.settingsInput:focus-visible', label: 'settingsInput' },
      { selector: '.wtSearchInput:focus-visible', label: 'wtSearchInput' },
      { selector: '.wtTagPickerChip:focus-visible', label: 'wtTagPickerChip' },
      { selector: '.logSetSheet .logSetFieldInput:focus-visible', label: 'logSetFieldInput' },
      { selector: '.wtRepsStepperInput:focus-visible', label: 'wtRepsStepperInput' },
      { selector: '.repMaxInput:focus-visible', label: 'repMaxInput' },
      { selector: '.iosStepperInput:focus-visible', label: 'iosStepperInput' },
      { selector: '.wtTimerEditInput:focus-visible', label: 'wtTimerEditInput' },
      { selector: '.deleteConfirmInput:focus-visible', label: 'deleteConfirmInput' },
    ]

    for (const { selector, label } of inputsWithFocusRing) {
      it(`${label} has a box-shadow focus ring on :focus-visible`, () => {
        const lines = getRuleLines(selector)
        expect(lines.length, `${selector} rule not found`).toBeGreaterThan(0)
        expect(lines.some(l => l.includes('box-shadow') && l.includes('0 0 0 3px'))).toBe(true)
      })
    }

    it('settingsRange has an outline focus indicator on :focus-visible', () => {
      const lines = getRuleLines('.settingsRange:focus-visible')
      expect(lines.length, '.settingsRange:focus-visible rule not found').toBeGreaterThan(0)
      expect(lines.some(l => l.includes('outline') && l.includes('var(--accent)'))).toBe(true)
    })

    it('authInput has a box-shadow focus ring on :focus-visible', () => {
      const authStyle = getVueStyleBlock('AuthScreen.vue')
      const lines = getRuleLines('.authInput:focus-visible', authStyle)
      expect(lines.length, '.authInput:focus-visible rule not found in AuthScreen.vue').toBeGreaterThan(0)
      expect(lines.some(l => l.includes('box-shadow') && l.includes('0 0 0 3px'))).toBe(true)
    })
  })
})
