/**
 * Regression: a bodyweight edit made on another device must survive this
 * device's next fetch (LIFT-1402).
 *
 * `mapRemoteBodyweightEntry` built the last-write-wins timestamp out of
 * `created_at`, which is `default now()` and never moves, while the local stamp
 * is rewritten by `updateEntry` on every correction. `mergeEntities` scores an
 * exact tie as a LOCAL win and `_fetchFromSupabase` re-pushes every local win,
 * so the remote side could not merely lose a close race — it could never win:
 *
 *   1. A and B both hold entry E. A's local stamp is the T0 it adopted from
 *      `created_at`.
 *   2. B corrects the weight. B's stamp becomes T1; the upsert writes `weight`
 *      and the server's trigger bumps `updated_at` to T1.
 *   3. A fetches. The mapper reads `created_at` → T0. Local T0 vs remote T0 →
 *      tie → A wins, keeps the WRONG weight, and re-upserts it. B's correction
 *      is gone from the server.
 *
 * These cases drive the real fetch pipeline with a server row whose two
 * timestamp columns DIFFER — the fixture shape no test in the suite had, which
 * is why the defect survived: every fixture built a freshly-inserted row where
 * `updated_at` and `created_at` coincide, and under that shape the buggy and
 * the fixed mapper agree.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

const { fakeSupabase } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('../../__tests__/fakeSupabase')
  return { fakeSupabase: createFakeSupabase({ mode: 'ok' }) }
})

vi.mock('../../lib/supabase', () => ({
  supabase: fakeSupabase,
  isPreviewMode: { value: false },
}))

const enqueue = vi.fn()
vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: (...args: unknown[]) => enqueue(...args), enqueueDelete: vi.fn(), clear: vi.fn() },
}))

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

import { useBodyweightStore, type BodyweightEntry } from '../bodyweight'

const USER = 'user-1402'
const DAY = '2026-08-12T23:59:30.000Z'

/** T0: the row was inserted. T1: device B corrected it. T2: a later local edit. */
const T0 = '2026-08-12T18:00:00.000Z'
const T1 = '2026-08-14T09:30:00.000Z'
const T2 = '2026-08-15T07:00:00.000Z'

/** A server row device B has already corrected — `updated_at` past `created_at`. */
function remoteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bw-1',
    user_id: USER,
    date: DAY,
    weight: 179,
    created_at: T0,
    updated_at: T1,
    deleted_at: null,
    ...overrides,
  }
}

/** This device's copy, stamped with whatever it last adopted. */
function localEntry(updatedAt: string, weight = 185): BodyweightEntry {
  return { id: 'bw-1', date: DAY, weight, updated_at: updatedAt }
}

/** Upserts this fetch enqueued for `id`, newest last. */
function upsertedWeights(id: string): unknown[] {
  return enqueue.mock.calls
    .filter(([key]) => key === `bodyweight:${id}`)
    .map(([, , descriptor]) => (descriptor as { row: { weight: number } }).row.weight)
}

describe('bodyweight merge reads updated_at, not created_at (LIFT-1402)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    fakeSupabase.reset()
    setActivePinia(createPinia())
    enqueue.mockClear()
  })

  it('guards the guard — the fixture really does carry two different stamps', () => {
    // If a future edit collapses these, every case below passes vacuously:
    // under `created_at === updated_at` the old mapper and the new one agree.
    const row = remoteRow()
    expect(row.created_at).not.toBe(row.updated_at)
    expect(new Date(row.updated_at).getTime()).toBeGreaterThan(new Date(row.created_at).getTime())
  })

  it("adopts another device's correction instead of reverting it", async () => {
    fakeSupabase.seed('bodyweight_entries', [remoteRow()])
    const store = useBodyweightStore()
    // A adopted T0 from `created_at` on an earlier fetch, before B's edit.
    store.entries = [localEntry(T0)]

    await store.init(USER)

    expect(store.entries).toHaveLength(1)
    expect(store.entries[0].weight).toBe(179)
    expect(store.entries[0].updated_at).toBe(T1)
  })

  it('does not re-upsert the stale weight over the correction', async () => {
    fakeSupabase.seed('bodyweight_entries', [remoteRow()])
    const store = useBodyweightStore()
    store.entries = [localEntry(T0)]

    await store.init(USER)

    // The revert was a WRITE, not just a bad local read: the losing device
    // pushed its stale copy straight back at the server.
    expect(upsertedWeights('bw-1')).toEqual([])
  })

  it('persists the adopted correction so a reload does not resurrect the stale weight', async () => {
    fakeSupabase.seed('bodyweight_entries', [remoteRow()])
    const store = useBodyweightStore()
    store.entries = [localEntry(T0)]

    await store.init(USER)
    store._reloadFromStorage()

    expect(store.entries[0].weight).toBe(179)
  })

  it('still lets a genuinely newer local edit win and pushes it', async () => {
    // The fix must not invert the rule: an offline correction made AFTER the
    // server's stamp is the one the user made last.
    fakeSupabase.seed('bodyweight_entries', [remoteRow()])
    const store = useBodyweightStore()
    store.entries = [localEntry(T2, 183)]

    await store.init(USER)

    expect(store.entries[0].weight).toBe(183)
    expect(upsertedWeights('bw-1')).toEqual([183])
  })

  it('still scores an exact tie as a local win', async () => {
    // Unchanged semantics — `mergeEntities` gives ties to local. What changed
    // is only WHICH column the remote side of that comparison comes from.
    fakeSupabase.seed('bodyweight_entries', [remoteRow()])
    const store = useBodyweightStore()
    store.entries = [localEntry(T1, 181)]

    await store.init(USER)

    expect(store.entries[0].weight).toBe(181)
    expect(upsertedWeights('bw-1')).toEqual([181])
  })

  it('falls back to created_at for a legacy row with no updated_at', async () => {
    // The column is NOT NULL today, but the fallback is what keeps a row
    // written before it existed from dropping out of the merge entirely.
    fakeSupabase.seed('bodyweight_entries', [remoteRow({ updated_at: null, weight: 179 })])
    const store = useBodyweightStore()
    store.entries = [localEntry(new Date(0).toISOString())]

    await store.init(USER)

    expect(store.entries[0].weight).toBe(179)
    expect(store.entries[0].updated_at).toBe(T0)
  })
})
