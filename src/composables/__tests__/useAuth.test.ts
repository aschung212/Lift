import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// Mock matchMedia (needed by useTheme which useAuth imports transitively)
vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})))

// Mock all stores that useAuth imports
vi.mock('../../stores/workout', () => ({
  useWorkoutStore: () => ({ init: vi.fn() })
}))
vi.mock('../../stores/bodyweight', () => ({
  useBodyweightStore: () => ({ init: vi.fn() })
}))
vi.mock('../../stores/preferences', () => ({
  usePreferencesStore: () => ({ init: vi.fn() })
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
    },
    from: (...args: unknown[]) => mockFrom(...args),
  }
}))

// Mock syncQueue
const mockSyncQueueClear = vi.fn()
vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { clear: () => mockSyncQueueClear() }
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
  })

  describe('devSignIn', () => {
    it('sets user to local-dev', async () => {
      const { devSignIn, user } = useAuth()
      expect(user.value).toBeNull()
      await devSignIn()
      expect(user.value).toEqual({ id: 'local-dev', email: 'dev@localhost' })
    })
  })

  describe('deleteAccount', () => {
    it('clears all localStorage keys used by the app', async () => {
      const { deleteAccount, devSignIn } = useAuth()
      await devSignIn()

      // Set some localStorage keys
      localStorage.setItem('workout-exercises', '[]')
      localStorage.setItem('bodyweight-entries', '[]')
      localStorage.setItem('user-progression', '{}')
      localStorage.setItem('app-theme', 'fire')
      localStorage.setItem('rest-duration', '90')

      await deleteAccount()

      expect(localStorage.getItem('workout-exercises')).toBeNull()
      expect(localStorage.getItem('bodyweight-entries')).toBeNull()
      expect(localStorage.getItem('user-progression')).toBeNull()
      expect(localStorage.getItem('app-theme')).toBeNull()
      expect(localStorage.getItem('rest-duration')).toBeNull()
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

    it('throws when Supabase deletion returns rejected promises', async () => {
      const { deleteAccount, devSignIn } = useAuth()
      await devSignIn()

      // Make supabase.from().delete().eq() reject (network error)
      mockDelete.mockReturnValueOnce({
        eq: vi.fn().mockRejectedValue(new Error('Network failure'))
      })

      await expect(deleteAccount()).rejects.toThrow('Failed to delete server data. Please try again.')
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
})
