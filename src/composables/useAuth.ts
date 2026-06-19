import { ref, watch, type Ref } from 'vue'
import { supabase } from '../lib/supabase'
import { migrateLocalStorageToSupabase } from '../lib/migrate'
import { useWorkoutStore } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { usePreferencesStore } from '../stores/preferences'
import { useProgressionStore } from '../stores/progression'
import { useTheme } from '../composables/useTheme'
import { useWeightUnit } from '../composables/useWeightUnit'
import { useRestTimer } from '../composables/useRestTimer'
import { syncQueue } from '../lib/syncQueue'
import { closeDB } from '../lib/durableStorage'
import { logError } from '../lib/logger'
import { clearReauthFlag } from '../lib/sessionHealth'
import type { User, Provider } from '@supabase/supabase-js'
import type { ColorMode } from '../lib/themes'
import type { WeightUnit } from '../lib/themes'

interface AuthError {
  message: string
}

export interface UseAuthReturn {
  user: Ref<User | { id: string; email: string } | null>
  loading: Ref<boolean>
  init: () => void
  signInWithProvider: (provider: Provider) => Promise<{ error: AuthError | null }>
  signInWithEmail: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null; needsConfirmation?: boolean }>
  signOut: () => Promise<void>
  devSignIn: () => Promise<void>
  deleteAccount: () => Promise<void>
  destroy: () => void
}

const user: Ref<User | { id: string; email: string } | null> = ref(null)
const loading: Ref<boolean> = ref(true)

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
 * Push synced settings from the preferences store to the composable module-scope
 * refs, then set up one-directional watchers so future UI changes flow back into
 * the store (and from there to Supabase). Called once after all stores are hydrated.
 */
function syncSettingsWithComposables(): void {
  const prefs = usePreferencesStore()
  const { currentTheme, colorMode } = useTheme()
  const { weightUnit } = useWeightUnit()
  const { restTimerEnabled, restTimerAutoStart } = useRestTimer()

  // Push store → composable refs (Supabase values override local)
  currentTheme.value = prefs.theme
  colorMode.value = prefs.colorMode as ColorMode
  weightUnit.value = prefs.weightUnit as WeightUnit
  restTimerEnabled.value = prefs.restTimerEnabled
  restTimerAutoStart.value = prefs.restTimerAutoStart

  // Composable refs → store (user interactions sync to Supabase)
  watch(currentTheme, (v) => { prefs.setTheme(v) })
  watch(colorMode, (v) => { prefs.setColorMode(v) })
  watch(weightUnit, (v) => { prefs.setWeightUnit(v) })
  watch(restTimerEnabled, (v) => { prefs.setRestTimer(v) })
  watch(restTimerAutoStart, (v) => { prefs.setRestTimerAutoStart(v) })
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
  await Promise.all([
    workoutStore.init(userId),
    bodyweightStore.init(userId),
    preferencesStore.init(userId),
    progressionStore.init(userId),
  ])
  syncSettingsWithComposables()
}

function init(): void {
  if (_initialized) return
  _initialized = true

  // Dev mode or Supabase unavailable: fall back to local-only mode
  if (import.meta.env.DEV || !supabase) {
    loading.value = false
    return
  }

  supabase.auth.getSession().then(({ data: { session } }) => {
    user.value = session?.user ?? null
    if (session?.user) {
      initStores(session.user.id).then(() => { loading.value = false })
    } else {
      loading.value = false
    }
  }).catch((err) => {
    logError(err, { source: 'useAuth', action: 'getSession' })
    loading.value = false
  })

  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    const prev = user.value
    user.value = session?.user ?? null
    // A successful (re)auth means the token is healthy again — clear any
    // pending "re-sign-in needed" prompt (LIFT-784).
    if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') clearReauthFlag()
    if (session?.user && !prev) {
      initStores(session.user.id)
    }
  })
  _authUnsubscribe = () => subscription.unsubscribe()

  setupSessionRefreshLifecycle()
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
  return { user, loading, init, signInWithProvider, signInWithEmail, signUp, signOut, devSignIn, deleteAccount, destroy }
}
