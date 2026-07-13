/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const appSource = readFileSync(resolve(__dirname, '../../App.vue'), 'utf-8')

/**
 * Source regression for the SPA view-change announcement (LIFT-854, WCAG 4.1.3).
 *
 * switchTab() swaps the active panel's content via v-if with no native focus
 * move or route change, so screen-reader users would otherwise hear nothing
 * when activating Calendar/Weight. A polite live region announces the active
 * view name on every switch. These tests pin the wiring so a refactor can't
 * silently drop the announcement.
 */
describe('view-change announcement (LIFT-854)', () => {
  it('renders a polite, atomic status live region for view changes', () => {
    expect(appSource).toMatch(
      /role="status"\s+aria-live="polite"\s+aria-atomic="true">\{\{ viewAnnouncement \}\}/
    )
  })

  it('declares the viewAnnouncement state ref', () => {
    expect(appSource).toMatch(/const viewAnnouncement = ref\(/)
  })

  it('the tab-switch handler populates the announcement from the tab label', () => {
    // The announcement must be set on switch (via useTabRouting's onSwitch
    // callback), derived from TAB_DEFS so it tracks the visible label rather
    // than a raw tab id.
    expect(appSource).toMatch(
      /viewAnnouncement\.value = `\$\{label\} view`/
    )
    expect(appSource).toMatch(
      /const label = TAB_DEFS\.find\(t => t\.id === to\)\?\.label/
    )
  })
})
