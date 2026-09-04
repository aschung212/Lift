/**
 * SyncStatusSheet (LIFT-1323) — the tap target's destination.
 *
 * The failure this replaces: the entire explanation of a sync failure lived in
 * a `:title` tooltip on a 24px icon. On the platform this ships to that is not
 * a degraded experience, it is no experience — there is no hover, so a user
 * whose workout never reached the server could not find out, and had nothing to
 * press if they suspected it.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mount, VueWrapper, enableAutoUnmount } from '@vue/test-utils'
import SyncStatusSheet from '../SyncStatusSheet.vue'
import { runComponentAxe } from '../../__tests__/axeHelper'
import type { SyncStatus } from '../../lib/syncStatus'

// useModal's scroll-lock count is module state shared across a file: a wrapper
// left mounted never releases its lock, and every later lock assertion in the
// file then passes vacuously (the settled rule for modal-mounting tests).
enableAutoUnmount(afterEach)

interface SheetProps {
  status?: SyncStatus
  pendingCount?: number
  strandedCount?: number
  lastSyncedAt?: number | null
  localOnly?: boolean
  busy?: boolean
}

function mountSheet(props: SheetProps = {}): VueWrapper {
  return mount(SyncStatusSheet, {
    props: {
      status: props.status ?? 'error',
      pendingCount: props.pendingCount ?? 0,
      strandedCount: props.strandedCount ?? 0,
      lastSyncedAt: props.lastSyncedAt ?? null,
      localOnly: props.localOnly ?? false,
      busy: props.busy ?? false,
    },
    global: { stubs: { Teleport: true } },
  })
}

describe('SyncStatusSheet', () => {
  it('is a labelled modal dialog', () => {
    const wrapper = mountSheet()
    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBe('sync-sheet-title')
    expect(wrapper.find('#sync-sheet-title').text()).toBeTruthy()
  })

  it('names the exact number of changes the app gave up on', () => {
    const wrapper = mountSheet({ status: 'error', pendingCount: 3, strandedCount: 3 })
    expect(wrapper.text()).toContain("Some changes didn't sync")
    expect(wrapper.find('.syncSheetFacts').text()).toContain('3 changes')
  })

  it('reports nothing waiting rather than a bare zero', () => {
    const wrapper = mountSheet({ status: 'error', pendingCount: 0 })
    expect(wrapper.find('.syncSheetFacts').text()).toContain('Nothing')
  })

  it('says the last sync is unknown instead of implying one happened', () => {
    const wrapper = mountSheet({ lastSyncedAt: null })
    expect(wrapper.find('.syncSheetFacts').text()).toContain('Never')
  })

  it('renders a relative last-sync time when one is known', () => {
    const wrapper = mountSheet({ lastSyncedAt: Date.now() - 5 * 60_000 })
    expect(wrapper.find('.syncSheetFacts').text()).toContain('5 minutes ago')
  })

  it('offers a manual retry and emits it once per tap', async () => {
    const wrapper = mountSheet({ status: 'error', pendingCount: 1, strandedCount: 1 })
    const button = wrapper.find('.syncSheetSync')
    expect(button.text()).toBe('Sync now')

    await button.trigger('click')

    expect(wrapper.emitted('sync-now')).toHaveLength(1)
  })

  it('holds the button while a sync is in flight', () => {
    const wrapper = mountSheet({ busy: true })
    const button = wrapper.find('.syncSheetSync')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.text()).toBe('Syncing…')
  })

  it('does not offer a retry that would certainly fail while offline', () => {
    const wrapper = mountSheet({ status: 'offline', pendingCount: 2 })
    expect(wrapper.find('.syncSheetSync').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('2 changes will sync when you')
  })

  it('never offers to sync, or claims a backup, for a local-only user', () => {
    // LIFT-1310: Settings told a guest their data was "Synced over encrypted
    // HTTPS" while it had never left the device. A sheet whose whole job is
    // answering "is my data safe?" must not repeat that.
    const wrapper = mountSheet({ localOnly: true, status: 'offline', pendingCount: 4 })
    expect(wrapper.find('.syncSheetSync').exists()).toBe(false)
    // The facts table is about an account this user does not have.
    expect(wrapper.find('.syncSheetFacts').exists()).toBe(false)
    expect(wrapper.text()).toContain('this device only')
  })

  it('closes from the button and the overlay backdrop', async () => {
    const wrapper = mountSheet()
    await wrapper.find('.syncSheetClose').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.find('.kbOverlay').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('closes on Escape', async () => {
    const wrapper = mountSheet()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('locks background scroll while open and releases it on close', async () => {
    const wrapper = mountSheet()
    expect(document.documentElement.classList.contains('modal-open')).toBe(true)
    wrapper.unmount()
    expect(document.documentElement.classList.contains('modal-open')).toBe(false)
  })

  it('has no axe violations', async () => {
    const wrapper = mount(SyncStatusSheet, {
      attachTo: document.body,
      props: {
        status: 'error' as SyncStatus,
        pendingCount: 2,
        strandedCount: 2,
        lastSyncedAt: Date.now() - 60_000,
        localOnly: false,
        busy: false,
      },
      global: { stubs: { Teleport: false } },
    })
    const dialog = document.querySelector('.syncSheet') as Element
    expect(dialog).toBeTruthy()
    const results = await runComponentAxe(dialog)
    expect(results).toHaveNoViolations()
    wrapper.unmount()
  })

  it('announces a changing status so a repeated failure is not silent', () => {
    // App.vue's global sync live region only speaks on a TRANSITION, so a retry
    // that fails the same way twice never reaches a screen reader through it.
    const detail = mountSheet().find('.syncSheetDetail')
    expect(detail.attributes('role')).toBe('status')
    expect(detail.attributes('aria-live')).toBe('polite')
  })
})
