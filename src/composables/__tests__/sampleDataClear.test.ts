/**
 * Regression: clearing the onboarding sample data must never touch the user's
 * real data, on the device or on the server (LIFT-1527).
 *
 * The "Viewing sample data — Tap to clear and start fresh" banner called
 * `deleteExercise` on EVERY exercise and then the bodyweight store's
 * `clearAll`, with no confirmation and no undo. Both were sync-enabled, so one
 * tap soft-deleted on the server:
 *   - every exercise the user had created, with its sets;
 *   - a sample exercise the user's first real set had ADOPTED, which by then
 *     was on the server as real data, with that set;
 *   - every live bodyweight row on the account, weigh-ins logged on other
 *     devices included (`clearAll` matched on `user_id` alone).
 * And the banner kept saying "Viewing sample data" after all of that had become
 * real, because it read a localStorage flag that nothing retired: not
 * adoption, and not a sign-out, which wiped the stores while App.vue's copy of
 * the flag stayed up for the next account to sign in.
 *
 * Why the suite missed it: the only test of the clear used fake stores whose
 * `deleteExercise` and `clearAll` emptied in-memory arrays, and it asserted
 * that everything was gone. That pinned the defect as the expected behaviour.
 * No fixture ever put real data next to sample data, and nothing looked at the
 * server. These cases drive the real stores against `createFakeSupabase` with
 * a synchronous queue and assert on `fakeSupabase.tables`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick, effectScope, type EffectScope } from 'vue'
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

// Synchronous syncQueue: every enqueued write lands on the fake straight away,
// so the assertions read server state rather than a list of intentions.
vi.mock('../../lib/syncQueue', () => {
  const invoke = (_key: string, op: () => PromiseLike<unknown>) => {
    Promise.resolve(op()).catch(() => {})
  }
  return {
    syncQueue: { enqueue: vi.fn(invoke), enqueueDelete: vi.fn(invoke), clear: vi.fn() },
  }
})

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

import { useWorkoutStore } from '../../stores/workout'
import { useBodyweightStore } from '../../stores/bodyweight'
import { useOnboarding } from '../useOnboarding'
import { useUndoToast } from '../useUndoToast'
import { _resetTombstones } from '../../lib/tombstones'

const USER = 'user-1527'

/** Let the synchronous syncQueue's microtask chains settle. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

/** What the account already holds on the server, written from another device. */
function seedOtherDeviceData() {
  fakeSupabase.seed('exercises', [{
    id: 'pullup', user_id: USER, name: 'Pull-up', tags: [],
    created_at: '2026-09-01T10:00:00.000Z', updated_at: '2026-09-01T10:00:00.000Z', deleted_at: null,
  }])
  fakeSupabase.seed('sets', [0, 1].map(i => ({
    id: `pullup-set-${i}`, user_id: USER, exercise_id: 'pullup',
    date: `2026-09-01T23:59:3${i}.000Z`, weight: 0, reps: 10, estimated_1rm: 0,
    created_at: '2026-09-01T18:00:00.000Z', deleted_at: null,
  })))
  fakeSupabase.seed('bodyweight_entries', [0, 1].map(i => ({
    id: `other-device-bw-${i}`, user_id: USER, date: `2026-09-0${i + 2}T23:59:30.000Z`, weight: 182 - i,
    created_at: '2026-09-02T08:00:00.000Z', updated_at: '2026-09-02T08:00:00.000Z', deleted_at: null,
  })))
}

/** The calls `OnboardingScreen.seedSampleData` makes: everything `sync: false`. */
function seedSampleData() {
  const workout = useWorkoutStore()
  const bodyweight = useBodyweightStore()
  const noSync = { sync: false }
  const bench = workout.addExercise('Bench Press', ['Chest'], noSync)!
  workout.logSet(bench, 135, 5, '2026-08-01', noSync)
  workout.logSet(bench, 145, 5, '2026-08-08', noSync)
  const squat = workout.addExercise('Squat', ['Legs'], noSync)!
  workout.logSet(squat, 185, 5, '2026-08-02', noSync)
  workout.logSet(squat, 195, 5, '2026-08-09', noSync)
  workout.addExercise('Deadlift', ['Back'], noSync)
  bodyweight.addEntry(178, '2026-08-01', noSync)
  bodyweight.addEntry(177.5, '2026-08-08', noSync)
  localStorageMock.setItem('sample-data', 'true')
  return { bench, squat }
}

const liveIds = (table: string) =>
  fakeSupabase.tables[table].filter(r => r.deleted_at == null).map(r => r.id as string).sort()

const serverSnapshot = () => ({
  exercises: liveIds('exercises'),
  sets: liveIds('sets'),
  bodyweight_entries: liveIds('bodyweight_entries'),
})

describe('clearing the sample data keeps every real row (LIFT-1527)', () => {
  let scope: EffectScope

  beforeEach(async () => {
    localStorageMock.clear()
    _resetTombstones()
    fakeSupabase.reset()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    scope = effectScope()

    seedOtherDeviceData()
    await useWorkoutStore().init(USER)
    await useBodyweightStore().init(USER)
  })

  afterEach(() => {
    scope.stop()
    useUndoToast().destroy()
  })

  /**
   * An explorer who has started training for real: one real set on a sample
   * exercise (adopting it), an exercise of their own, and a weigh-in.
   */
  async function explorerWhoStartedTraining() {
    const workout = useWorkoutStore()
    const bodyweight = useBodyweightStore()
    const { squat } = seedSampleData()
    workout.logSet(squat, 205, 3)
    const curl = workout.addExercise('Curl')!
    workout.logSet(curl, 30, 10)
    bodyweight.addEntry(181, '2026-09-29')
    await flush()
    const onboarding = scope.run(() =>
      useOnboarding({ workoutStore: workout, bodyweightStore: bodyweight }),
    )!
    return { onboarding, squat }
  }

  it('sends nothing to the server and leaves every live row live', async () => {
    const { onboarding } = await explorerWhoStartedTraining()
    expect(onboarding.hasSampleData.value).toBe(true)
    const before = serverSnapshot()
    // Non-vacuity: the account really holds the other device's rows, the
    // adopted exercise with its sets, and the user's own exercise and weigh-in.
    expect(before.exercises).toHaveLength(3)
    expect(before.bodyweight_entries).toHaveLength(3)
    const callsBefore = fakeSupabase.calls.length

    onboarding.clearSampleData()
    await flush()

    expect(fakeSupabase.calls.length).toBe(callsBefore)
    expect(serverSnapshot()).toEqual(before)
  })

  it('removes the sample rows on this device and keeps the real ones', async () => {
    const workout = useWorkoutStore()
    const bodyweight = useBodyweightStore()
    const { onboarding, squat } = await explorerWhoStartedTraining()

    onboarding.clearSampleData()
    await nextTick()

    expect(workout.exercises.map(e => e.name).sort()).toEqual(['Curl', 'Pull-up', 'Squat'])
    // The adopted exercise keeps everything it holds, the user's set included.
    expect(workout.exercises.find(e => e.id === squat)!.sets).toHaveLength(3)
    expect(bodyweight.entries.some(e => e.sample)).toBe(false)
    expect(bodyweight.entries.map(e => e.weight).sort()).toEqual([181, 181, 182])
    expect(onboarding.hasSampleData.value).toBe(false)
    expect(localStorageMock.getItem('sample-data')).toBeNull()
    // Persisted, so a relaunch does not bring the sample data back.
    const persisted = JSON.parse(localStorageMock.getItem('workout-exercises')!) as { name: string }[]
    expect(persisted.map(e => e.name).sort()).toEqual(['Curl', 'Pull-up', 'Squat'])
  })

  it('stays cleared through the next sync: nothing on the server to bring it back', async () => {
    const workout = useWorkoutStore()
    const bodyweight = useBodyweightStore()
    const { onboarding } = await explorerWhoStartedTraining()
    onboarding.clearSampleData()
    const before = serverSnapshot()

    await workout._fetchFromSupabase()
    await bodyweight._fetchFromSupabase()
    await flush()

    expect(workout.exercises.some(e => e.sample)).toBe(false)
    expect(workout.exercises.map(e => e.name)).not.toContain('Bench Press')
    expect(bodyweight.entries.some(e => e.sample)).toBe(false)
    expect(serverSnapshot()).toEqual(before)
  })

  it('undo restores the sample data on this device only', async () => {
    const workout = useWorkoutStore()
    const bodyweight = useBodyweightStore()
    const { onboarding } = await explorerWhoStartedTraining()
    const exerciseOrder = workout.exercises.map(e => e.id)
    const before = serverSnapshot()
    const callsBefore = fakeSupabase.calls.length

    onboarding.clearSampleData()
    useUndoToast().performUndo()
    await flush()

    expect(workout.exercises.map(e => e.id)).toEqual(exerciseOrder)
    expect(workout.exercises.filter(e => e.sample).map(e => e.name).sort()).toEqual(['Bench Press', 'Deadlift'])
    expect(bodyweight.entries.filter(e => e.sample)).toHaveLength(2)
    expect(onboarding.hasSampleData.value).toBe(true)
    expect(localStorageMock.getItem('sample-data')).toBe('true')
    expect(fakeSupabase.calls.length).toBe(callsBefore)
    expect(serverSnapshot()).toEqual(before)
  })

  it('after a sign-out, the next sign-in sees no banner and the clear cannot reach its rows', async () => {
    const workout = useWorkoutStore()
    const bodyweight = useBodyweightStore()
    const { onboarding } = await explorerWhoStartedTraining()

    // useAuth.resetStores(): the stores are wiped and App.vue stays mounted.
    workout.$reset()
    bodyweight.$reset()
    await nextTick()
    expect(onboarding.hasSampleData.value).toBe(false)
    expect(localStorageMock.getItem('sample-data')).toBeNull()

    await workout.init(USER)
    await bodyweight.init(USER)
    const before = serverSnapshot()
    expect(before.exercises.length).toBeGreaterThan(0)
    const callsBefore = fakeSupabase.calls.length

    expect(onboarding.hasSampleData.value).toBe(false)
    onboarding.clearSampleData()
    await flush()

    expect(fakeSupabase.calls.length).toBe(callsBefore)
    expect(serverSnapshot()).toEqual(before)
  })
})
