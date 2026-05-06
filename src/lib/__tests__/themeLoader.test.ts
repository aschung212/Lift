/**
 * Tests for the theme lazy-loading infrastructure.
 *
 * Verifies:
 * 1. All 10 theme CSS files exist and have correct structure
 * 2. The vite plugin strips non-eternal themes from the production bundle
 * 3. Theme CSS files contain both dark and light mode definitions
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const THEME_IDS = ['eternal', 'fire', 'water', 'luck', 'air', 'amethyst', 'pearl', 'midnight', 'love', 'earth']
const THEMES_DIR = resolve(__dirname, '../../themes')

describe('Theme CSS files', () => {
  it('all 10 theme files exist', () => {
    for (const id of THEME_IDS) {
      const path = resolve(THEMES_DIR, `${id}.css`)
      expect(existsSync(path), `Missing theme file: ${id}.css`).toBe(true)
    }
  })

  it('each theme has both dark and light mode rules', () => {
    for (const id of THEME_IDS) {
      const css = readFileSync(resolve(THEMES_DIR, `${id}.css`), 'utf8')
      expect(css).toContain(`[data-theme="${id}"][data-mode="dark"]`)
      expect(css).toContain(`[data-theme="${id}"][data-mode="light"]`)
    }
  })

  it('each theme defines all required CSS custom properties', () => {
    const requiredVars = [
      '--bg-primary', '--bg-secondary', '--bg-elevated', '--bg-hover',
      '--border', '--border-strong',
      '--text-primary', '--text-secondary', '--text-muted',
      '--accent', '--accent-hover', '--accent-subtle',
      '--danger', '--danger-subtle', '--success', '--success-subtle',
      '--shadow', '--shadow-sm',
      '--glass-fill', '--glass-edge', '--glass-shine', '--glass-bar', '--glass-overlay',
      '--pr', '--pr-subtle', '--text-on-accent', '--mesh',
    ]

    for (const id of THEME_IDS) {
      const css = readFileSync(resolve(THEMES_DIR, `${id}.css`), 'utf8')
      for (const v of requiredVars) {
        // Each var should appear twice (dark + light)
        const count = (css.match(new RegExp(v.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g')) || []).length
        expect(count, `${id}.css missing ${v}`).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('theme files do not contain rules for other themes (no cross-contamination)', () => {
    for (const id of THEME_IDS) {
      const css = readFileSync(resolve(THEMES_DIR, `${id}.css`), 'utf8')
      for (const otherId of THEME_IDS) {
        if (otherId === id) continue
        expect(css).not.toContain(`[data-theme="${otherId}"]`)
      }
    }
  })
})

describe('Vite theme strip plugin', () => {
  it('plugin module exports a function', async () => {
    const { default: themeStripPlugin } = await import('../../../vite-plugin-theme-split')
    expect(typeof themeStripPlugin).toBe('function')
  })

  it('plugin returns correct structure', async () => {
    const { default: themeStripPlugin } = await import('../../../vite-plugin-theme-split')
    const plugin = themeStripPlugin()
    expect(plugin.name).toBe('lift-theme-strip')
    expect(plugin.apply).toBe('build')
    expect(plugin.enforce).toBe('post')
    expect(typeof plugin.generateBundle).toBe('function')
  })

  it('strips non-eternal theme blocks from CSS', async () => {
    const { default: themeStripPlugin } = await import('../../../vite-plugin-theme-split')
    const plugin = themeStripPlugin()

    // Simulate a CSS bundle with multiple theme blocks
    const mockCSS = `
.base { color: red; }
[data-theme="eternal"][data-mode="dark"] { --accent: gold; }
[data-theme="fire"][data-mode="dark"] { --accent: red; }
[data-theme="water"][data-mode="light"] { --accent: blue; }
.footer { margin: 0; }
`
    const bundle: Record<string, { type: string; source: string }> = {
      'assets/index-abc123.css': { type: 'asset', source: mockCSS }
    }

    // Call generateBundle
    ;(plugin.generateBundle as (...args: unknown[]) => void).call(null, {}, bundle)

    const result = bundle['assets/index-abc123.css'].source
    expect(result).toContain('[data-theme="eternal"]')
    expect(result).not.toContain('[data-theme="fire"]')
    expect(result).not.toContain('[data-theme="water"]')
    expect(result).toContain('.base { color: red; }')
    expect(result).toContain('.footer { margin: 0; }')
  })
})
