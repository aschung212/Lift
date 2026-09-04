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

  it('is a real button that opens the sync sheet, not a hover-only span (LIFT-1323)', () => {
    // The `:title` tooltip that used to be the ONLY explanation is unreachable
    // on touch, which is the platform this ships to. It stays as a desktop
    // enhancement, but the tap path is what makes the state readable at all.
    expect(appSource).toMatch(/<button v-if="displaySyncStatus !== 'synced'" class="syncIndicator"/)
    expect(appSource).toMatch(/class="syncIndicator"[^>]*aria-haspopup="dialog"/)
    expect(appSource).toMatch(/class="syncIndicator"[^>]*@click="syncSheetOpen = true"/)
  })

  it('keeps the indicator up for writes the queue has given up on (LIFT-1323)', () => {
    // Without the stranded count, a later unrelated write flushing cleanly
    // reset the status to 'synced' and removed the only entry point to the
    // sheet, while local-only rows sat in the journal.
    expect(appSource).toMatch(
      /combineSyncStatus\(syncStatus\.value, readSyncError\.value, strandedSyncCount\.value\)/
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
