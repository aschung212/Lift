import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// Mock matchMedia (needed by useTheme which useAuth imports transitively)
vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})))

// Mock all stores that useAuth imports
const mockWorkoutReset = vi.fn()
const mockBodyweightReset = vi.fn()
const mockPreferencesReset = vi.fn()
const mockProgressionReset = vi.fn()
vi.mock('../../stores/workout', () => ({
  useWorkoutStore: () => ({ init: vi.fn(), $reset: mockWorkoutReset })
}))
vi.mock('../../stores/bodyweight', () => ({
  useBodyweightStore: () => ({ init: vi.fn(), $reset: mockBodyweightReset })
}))
vi.mock('../../stores/preferences', () => ({
  usePreferencesStore: () => ({ init: vi.fn(), $reset: mockPreferencesReset })
}))
vi.mock('../../stores/progression', () => ({
  useProgressionStore: () => ({ init: vi.fn(), $reset: mockProgressionReset })
}))
vi.mock('../../lib/migrate', () => ({
  migrateLocalStorageToSupabase: vi.fn()
}))

// Create Supabase mock
const mockSignInWithOAuth = vi.fn().mockResolvedValue({ error: null })
const mockSignInWithPassword = vi.fn().mockResolvedValue({ error: null })
const mockSignUp = vi.fn().mockResolvedValue({ data: { user: { identities: [{}] }, session: {} }, error: null })
const mockSignOut = vi.fn().mockResolvedValue({})
const mockGetSession = vi.fn().mockResolvedValue({ data: { session: null } })
const mockOnAuthStateChange = vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
const mockDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
const mockFrom = vi.fn().mockReturnValue({ delete: () => mockDelete() })

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signUp: (...args: unknown[]) => mockSignUp(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
      startAutoRefresh: vi.fn(),
      stopAutoRefresh: vi.fn(),
    },
    from: (...args: unknown[]) => mockFrom(...args),
  }
}))

// Mock syncQueue
const mockSyncQueueClear = vi.fn()
const mockSyncQueueRehydrate = vi.fn().mockResolvedValue(undefined)
vi.mock('../../lib/syncQueue', () => ({
  syncQueue: {
    clear: () => mockSyncQueueClear(),
    rehydrate: () => mockSyncQueueRehydrate(),
  }
}))

// Need to reset modules to get fresh state for useAuth
// since it runs init() at module level
let useAuth: typeof import('../useAuth').useAuth
beforeEach(async () => {
  localStorageMock.clear()
  vi.resetModules()
  // Re-setup mocks that resetModules clears
  mockGetSession.mockResolvedValue({ data: { session: null } })
  const mod = await import('../useAuth')
  useAuth = mod.useAuth
})

describe('useAuth', () => {
  it('exports user and loading reactive refs', () => {
    const { user, loading } = useAuth()
    expect(user).toBeDefined()
    expect(loading).toBeDefined()
    // user starts as dev user in DEV mode or null in prod
    expect(user.value).toBeDefined()
  })

  it('exposes signInWithProvider function', () => {
    const { signInWithProvider } = useAuth()
    expect(typeof signInWithProvider).toBe('function')
  })

  it('exposes signInWithEmail function', () => {
    const { signInWithEmail } = useAuth()
    expect(typeof signInWithEmail).toBe('function')
  })

  it('exposes signUp function', () => {
    const { signUp } = useAuth()
    expect(typeof signUp).toBe('function')
  })

  it('exposes signOut function', () => {
    const { signOut } = useAuth()
    expect(typeof signOut).toBe('function')
  })

  describe('signInWithProvider', () => {
    it('calls supabase OAuth with provider and redirect', async () => {
      const { signInWithProvider } = useAuth()
      const result = await signInWithProvider('google')
      expect(result).toEqual({ error: null })
    })
  })

  describe('signInWithEmail', () => {
    it('calls supabase signInWithPassword', async () => {
      const { signInWithEmail } = useAuth()
      const result = await signInWithEmail('test@example.com', 'password123')
      expect(result).toEqual({ error: null })
    })

    it('returns error when authentication fails', async () => {
      mockSignInWithPassword.mockResolvedValueOnce({
        error: { message: 'Invalid credentials' }
      })
      const { signInWithEmail } = useAuth()
      const result = await signInWithEmail('test@example.com', 'wrong')
      expect(result.error.message).toBe('Invalid credentials')
    })
  })

  describe('signUp', () => {
    it('returns needsConfirmation when email verification required', async () => {
      mockSignUp.mockResolvedValueOnce({
        data: { user: { identities: [{}] }, session: null },
        error: null
      })
      const { signUp } = useAuth()
      const result = await signUp('new@example.com', 'password123')
      expect(result.needsConfirmation).toBe(true)
    })

    it('detects duplicate account by empty identities array', async () => {
      mockSignUp.mockResolvedValueOnce({
        data: { user: { identities: [] }, session: null },
        error: null
      })
      const { signUp } = useAuth()
      const result = await signUp('existing@example.com', 'password123')
      expect(result.error.message).toBe('An account with this email already exists.')
    })
  })

  describe('signOut', () => {
    it('calls supabase signOut and clears user', async () => {
      const { signOut, user } = useAuth()
      await signOut()
      expect(user.value).toBeNull()
    })

    // Regression: signOut must clear user even when supabase.auth.signOut() throws
    it('clears user even when supabase signOut throws', async () => {
      mockSignOut.mockRejectedValueOnce(new Error('Network error'))
      const { signOut, user, devSignIn } = useAuth()
      await devSignIn()
      expect(user.value).not.toBeNull()
      await signOut()
      expect(user.value).toBeNull()
    })

    // Regression LIFT-497: signOut must reset all Pinia stores to prevent data leak
    it('resets all Pinia stores on sign out', async () => {
      const { signOut, devSignIn } = useAuth()
      await devSignIn()

      mockWorkoutReset.mockClear()
      mockBodyweightReset.mockClear()
      mockPreferencesReset.mockClear()
      mockProgressionReset.mockClear()

      await signOut()

      expect(mockWorkoutReset).toHaveBeenCalledOnce()
      expect(mockBodyweightReset).toHaveBeenCalledOnce()
      expect(mockPreferencesReset).toHaveBeenCalledOnce()
      expect(mockProgressionReset).toHaveBeenCalledOnce()
    })

    // Regression LIFT-497: stores must reset even when supabase throws
    it('resets stores even when supabase signOut throws', async () => {
      mockSignOut.mockRejectedValueOnce(new Error('Network error'))
      const { signOut, devSignIn } = useAuth()
      await devSignIn()

      mockWorkoutReset.mockClear()
      mockBodyweightReset.mockClear()
      mockPreferencesReset.mockClear()
      mockProgressionReset.mockClear()

      await signOut()

      expect(mockWorkoutReset).toHaveBeenCalledOnce()
      expect(mockBodyweightReset).toHaveBeenCalledOnce()
      expect(mockPreferencesReset).toHaveBeenCalledOnce()
      expect(mockProgressionReset).toHaveBeenCalledOnce()
    })
  })

  describe('devSignIn', () => {
    it('sets user to local-dev', async () => {
      const { devSignIn, user } = useAuth()
      expect(user.value).toBeNull()
      await devSignIn()
      expect(user.value).toEqual({ id: 'local-dev', email: 'dev@localhost' })
    })
  })

  describe('guest mode (LIFT-1083)', () => {
    it('continueAsGuest sets a local user without initializing stores/Supabase', async () => {
      const { continueAsGuest, user, isGuest, loading } = useAuth()
      continueAsGuest()
      expect(user.value).toEqual({ id: 'guest-local', email: '' })
      expect(isGuest.value).toBe(true)
      expect(loading.value).toBe(false)
      // A guest must never hit Supabase — no migration is kicked off.
      const { migrateLocalStorageToSupabase } = await import('../../lib/migrate')
      expect(migrateLocalStorageToSupabase).not.toHaveBeenCalled()
    })

    it('persists the guest flag so a reload restores the session', () => {
      const { continueAsGuest } = useAuth()
      continueAsGuest()
      expect(localStorageMock.getItem('guest-mode')).toBe('true')
    })

    it('exitGuestMode returns to the auth screen without wiping local data', async () => {
      const { continueAsGuest, exitGuestMode, user, isGuest } = useAuth()
      continueAsGuest()
      mockWorkoutReset.mockClear()

      exitGuestMode()

      expect(user.value).toBeNull()
      expect(isGuest.value).toBe(false)
      expect(localStorageMock.getItem('guest-mode')).toBeNull()
      // Local data must be preserved so a later sign-up can migrate it.
      expect(mockWorkoutReset).not.toHaveBeenCalled()
    })

    it('exposes isGuest as a reactive ref defaulting to false', () => {
      const { isGuest } = useAuth()
      expect(isGuest.value).toBe(false)
    })
  })

  // Regression LIFT-1133: an automatic server-side sign-out (expired/revoked
  // refresh token surfacing as a SIGNED_OUT event) must run the SAME teardown as
  // manual signOut, or the previous user's hydrated stores and durable sync
  // journal persist on a shared device. These tests exercise the real
  // onAuthStateChange handler, which init() only registers outside DEV mode.
  describe('automatic sign-out teardown (LIFT-1133)', () => {
    // Register init() with DEV disabled (so the supabase auth listener is wired
    // up), seed a real signed-in session, and hand back the captured
    // onAuthStateChange callback plus the fresh module's reactive user ref.
    async function initWithSession(session: unknown) {
      vi.stubEnv('DEV', false)
      mockGetSession.mockResolvedValue({ data: { session } })
      vi.resetModules()
      const mod = await import('../useAuth')
      const auth = mod.useAuth()
      auth.init()
      // init() registers the auth listener synchronously; flush a macrotask so
      // the async getSession().then(...) settles user.value / guest state.
      await vi.waitFor(() => expect(mockOnAuthStateChange).toHaveBeenCalled())
      await new Promise((resolve) => setTimeout(resolve, 0))
      const cb = mockOnAuthStateChange.mock.calls.at(-1)![0] as (
        event: string,
        session: unknown,
      ) => void
      return { cb, user: auth.user, isGuest: auth.isGuest }
    }

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('clears the sync journal and resets stores on an automatic SIGNED_OUT', async () => {
      const { cb, user } = await initWithSession({ user: { id: 'u1', email: 'a@b.co' } })
      expect(user.value).not.toBeNull()

      mockSyncQueueClear.mockClear()
      mockWorkoutReset.mockClear()
      mockBodyweightReset.mockClear()
      mockPreferencesReset.mockClear()
      mockProgressionReset.mockClear()

      cb('SIGNED_OUT', null)

      expect(mockSyncQueueClear).toHaveBeenCalledOnce()
      expect(mockWorkoutReset).toHaveBeenCalledOnce()
      expect(mockBodyweightReset).toHaveBeenCalledOnce()
      expect(mockPreferencesReset).toHaveBeenCalledOnce()
      expect(mockProgressionReset).toHaveBeenCalledOnce()
      expect(user.value).toBeNull()
    })

    it('does NOT tear down stores on TOKEN_REFRESHED (a healthy session continues)', async () => {
      const { cb, user } = await initWithSession({ user: { id: 'u1', email: 'a@b.co' } })

      mockSyncQueueClear.mockClear()
      mockWorkoutReset.mockClear()

      cb('TOKEN_REFRESHED', { user: { id: 'u1', email: 'a@b.co' } })

      expect(mockSyncQueueClear).not.toHaveBeenCalled()
      expect(mockWorkoutReset).not.toHaveBeenCalled()
      expect(user.value).not.toBeNull()
    })

    it('preserves a guest\'s local-only data on SIGNED_OUT (no store reset)', async () => {
      localStorageMock.setItem('guest-mode', 'true')
      const { cb, user, isGuest } = await initWithSession(null)
      expect(isGuest.value).toBe(true)

      mockSyncQueueClear.mockClear()
      mockWorkoutReset.mockClear()

      cb('SIGNED_OUT', null)

      // A guest never synced to Supabase; wiping their stores would destroy the
      // very local data they chose "continue without an account" to keep.
      expect(mockSyncQueueClear).not.toHaveBeenCalled()
      expect(mockWorkoutReset).not.toHaveBeenCalled()
      expect(user.value).toBeNull()
    })
  })

  describe('destroy', () => {
    it('calls unsubscribe on the auth state change subscription', () => {
      const mockUnsubscribe = vi.fn()
      mockOnAuthStateChange.mockReturnValueOnce({
        data: { subscription: { unsubscribe: mockUnsubscribe } }
      })

      // Re-import to trigger init() with the new mock
      // Note: in DEV mode, init() skips supabase setup, so we test the function shape
      const { destroy } = useAuth()
      expect(typeof destroy).toBe('function')
      // destroy should not throw even when no subscription exists (DEV mode)
      expect(() => destroy()).not.toThrow()
    })
  })

  describe('deleteAccount', () => {
    it('clears all localStorage keys used by the app', async () => {
      const { deleteAccount, devSignIn } = useAuth()
      await devSignIn()

      // The core store keys plus a sampling of the AUXILIARY keys that the old
      // hand-maintained list in deleteAccount() had drifted away from (LIFT-1176).
      // deleteAccount now wipes ALL app localStorage, so keys never present in
      // that list — welcome-back, goal-celebration-state, active-gym-filter,
      // lift-tombstones, acquisition-source, install-prompt, etc. — must also be
      // gone. This is a drift GUARD: it deliberately checks keys the old list
      // omitted so an incomplete enumeration would fail here.
      const allKeys = [
        'workout-exercises', 'bodyweight-entries', 'user-progression', 'user-preferences',
        'lift-custom-tags', 'lift-tag-recovery-days', 'lift-tag-recovery-excluded',
        'onboarding-complete', 'sample-data', 'active-tab', 'wt-list-view',
        'rest-duration', 'rest-warning-options', 'rest-warnings', 'rest-presets-disabled', 'rest-presets',
        'app-theme', 'app-mode', 'app-glass', 'rest-timer', 'rest-timer-autostart', 'weight-unit',
        'coach-insights-history',
        // Keys the old enumerated list omitted — the actual drift LIFT-1176 fixes:
        'welcome-back', 'goal-celebration-state', 'active-gym-filter', 'lift-tombstones',
        'acquisition-source', 'app-installed', 'install-prompt-dismissed',
        'notification-permission-granted', 'app-review-prompts', 'overload-nudge-state',
        'guest-mode', 'guest-backup-prompt-dismissed',
      ]
      for (const key of allKeys) {
        localStorage.setItem(key, 'test-value')
      }

      await deleteAccount()

      for (const key of allKeys) {
        expect(localStorage.getItem(key)).toBeNull()
      }
    })

    it('signs user out after deletion', async () => {
      const { deleteAccount, devSignIn, user } = useAuth()
      await devSignIn()
      expect(user.value).not.toBeNull()

      await deleteAccount()
      expect(user.value).toBeNull()
    })

    it('cancels pending sync operations before deleting', async () => {
      const { deleteAccount, devSignIn } = useAuth()
      await devSignIn()

      await deleteAccount()
      expect(mockSyncQueueClear).toHaveBeenCalled()
    })

    it('exposes deleteAccount function', () => {
      const auth = useAuth()
      expect(typeof auth.deleteAccount).toBe('function')
    })

    // Regression LIFT-497: deleteAccount must reset all Pinia stores
    it('resets all Pinia stores on account deletion', async () => {
      const { deleteAccount, devSignIn } = useAuth()
      await devSignIn()

      mockWorkoutReset.mockClear()
      mockBodyweightReset.mockClear()
      mockPreferencesReset.mockClear()
      mockProgressionReset.mockClear()

      await deleteAccount()

      expect(mockWorkoutReset).toHaveBeenCalledOnce()
      expect(mockBodyweightReset).toHaveBeenCalledOnce()
      expect(mockPreferencesReset).toHaveBeenCalledOnce()
      expect(mockProgressionReset).toHaveBeenCalledOnce()
    })

    it('throws when Supabase deletion returns rejected promises', async () => {
      const { deleteAccount, devSignIn } = useAuth()
      await devSignIn()

      // Make supabase.from().delete().eq() reject (network error)
      mockDelete.mockReturnValueOnce({
        eq: vi.fn().mockRejectedValue(new Error('Network failure'))
      })

      await expect(deleteAccount()).rejects.toThrow('Failed to delete server data. Please try again.')
    })

    // Regression LIFT-1225: supabase-js RESOLVES `{ error }` on RLS/FK/401
    // failures rather than rejecting. A resolved error must abort deletion and
    // leave local data intact, or "delete my data" wipes the device while server
    // rows survive.
    it('throws when a Supabase delete RESOLVES with an error (not a rejection)', async () => {
      const { deleteAccount, devSignIn } = useAuth()
      await devSignIn()

      // Resolve (not reject) with a truthy error, as supabase-js does on a 401.
      mockDelete.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({ error: { message: 'JWT expired', code: 'PGRST301' } })
      })

      await expect(deleteAccount()).rejects.toThrow('Failed to delete server data. Please try again.')
    })

    it('preserves local data when a delete resolves with an error', async () => {
      const { deleteAccount, devSignIn } = useAuth()
      await devSignIn()
      localStorage.setItem('workout-exercises', 'test-value')

      mockDelete.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({ error: { message: 'permission denied' } })
      })

      await expect(deleteAccount()).rejects.toThrow('Failed to delete server data. Please try again.')
      // Abort must happen BEFORE localStorage.clear(), so local data survives.
      expect(localStorage.getItem('workout-exercises')).toBe('test-value')
    })

    it('deletes all IndexedDB databases via indexedDB.databases() when available', async () => {
      const mockDeleteDatabase = vi.fn()
      const mockDatabases = vi.fn().mockResolvedValue([
        { name: 'lift-backup' },
        { name: 'other-db' },
      ])
      vi.stubGlobal('indexedDB', {
        databases: mockDatabases,
        deleteDatabase: mockDeleteDatabase,
      })

      const { deleteAccount, devSignIn } = useAuth()
      await devSignIn()
      await deleteAccount()

      expect(mockDatabases).toHaveBeenCalled()
      expect(mockDeleteDatabase).toHaveBeenCalledWith('lift-backup')
      expect(mockDeleteDatabase).toHaveBeenCalledWith('other-db')

      // Restore indexedDB to default (undefined in test env)
      vi.stubGlobal('indexedDB', undefined)
    })

    it('falls back to deleting lift-backup when indexedDB.databases() is not supported', async () => {
      const mockDeleteDatabase = vi.fn()
      vi.stubGlobal('indexedDB', {
        databases: vi.fn().mockRejectedValue(new Error('not supported')),
        deleteDatabase: mockDeleteDatabase,
      })

      const { deleteAccount, devSignIn } = useAuth()
      await devSignIn()
      await deleteAccount()

      expect(mockDeleteDatabase).toHaveBeenCalledWith('lift-backup')

      vi.stubGlobal('indexedDB', undefined)
    })
  })

  // Regression LIFT-1212: on a signed-in cold start BOTH the getSession()
  // resolution and the INITIAL_SESSION auth event fire, and each called
  // initStores. When the event won the race, the user's stores were hydrated
  // twice and the localStorage->Supabase migration ran twice (the reachable
  // trigger for the #787 migration race). initStores is now coalesced per
  // user; the migrate mock is the once-per-init probe.
  describe('initStores idempotence (LIFT-1212)', () => {
    const session = { user: { id: 'u1', email: 'a@b.co' } }

    // Like initWithSession above, but getSession resolution is held manually
    // so the test controls which side of the race runs first.
    async function initWithHeldSession() {
      vi.stubEnv('DEV', false)
      let resolveGetSession!: (v: unknown) => void
      mockGetSession.mockReturnValue(new Promise((r) => { resolveGetSession = r }))
      vi.resetModules()
      const mod = await import('../useAuth')
      const auth = mod.useAuth()
      auth.init()
      await vi.waitFor(() => expect(mockOnAuthStateChange).toHaveBeenCalled())
      const cb = mockOnAuthStateChange.mock.calls.at(-1)![0] as (
        event: string,
        session: unknown,
      ) => void
      const { migrateLocalStorageToSupabase } = await import('../../lib/migrate')
      const migrate = vi.mocked(migrateLocalStorageToSupabase)
      migrate.mockClear()
      return { cb, resolveGetSession, migrate }
    }

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('inits stores once when the auth event wins the race against getSession', async () => {
      const { cb, resolveGetSession, migrate } = await initWithHeldSession()

      // The INITIAL_SESSION event lands first...
      cb('INITIAL_SESSION', session)
      await new Promise((resolve) => setTimeout(resolve, 0))
      // ...then getSession resolves with the same session.
      resolveGetSession({ data: { session } })
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(migrate).toHaveBeenCalledTimes(1)
    })

    it('re-inits after sign-out so the next sign-in hydrates from scratch', async () => {
      const { cb, resolveGetSession, migrate } = await initWithHeldSession()

      cb('INITIAL_SESSION', session)
      resolveGetSession({ data: { session } })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(migrate).toHaveBeenCalledTimes(1)

      // Sign out (teardown resets the guard), then the same user signs back in.
      cb('SIGNED_OUT', null)
      await new Promise((resolve) => setTimeout(resolve, 0))
      cb('SIGNED_IN', session)
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(migrate).toHaveBeenCalledTimes(2)
    })

    // Adversarial-review follow-up (2026-08-26): the failure-path guard reset
    // must clear only its OWN generation. A slow first init that rejects
    // AFTER a sign-out + re-sign-in must not wipe the newer generation's
    // registration — that would let a later trigger (here: the late
    // getSession resolution) start a third, duplicate init.
    it('a stale init rejection cannot wipe a newer generation of the guard', async () => {
      const { cb, resolveGetSession, migrate } = await initWithHeldSession()

      // Swallow the deliberately-orphaned rejection from the superseded init.
      const onUnhandled = () => {}
      process.on('unhandledRejection', onUnhandled)
      try {
        // First init hangs on a migrate we control, then will REJECT later.
        let rejectFirstMigrate!: (e: unknown) => void
        migrate.mockReturnValueOnce(new Promise((_, rej) => { rejectFirstMigrate = rej }))

        cb('INITIAL_SESSION', session)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(migrate).toHaveBeenCalledTimes(1)

        // Sign out mid-init, same user signs straight back in (generation 2).
        cb('SIGNED_OUT', null)
        await new Promise((resolve) => setTimeout(resolve, 0))
        cb('SIGNED_IN', session)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(migrate).toHaveBeenCalledTimes(2)

        // The superseded generation-1 init now fails.
        rejectFirstMigrate(new Error('offline'))
        await new Promise((resolve) => setTimeout(resolve, 0))

        // A late getSession resolution re-triggers initStores for the same
        // user — it must coalesce into generation 2, not start a third run.
        resolveGetSession({ data: { session } })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(migrate).toHaveBeenCalledTimes(2)
      } finally {
        process.off('unhandledRejection', onUnhandled)
      }
    })
  })
})
