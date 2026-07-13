/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const appSource = readFileSync(resolve(__dirname, '../../App.vue'), 'utf-8')

/**
 * Structural regression tests for the bottom-nav ARIA Tabs pattern (LIFT-853).
 *
 * The bottom navigation is exposed to assistive tech as an ARIA tablist. Before
 * LIFT-853 the pattern was only half-implemented: tab buttons carried
 * `role="tab"` + `aria-selected` but had no `id`, no `aria-controls`, and the
 * shared content panel lacked `role="tabpanel"` / `aria-labelledby`, so a screen
 * reader announced "tab, selected" without relating it to the panel it controls.
 *
 * These tests pin the wiring so it isn't dropped during future refactors.
 * See: WCAG 4.1.2, ARIA Authoring Practices Tabs pattern.
 */
describe('ARIA tabs pattern (bottom nav)', () => {
  it('the content panel is a labelled tabpanel pointing at the active tab', () => {
    expect(appSource).toMatch(/role="tabpanel"/)
    expect(appSource).toMatch(/:aria-labelledby="`tab-\$\{activeTab\}`"/)
  })

  it('each tab button has a stable id derived from the tab id', () => {
    expect(appSource).toMatch(/:id="`tab-\$\{tab\.id\}`"/)
  })

  it('each tab button controls the main-content panel', () => {
    // The panel keeps the id that aria-controls references.
    expect(appSource).toMatch(/id="main-content"/)
    expect(appSource).toMatch(/aria-controls="main-content"/)
  })

  it('tab buttons use a roving tabindex (only the active tab is in the tab order)', () => {
    expect(appSource).toMatch(/:tabindex="activeTab === tab\.id \? 0 : -1"/)
  })

  it('the tablist is labelled and the tabs handle keyboard navigation', () => {
    expect(appSource).toMatch(/role="tablist"[^>]*aria-label="Main navigation"/)
    // Roving tabindex: the handler lives on the tabs (the focused element when an
    // arrow key is pressed), not the non-focusable tablist container.
    expect(appSource).toMatch(/@keydown="onTablistKeydown"/)
  })

  it('the keydown handler implements arrow / Home / End roving navigation', () => {
    expect(appSource).toMatch(/function onTablistKeydown/)
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(appSource).toContain(`'${key}'`)
    }
    // Moving focus follows activation so the roving tabindex stays consistent.
    expect(appSource).toMatch(/document\.getElementById\(`tab-\$\{nextTab\.id\}`\)\?\.focus\(\)/)
  })
})
