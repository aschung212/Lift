/**
 * Integration test: workout store $reset works on a real Pinia instance.
 *
 * Regression for #500: the workout store uses the composition/setup API,
 * which means Pinia does NOT auto-generate $reset(). Without a manual
 * override, $reset() throws at runtime, causing sign-out to silently
 * fail to clear workout data — a privacy/security issue.
 *
 * The useAuth.test.ts mocks $reset as vi.fn(), which masked this bug.
 * This test uses a real Pinia instance to verify $reset actually clears state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../lib/supabase', () => ({
  supabase: null,
  isPreviewMode: { value: false },
}))
vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn(), clear: vi.fn() },
}))
vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
}))

describe('workout store $reset (real Pinia, not mocked)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  it('$reset exists and is callable on the setup store', async () => {
    const { useWorkoutStore } = await import('../workout')
    const store = useWorkoutStore()
    expect(typeof store.$reset).toBe('function')
  })

  it('$reset clears exercises, custom tags, and recovery settings', async () => {
    const { useWorkoutStore } = await import('../workout')
    const store = useWorkoutStore()

    // Populate state
    store.addExercise('Bench Press', ['Push'])
    store.addCustomTag('Upper Body')
    store.setTagRecoveryDays('Push', 3)
    store.setTagRecoveryExcluded('Push', true)

    expect(store.exercises.length).toBeGreaterThan(0)
    expect(store.customTags.length).toBeGreaterThan(0)
    expect(Object.keys(store.tagRecoveryDays).length).toBeGreaterThan(0)
    expect(store.tagRecoveryExcluded.length).toBeGreaterThan(0)

    // Reset
    store.$reset()

    expect(store.exercises).toEqual([])
    expect(store.customTags).toEqual([])
    expect(store.tagRecoveryDays).toEqual({})
    expect(store.tagRecoveryExcluded).toEqual([])
  })

  it('$reset persists the cleared state to localStorage', async () => {
    const { useWorkoutStore } = await import('../workout')
    const store = useWorkoutStore()

    store.addExercise('Squat', ['Legs'])
    expect(JSON.parse(localStorage.getItem('workout-exercises') || '[]').length).toBeGreaterThan(0)

    store.$reset()

    expect(JSON.parse(localStorage.getItem('workout-exercises') || '[]')).toEqual([])
    expect(JSON.parse(localStorage.getItem('lift-custom-tags') || '[]')).toEqual([])
    expect(JSON.parse(localStorage.getItem('lift-tag-recovery-days') || '{}')).toEqual({})
    expect(JSON.parse(localStorage.getItem('lift-tag-recovery-excluded') || '[]')).toEqual([])
  })

  it('$reset does not throw (unlike the default Pinia setup store $reset)', async () => {
    const { useWorkoutStore } = await import('../workout')
    const store = useWorkoutStore()

    expect(() => store.$reset()).not.toThrow()
  })

  // Pinia compiles a setup store's BUILT-IN $reset to a silent no-op in
  // production builds (it only throws under dev NODE_ENV), so if the custom
  // override ever stopped being returned — or stopped winning over the
  // built-in after a Pinia major bump — every other test in this file would
  // still fail loudly in CI (dev semantics: throw) while production leaked
  // silently. This test runs the real store under production NODE_ENV
  // (Pinia reads it at store creation) so the exact shipped failure mode is
  // exercised: a no-op $reset fails the cleared-state assertions here.
  describe('production NODE_ENV semantics', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('$reset clears hydrated state and sync-status fields under a production build', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      setActivePinia(createPinia())
      const { useWorkoutStore } = await import('../workout')
      const store = useWorkoutStore()

      const id = store.addExercise('Bench Press', ['Push'])!
      store.logSet(id, 225, 5)
      store.addCustomTag('Upper Body')
      store.syncing = true
      store.lastSyncError = 'network'
      expect(store.exercises.length).toBe(1)
      expect(store.exercises[0].sets.length).toBe(1)

      store.$reset()

      expect(store.exercises).toEqual([])
      expect(store.customTags).toEqual([])
      expect(store.syncing).toBe(false)
      expect(store.lastSyncError).toBeNull()
      // The persisted payload is wiped too — this is what the next sign-in's
      // migrateLocalStorageToSupabase would otherwise push into a fresh account.
      expect(JSON.parse(localStorage.getItem('workout-exercises') || 'null')).toEqual([])
    })
  })
})
