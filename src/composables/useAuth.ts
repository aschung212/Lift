import { ref, watch, type Ref } from 'vue'
import { supabase } from '../lib/supabase'
import { migrateLocalStorageToSupabase } from '../lib/migrate'
import { useWorkoutStore } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { usePreferencesStore } from '../stores/preferences'
import { useProgressionStore } from '../stores/progression'
import { resetXPCeremony } from '../composables/xpCeremonyUI'
import { useTheme } from '../composables/useTheme'
import { syncQueue } from '../lib/syncQueue'
import { closeDB } from '../lib/durableStorage'
import { logError } from '../lib/logger'
import { clearReauthFlag } from '../lib/sessionHealth'
import type { User, Provider } from '@supabase/supabase-js'
import type { ColorMode } from '../lib/themes'

interface AuthError {
  message: string
}

export interface UseAuthReturn {
  user: Ref<User | { id: string; email: string } | null>
  loading: Ref<boolean>
  isGuest: Ref<boolean>
  init: () => void
  signInWithProvider: (provider: Provider) => Promise<{ error: AuthError | null }>
  signInWithEmail: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null; needsConfirmation?: boolean }>
  signOut: () => Promise<void>
  devSignIn: () => Promise<void>
  continueAsGuest: () => void
  exitGuestMode: () => void
  deleteAccount: () => Promise<void>
  destroy: () => void
}

// Local-only "guest" mode (LIFT-1083): the app is local-first (Pinia +
// localStorage is the source of truth), so it fully works with no account.
// A guest sets a local user identity WITHOUT calling initStores — so the
// stores' `_userId` stays null and nothing is ever enqueued to Supabase. The
// flag is persisted so the guest is restored on reload instead of being bounced
// back to the auth gate. When a guest later creates a real account, the normal
// SIGNED_IN path runs initStores → migrateLocalStorageToSupabase, so their
// device-local data is backed up on conversion.
const GUEST_MODE_KEY = 'guest-mode'
const GUEST_USER_ID = 'guest-local'
/** Persisted dismissal of the "create an account to back up" nudge (App.vue). */
export const GUEST_BACKUP_PROMPT_DISMISSED_KEY = 'guest-backup-prompt-dismissed'

const user: Ref<User | { id: string; email: string } | null> = ref(null)
const loading: Ref<boolean> = ref(true)
const isGuest: Ref<boolean> = ref(false)

let _initialized = false
let _authUnsubscribe: (() => void) | null = null
let _lifecycleCleanups: Array<() => void> = []

/**
 * Re-arm supabase-js token auto-refresh on app resume (LIFT-784).
 *
 * supabase-js pauses its refresh timer while the document is hidden and relies
 * on `visibilitychange` to resume — but that event is unreliable in
 * WKWebView/Capacitor (the App Store target) when coming back from the
 * background, so the access token can quietly expire mid-session. We listen to
 * `visibilitychange` plus `focus` and `pageshow` as redundant resume signals;
 * `startAutoRefresh()` immediately checks the token and refreshes it if it is
 * within the expiry margin. `stopAutoRefresh()` on hide avoids a wasted timer.
 */
function setupSessionRefreshLifecycle(): void {
  if (!supabase || typeof document === 'undefined') return
  const client = supabase
  const resume = () => { void client.auth.startAutoRefresh() }
  const pause = () => { void client.auth.stopAutoRefresh() }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') resume()
    else pause()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', resume)
  window.addEventListener('pageshow', resume)
  _lifecycleCleanups.push(
    () => document.removeEventListener('visibilitychange', onVisibility),
    () => window.removeEventListener('focus', resume),
    () => window.removeEventListener('pageshow', resume),
  )
  // Kick off the loop for the session that is already in the foreground.
  if (document.visibilityState === 'visible') resume()
}

/**
 * Bridge the theme + color-mode composable refs to the preferences store after
 * hydration (LIFT-821).
 *
 * `weightUnit`, `restTimerEnabled`, and `restTimerAutoStart` no longer need a
 * bridge: their composables (`useWeightUnit` / `useRestTimer`) now delegate
 * directly to the store, which is the single source of truth. Theme and color
 * mode still live as module-scope refs in `useTheme` because they are applied to
 * the DOM by the pre-Pinia FOUC bootstrap (`initTheme`); we push the hydrated
 * store value into those refs once and set up a one-directional watcher so future
 * UI changes flow back to the store (and from there to Supabase).
 */
function syncSettingsWithComposables(): void {
  const prefs = usePreferencesStore()
  const { currentTheme, colorMode } = useTheme()

  // Push store → composable refs (Supabase values override local)
  currentTheme.value = prefs.theme
  colorMode.value = prefs.colorMode as ColorMode

  // Composable refs → store (user interactions sync to Supabase)
  watch(currentTheme, (v) => { prefs.setTheme(v) })
  watch(colorMode, (v) => { prefs.setColorMode(v) })
}

async function initStores(userId: string): Promise<void> {
  const workoutStore = useWorkoutStore()
  const bodyweightStore = useBodyweightStore()
  const preferencesStore = usePreferencesStore()
  const progressionStore = useProgressionStore()
  await migrateLocalStorageToSupabase(userId)
  // Replay any writes that were journaled to IndexedDB but never reached the
  // server before the app last closed (LIFT-706). Safe + idempotent; runs
  // before store fetches so recovered writes are in flight during sync.
  await syncQueue.rehydrate()
  // allSettled (not all): each store's init already swallows its own fetch
  // failures, but allSettled is defense-in-depth so a future regression that
  // lets one store's init reject can never abort the others' hydration and
  // leave the app half-initialized (LIFT-820).
  const results = await Promise.allSettled([
    workoutStore.init(userId),
    bodyweightStore.init(userId),
    preferencesStore.init(userId),
    progressionStore.init(userId),
  ])
  for (const r of results) {
    if (r.status === 'rejected') {
      logError(r.reason, { source: 'useAuth', action: 'initStores' })
    }
  }
  syncSettingsWithComposables()
}

/** Clear guest mode (a real session supersedes it). */
function clearGuestFlag(): void {
  isGuest.value = false
  localStorage.removeItem(GUEST_MODE_KEY)
}

/**
 * Restore a persisted guest session so a reload keeps the user in the app
 * instead of bouncing them back to the auth gate. Returns true if a guest was
 * restored.
 */
function restoreGuestIfFlagged(): boolean {
  if (localStorage.getItem(GUEST_MODE_KEY) === 'true') {
    isGuest.value = true
    user.value = { id: GUEST_USER_ID, email: '' }
    return true
  }
  return false
}

function init(): void {
  if (_initialized) return
  _initialized = true

  // Dev mode or Supabase unavailable: fall back to local-only mode
  if (import.meta.env.DEV || !supabase) {
    restoreGuestIfFlagged()
    loading.value = false
    return
  }

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) {
      user.value = session.user
      // A real session supersedes any prior guest mode.
      clearGuestFlag()
      initStores(session.user.id).then(() => { loading.value = false })
    } else {
      user.value = null
      restoreGuestIfFlagged()
      loading.value = false
    }
  }).catch((err) => {
    logError(err, { source: 'useAuth', action: 'getSession' })
    restoreGuestIfFlagged()
    loading.value = false
  })

  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    const prev = user.value
    // A guest converting to a real account has a truthy `prev` (the guest
    // identity), so `!prev` alone would skip initStores — and with it the
    // local→Supabase migration. Init when the previous state had no real
    // account: either signed out (`!prev`) or a guest (LIFT-1083).
    const wasUnauthenticated = !prev || isGuest.value
    // A successful (re)auth means the token is healthy again — clear any
    // pending "re-sign-in needed" prompt (LIFT-784).
    if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') clearReauthFlag()
    if (session?.user) {
      user.value = session.user
      if (wasUnauthenticated) {
        clearGuestFlag()
        initStores(session.user.id)
      }
    } else if (event === 'SIGNED_OUT') {
      // Only an explicit sign-out clears the user. A null-session
      // INITIAL_SESSION event must NOT clobber a guest that getSession()
      // restored, or the guest would be bounced back to the auth gate.
      user.value = null
    }
  })
  _authUnsubscribe = () => subscription.unsubscribe()

  setupSessionRefreshLifecycle()
}

/**
 * Enter local-only guest mode (LIFT-1083). Deliberately does NOT init stores:
 * the stores already hydrated from localStorage at instantiation, and leaving
 * `_userId` null keeps every write local (nothing is enqueued to Supabase). The
 * user is prompted to create an account later to back up / sync.
 */
function continueAsGuest(): void {
  localStorage.setItem(GUEST_MODE_KEY, 'true')
  isGuest.value = true
  user.value = { id: GUEST_USER_ID, email: '' }
  loading.value = false
}

/**
 * Leave guest mode to return to the auth screen (e.g. to create an account).
 * Preserves all local data — does NOT resetStores — so signing up migrates the
 * guest's existing workouts to their new account.
 */
function exitGuestMode(): void {
  clearGuestFlag()
  user.value = null
}

async function signInWithProvider(provider: Provider): Promise<{ error: AuthError | null }> {
  if (!supabase) return { error: { message: 'Supabase not configured' } }
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin }
  })
  return { error }
}

async function signInWithEmail(email: string, password: string): Promise<{ error: AuthError | null }> {
  if (!supabase) return { error: { message: 'Supabase not configured' } }
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return { error }
}

async function signUp(email: string, password: string): Promise<{ error: AuthError | null; needsConfirmation?: boolean }> {
  if (!supabase) return { error: { message: 'Supabase not configured' } }
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (!error && data?.user?.identities?.length === 0) {
    return { error: { message: 'An account with this email already exists.' } }
  }
  return { error, needsConfirmation: !error && !!data?.user && !data?.session }
}

async function devSignIn(): Promise<void> {
  user.value = { id: 'local-dev', email: 'dev@localhost' }
  await initStores('local-dev')
}

function resetStores(): void {
  useWorkoutStore().$reset()
  useBodyweightStore().$reset()
  usePreferencesStore().$reset()
  useProgressionStore().$reset()
  // Transient XP-ceremony UI lives outside the stores (LIFT-823); clear it and
  // its auto-dismiss timer so a shared device never shows the previous user's
  // toast/celebration.
  resetXPCeremony()
}

async function signOut(): Promise<void> {
  try {
    await supabase?.auth.signOut()
  } catch {
    // Network errors during sign-out should not block clearing the user
  } finally {
    // Cancel pending syncs and wipe the durable journal so the next user on a
    // shared device never replays this user's writes (LIFT-706).
    syncQueue.clear()
    resetStores()
    user.value = null
  }
}

/**
 * Delete all user data from Supabase, clear local storage & IndexedDB, then sign out.
 * Throws if Supabase deletion fails so the caller can show an error.
 */
async function deleteAccount(): Promise<void> {
  // Cancel any pending sync operations to avoid racing with deletion
  syncQueue.clear()

  const userId = user.value?.id
  if (supabase && userId) {
    // Delete from Supabase tables. exercises CASCADE deletes sets.
    // Order: leaf tables first, then tables with foreign keys.
    const results = await Promise.allSettled([
      supabase.from('xp_events').delete().eq('user_id', userId),
      supabase.from('progression_snapshots').delete().eq('user_id', userId),
      supabase.from('user_progression').delete().eq('user_id', userId),
      supabase.from('user_preferences').delete().eq('user_id', userId),
      supabase.from('bodyweight_entries').delete().eq('user_id', userId),
      supabase.from('exercises').delete().eq('user_id', userId), // cascades to sets
    ])

    // Check for hard failures (network errors, not RLS/empty-table errors)
    const failed = results.filter(r => r.status === 'rejected')
    if (failed.length > 0) {
      throw new Error('Failed to delete server data. Please try again.')
    }
  }

  // Clear all localStorage keys used by the app
  const localStorageKeys = [
    'workout-exercises', 'bodyweight-entries', 'user-progression', 'user-preferences',
    'lift-custom-tags', 'lift-tag-recovery-days', 'lift-tag-recovery-excluded',
    'onboarding-complete', 'sample-data', 'active-tab', 'wt-list-view',
    'rest-duration', 'rest-warning-options', 'rest-warnings', 'rest-presets-disabled', 'rest-presets',
    'app-theme', 'app-mode', 'app-glass', 'rest-timer', 'rest-timer-autostart', 'weight-unit',
    'coach-insights-history', GUEST_MODE_KEY, GUEST_BACKUP_PROMPT_DISMISSED_KEY,
  ]
  for (const key of localStorageKeys) {
    localStorage.removeItem(key)
  }

  // Delete IndexedDB backup database. Close the cached connection first —
  // deleteDatabase() blocks indefinitely while a connection is still open,
  // which would otherwise leave the durable backup (and sync journal) on disk.
  closeDB()
  if (typeof indexedDB !== 'undefined') {
    try {
      const dbs = await indexedDB.databases()
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name)
      }
    } catch {
      // indexedDB.databases() not supported in all browsers — delete known DB
      try { indexedDB.deleteDatabase('lift-backup') } catch { /* noop */ }
    }
  }

  // Sign out (clears auth session)
  await signOut()
}

function destroy(): void {
  _authUnsubscribe?.()
  _authUnsubscribe = null
  for (const cleanup of _lifecycleCleanups) cleanup()
  _lifecycleCleanups = []
  _initialized = false
}

export function useAuth(): UseAuthReturn {
  return { user, loading, isGuest, init, signInWithProvider, signInWithEmail, signUp, signOut, devSignIn, continueAsGuest, exitGuestMode, deleteAccount, destroy }
}
