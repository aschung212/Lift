/**
 * End-to-end sign-out teardown against REAL stores on a REAL Pinia instance.
 *
 * useAuth.test.ts mocks every store module ($reset is a vi.fn()), so it can
 * only prove that resetStores() CALLS $reset — not that $reset does anything.
 * That gap is exactly how a broken reset ships: Pinia's built-in $reset is a
 * silent no-op in production for setup stores and a state()-factory re-run
 * for options stores (which re-hydrates the signed-out user's data from
 * localStorage in this codebase). This suite runs the manual signOut() path
 * (shared with the automatic SIGNED_OUT teardown via teardownSession,
 * LIFT-1133) through the real store implementations, under production
 * NODE_ENV semantics, and asserts the post-condition that matters on a
 * shared device: no store — memory or persisted payload — still holds the
 * previous user's data. It also covers the transient XP-ceremony UI, which
 * lives OUTSIDE Pinia (LIFT-823/1181) and is only cleared if the teardown
 * explicitly calls resetXPCeremony.
 *
 * Only module boundaries are mocked: the Supabase client (null — the app is
 * local-first and fully functional without it), the sync queue, and the IDB
 * mirror. The stores, useAuth, and the migration module are real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// Needed by useTheme, which useAuth imports transitively.
vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})))

vi.mock('../../lib/supabase', () => ({
  supabase: null,
  isPreviewMode: { value: false },
}))
vi.mock('../../lib/syncQueue', () => ({
  syncQueue: {
    enqueue: vi.fn(),
    enqueueDelete: vi.fn(),
    clear: vi.fn(),
    rehydrate: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
  closeDB: vi.fn(),
}))

describe('signOut() with real stores (no store mocks)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    // Pinia branches on NODE_ENV at store creation; production is where a
    // missing/broken $reset fails SILENTLY instead of throwing, so the whole
    // flow runs under production semantics.
    vi.stubEnv('NODE_ENV', 'production')
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('wipes every store and its persisted payload on sign-out', async () => {
    const { useAuth } = await import('../useAuth')
    const { useWorkoutStore } = await import('../../stores/workout')
    const { useBodyweightStore } = await import('../../stores/bodyweight')
    const { useProgressionStore } = await import('../../stores/progression')
    const { usePreferencesStore } = await import('../../stores/preferences')

    const auth = useAuth()
    await auth.devSignIn()
    expect(auth.user.value).not.toBeNull()

    // Hydrate all four stores through real actions, as a session would.
    const workout = useWorkoutStore()
    const exerciseId = workout.addExercise('Bench Press', ['Push'])!
    workout.logSet(exerciseId, 225, 5)
    workout.addCustomTag('Upper Body')
    workout.setTagRecoveryDays('Push', 3)

    const bodyweight = useBodyweightStore()
    bodyweight.addEntry(185.5, '2026-08-15')

    const progression = useProgressionStore()
    progression.logSetXP('set-1', 50)

    const preferences = usePreferencesStore()
    preferences.setTheme('fire')
    preferences.setCoachProfile({ age: 31, injuries: 'shoulder impingement' })

    // Sanity: hydrated in memory and persisted, like a real session.
    expect(workout.exercises.length).toBe(1)
    expect(bodyweight.entries.length).toBe(1)
    expect(progression.totalXP).toBe(50)
    expect(preferences.coachProfile.age).toBe(31)
    expect(JSON.parse(localStorage.getItem('workout-exercises')!).length).toBe(1)
    expect(JSON.parse(localStorage.getItem('bodyweight-entries')!).length).toBe(1)

    await auth.signOut()
    expect(auth.user.value).toBeNull()

    // In-memory state: wiped for every store.
    expect(workout.exercises).toEqual([])
    expect(workout.customTags).toEqual([])
    expect(workout.tagRecoveryDays).toEqual({})
    expect(bodyweight.entries).toEqual([])
    expect(progression.totalXP).toBe(0)
    expect(progression.xpPerSet).toEqual({})
    expect(preferences.theme).toBe('eternal')
    expect(preferences.coachProfile.age).toBeNull()
    expect(preferences.coachProfile.injuries).toBe('')

    // Persisted payloads: wiped too. These are what the NEXT sign-in on this
    // device would migrate (bodyweight → migrateLocalStorageToSupabase) or
    // re-hydrate (preferences init "loads from localStorage first") into the
    // new user's session and cloud rows.
    expect(JSON.parse(localStorage.getItem('workout-exercises')!)).toEqual([])
    expect(JSON.parse(localStorage.getItem('bodyweight-entries')!)).toEqual([])
    expect(JSON.parse(localStorage.getItem('user-progression')!).totalXP).toBe(0)
    const prefsPayload = JSON.parse(localStorage.getItem('user-preferences')!)
    expect(prefsPayload.theme).toBe('eternal')
    expect(prefsPayload.coachProfile.age).toBeNull()
  })

  it('clears the transient XP-ceremony UI (toast + celebration + timer) on sign-out', async () => {
    const { useAuth } = await import('../useAuth')
    const { xpToast, unlockCelebration, showXPToast, showUnlockCelebration } =
      await import('../xpCeremonyUI')

    const auth = useAuth()
    await auth.devSignIn()

    // Arm a visible toast (which starts its auto-dismiss timer) and a visible
    // unlock celebration, as the ceremony pipeline would mid-session.
    showXPToast('+100 XP', 42, 1234, 5000)
    showUnlockCelebration('fire', 'Intensity')
    expect(xpToast.visible).toBe(true)
    expect(xpToast._timer).not.toBeNull()
    expect(unlockCelebration.visible).toBe(true)

    await auth.signOut()

    // The XP ceremony lives OUTSIDE Pinia (LIFT-823), so it is only cleared if
    // the sign-out teardown explicitly calls resetXPCeremony via resetStores.
    // This proves the wiring end-to-end — the unit test can only prove the
    // reset function works in isolation, not that sign-out invokes it. A stale
    // toast/celebration surviving here would carry the previous user's PR
    // celebration onto the next account on a shared device.
    expect(xpToast.visible).toBe(false)
    expect(xpToast.text).toBe('')
    expect(unlockCelebration.visible).toBe(false)
    expect(unlockCelebration.themeId).toBeNull()
    // The auto-dismiss timer must be cancelled too, so a leaked setTimeout can't
    // fire against the next user's session.
    expect(xpToast._timer).toBeNull()
  })

  it('a sign-in after sign-out starts from clean stores (shared-device handoff)', async () => {
    const { useAuth } = await import('../useAuth')
    const { useBodyweightStore } = await import('../../stores/bodyweight')
    const { usePreferencesStore } = await import('../../stores/preferences')

    const auth = useAuth()

    // User A's session.
    await auth.devSignIn()
    const bodyweight = useBodyweightStore()
    const preferences = usePreferencesStore()
    bodyweight.addEntry(185.5, '2026-08-15')
    preferences.setCoachProfile({ age: 31 })
    await auth.signOut()

    // User B's session on the same device (same Pinia — the app does not
    // reload between sessions). init() re-runs the hydration paths that used
    // to resurrect A's data from the surviving localStorage payloads.
    await auth.devSignIn()

    expect(bodyweight.entries).toEqual([])
    expect(preferences.coachProfile.age).toBeNull()
  })
})
