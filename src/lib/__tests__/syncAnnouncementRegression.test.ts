/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const appSource = readFileSync(resolve(__dirname, '../../App.vue'), 'utf-8')

/**
 * Source regression for the sync/connectivity announcement (LIFT-1149, WCAG
 * 4.1.3 + 1.1.1).
 *
 * The visual sync indicator is an icon-only span whose human-readable label
 * lived in a :title tooltip — not reliably surfaced by VoiceOver — so
 * screen-reader users got no notice when the app dropped offline or a sync
 * failed. Two fixes are pinned here so a refactor can't silently regress them:
 *   1. The icon-only span carries a text accessible name (aria-label), not just
 *      a title (SC 1.1.1).
 *   2. A persistent polite live region announces meaningful status transitions
 *      (SC 4.1.3), instead of relying on the v-if span as the live region.
 */
describe('sync-status announcement (LIFT-1149)', () => {
  it('gives the icon-only sync indicator a text accessible name', () => {
    // aria-label bound to the label so the SVG-only control is not nameless.
    expect(appSource).toMatch(
      /class="syncIndicator"[^>]*:aria-label="syncStatusLabel"/
    )
  })

  it('renders a persistent polite, atomic status live region for sync changes', () => {
    expect(appSource).toMatch(
      /role="status"\s+aria-live="polite"\s+aria-atomic="true">\{\{ syncAnnouncement \}\}/
    )
  })

  it('declares the syncAnnouncement state ref', () => {
    expect(appSource).toMatch(/const syncAnnouncement = ref\(/)
  })

  it('announces offline and error states from the shared label', () => {
    expect(appSource).toMatch(
      /if \(status === 'offline' \|\| status === 'error'\) \{\s*syncAnnouncement\.value = syncStatusLabel\.value/
    )
  })

  it('announces recovery only when returning to synced from offline/error', () => {
    expect(appSource).toMatch(
      /status === 'synced' && \(prev === 'offline' \|\| prev === 'error'\)/
    )
  })
})

/**
 * The indicator is REACHABLE, not just readable (LIFT-1323).
 *
 * LIFT-1149 gave the icon-only `<span>` an accessible name and a live region,
 * which fixed it for assistive tech — and left a sighted touch user with
 * nothing but a `:title` tooltip, which does not exist on iOS. So the app's
 * most consequential failure state (a write the server refused, replaying from
 * the journal every launch) had no explanation and no recovery path on the
 * platform the app ships to. The element is now a real `<button>` that opens
 * the sync sheet, and these pin the three pieces a refactor could quietly undo.
 */
describe('sync-indicator is tappable (LIFT-1323)', () => {
  /** The indicator element, from its `v-if` through its closing tag. */
  const indicator = appSource.match(
    /<button\s+v-if="displaySyncStatus !== 'synced'"[\s\S]*?<\/button>/,
  )?.[0]

  it('renders the indicator as a button, not a hover-only span', () => {
    expect(indicator).toBeTruthy()
  })

  it('opens the sync sheet on tap', () => {
    expect(indicator).toMatch(/@click="syncSheetOpen = true"/)
  })

  it('declares the dialog it controls so AT announces it as expandable', () => {
    expect(indicator).toMatch(/aria-haspopup="dialog"/)
    expect(indicator).toMatch(/:aria-expanded="syncSheetOpen"/)
  })

  it('mounts the sheet the button opens', () => {
    expect(appSource).toMatch(/<SyncStatusSheet v-if="syncSheetOpen" @close="syncSheetOpen = false" \/>/)
  })

  it('reads its status from the shared composable, not a private copy', () => {
    // App.vue used to fold the write queue and the four stores' read errors
    // itself. The sheet needs the same answer, and two folds is one drift away
    // from an icon that disagrees with the explanation behind it.
    expect(appSource).toMatch(
      /const \{ status: displaySyncStatus, label: syncStatusLabel \} = useSyncStatus\(\)/,
    )
  })
})
