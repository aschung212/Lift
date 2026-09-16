/**
 * The sheet behind the sync indicator (LIFT-1323).
 *
 * The indicator used to be an icon-only `<span>` whose only explanation was a
 * `:title` tooltip — so on iOS, the app's most consequential failure state had
 * no explanation at all and no way to act on it. This is the surface that
 * answers all four questions a user has when sync breaks: what happened, is my
 * data safe, how much is unsent, and can I retry.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { reactive, nextTick } from 'vue'

const { stores } = vi.hoisted(() => ({
  stores: {
    workout: { lastSyncError: null as string | null },
    bodyweight: { lastSyncError: null as string | null },
    preferences: { lastSyncError: null as string | null },
    progression: { lastSyncError: null as string | null },
  },
}))
const reactiveStores = reactive(stores)

vi.mock('../../stores/workout', () => ({ useWorkoutStore: () => reactiveStores.workout }))
vi.mock('../../stores/bodyweight', () => ({ useBodyweightStore: () => reactiveStores.bodyweight }))
vi.mock('../../stores/preferences', () => ({ usePreferencesStore: () => reactiveStores.preferences }))
vi.mock('../../stores/progression', () => ({ useProgressionStore: () => reactiveStores.progression }))

const refetchAllStores = vi.fn(async () => true)
vi.mock('../../composables/useSyncRecovery', () => ({
  refetchAllStores: (...args: unknown[]) => refetchAllStores(...(args as [])),
}))

vi.mock('../../lib/supabase', () => ({ supabase: {}, isPreviewMode: { value: false } }))
vi.mock('../../lib/crossTabSync', () => ({ broadcastSyncStatus: vi.fn() }))
vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
  restoreFromIDB: vi.fn(async () => null),
}))

import SyncStatusSheet from '../SyncStatusSheet.vue'
import { syncStatus } from '../../lib/syncQueue'
import { publishSyncQueueStats, resetSyncQueueStats } from '../../lib/syncActivity'
import { _resetSyncStatus } from '../../composables/useSyncStatus'
import { runComponentAxe } from '../../__tests__/axeHelper'

enableAutoUnmount(afterEach)

function mountSheet() {
  return mount(SyncStatusSheet, {
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

describe('SyncStatusSheet', () => {
  beforeEach(() => {
    _resetSyncStatus()
    resetSyncQueueStats()
    syncStatus.value = 'synced'
    setOnline(true)
    for (const key of ['workout', 'bodyweight', 'preferences', 'progression'] as const) {
      reactiveStores[key].lastSyncError = null
    }
    refetchAllStores.mockClear()
    refetchAllStores.mockResolvedValue(true)
  })

  afterEach(() => {
    _resetSyncStatus()
    document.documentElement.classList.remove('modal-open')
    setOnline(true)
  })

  it('explains an offline state in plain language, without implying data loss', async () => {
    syncStatus.value = 'offline'
    const w = mountSheet()
    await nextTick()

    expect(w.find('.syncSheetTitle').text()).toBe('Offline')
    expect(w.find('.syncSheetDetail').text()).toContain('saved on this device')
  })

  it('reports the number of unsent changes', async () => {
    syncStatus.value = 'error'
    publishSyncQueueStats({ pending: 1, journaled: 3, stranded: 2 })
    const w = mountSheet()
    await nextTick()

    expect(w.find('.syncSheetFactValue').text()).toBe('3 changes')
  })

  it('singularises a lone unsent change', async () => {
    syncStatus.value = 'error'
    publishSyncQueueStats({ pending: 0, journaled: 1, stranded: 1 })
    const w = mountSheet()
    await nextTick()

    expect(w.find('.syncSheetFactValue').text()).toBe('1 change')
  })

  // "Last synced 6 hours ago" on a healthy app that has simply been idle reads
  // as broken — the stamp only moves when the status transitions.
  it('says "Up to date" rather than an age while everything agrees', async () => {
    const w = mountSheet()
    await nextTick()

    expect(w.findAll('.syncSheetFactValue')[1].text()).toBe('Up to date')
  })

  it('runs the manual recovery and reports success', async () => {
    syncStatus.value = 'error'
    refetchAllStores.mockImplementation(async () => {
      syncStatus.value = 'synced'
      return true
    })
    const w = mountSheet()
    await nextTick()

    await w.find('.syncSheetRetry').trigger('click')
    await nextTick()

    expect(refetchAllStores).toHaveBeenCalledWith('manual')
    expect(w.find('.syncSheetResult').text()).toBe('All changes synced.')
  })

  // A retry that changed nothing must say so; silently returning to the same
  // screen is what made the original indicator untrustworthy.
  it('says the retry did not work rather than silently succeeding', async () => {
    syncStatus.value = 'error'
    // A still-unsent change is what makes the failure real — with the queue
    // empty and the reads clean, the retry would correctly retire the label.
    publishSyncQueueStats({ pending: 0, journaled: 1, stranded: 1 })
    const w = mountSheet()
    await nextTick()

    await w.find('.syncSheetRetry').trigger('click')
    await nextTick()

    expect(w.find('.syncSheetResult').text()).toContain('Still could not sync')
  })

  it('disables the retry button while a retry is in flight', async () => {
    syncStatus.value = 'error'
    let release: (v: boolean) => void = () => {}
    refetchAllStores.mockImplementation(() => new Promise<boolean>((res) => { release = res }))
    const w = mountSheet()
    await nextTick()

    await w.find('.syncSheetRetry').trigger('click')
    await nextTick()
    expect(w.find('.syncSheetRetry').attributes('disabled')).toBeDefined()

    release(true)
    await nextTick()
    await nextTick()
    expect(w.find('.syncSheetRetry').attributes('disabled')).toBeUndefined()
  })

  it('emits close from the Close button, the backdrop and Escape', async () => {
    syncStatus.value = 'error'
    const w = mountSheet()
    await nextTick()

    await w.find('.syncSheetClose').trigger('click')
    await w.find('.kbOverlay').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(w.emitted('close')).toHaveLength(3)
  })

  // Mandatory, not cosmetic: a position:fixed overlay whose background still
  // scrolls desyncs paint from hit-testing once the iOS keyboard opens.
  it('locks background scroll while open and releases it on unmount', async () => {
    syncStatus.value = 'error'
    const w = mountSheet()
    await nextTick()
    expect(document.documentElement.classList.contains('modal-open')).toBe(true)

    w.unmount()
    expect(document.documentElement.classList.contains('modal-open')).toBe(false)
  })

  it('is a labelled modal dialog with no axe violations', async () => {
    syncStatus.value = 'error'
    const w = mountSheet()
    await nextTick()

    const dialog = w.find('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBe('syncSheetTitle')
    const results = await runComponentAxe(w.element)
    expect(results).toHaveNoViolations()
  })
})
