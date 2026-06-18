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
  // A migration failure (e.g. a transient RLS/server error on insert, which
  // migrate.ts now throws on rather than swallowing) must NOT soft-lock the app
  // on the loading screen — these callers don't await initStores' rejection, so
  // an uncaught throw would leave `loading` stuck true. The local-first stores
  // work without the migration and it retries on the next launch; log it so the
  // failure stays observable instead of silently swallowed (LIFT-782).
  try {
    await migrateLocalStorageToSupabase(userId)
  } catch (err) {
    logError(err, { source: 'useAuth', action: 'migrate' })
  }
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

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    const prev = user.value
    user.value = session?.user ?? null
    if (session?.user && !prev) {
      initStores(session.user.id)
    }
  })
  _authUnsubscribe = () => subscription.unsubscribe()
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
  const userId = user.value?.id
  if (supabase && userId) {
    // Delete every table the user owns. Each row references only auth.users(id)
    // (exercises additionally CASCADE-deletes sets), so there are no inter-table
    // foreign-key dependencies and the deletes can safely run concurrently.
    const results = await Promise.allSettled([
      supabase.from('xp_events').delete().eq('user_id', userId),
      supabase.from('progression_snapshots').delete().eq('user_id', userId),
      supabase.from('user_progression').delete().eq('user_id', userId),
      supabase.from('user_preferences').delete().eq('user_id', userId),
      supabase.from('bodyweight_entries').delete().eq('user_id', userId),
      supabase.from('exercises').delete().eq('user_id', userId), // cascades to sets
    ])

    // Supabase query builders RESOLVE (not reject) when a DELETE fails at the
    // DB/RLS layer — the failure is surfaced in the resolved object's `.error`
    // field, and the promise only rejects on transport errors. Treat BOTH a
    // rejected promise AND a resolved-with-error response as a hard failure, so
    // a silent server-side delete failure never lets us wipe local data while
    // the user's rows remain on the server (privacy/GDPR orphaning, LIFT-782).
    const failed = results.some(r =>
      r.status === 'rejected' || (r.value as { error: unknown } | null)?.error != null
    )
    if (failed) {
      // Abort BEFORE touching any local state so the user can retry. The sync
      // journal is left intact (it is only cleared after a confirmed delete
      // below), so pending offline writes survive a failed deletion (LIFT-782).
      throw new Error('Failed to delete server data. Please try again.')
    }
  }

  // Server data is gone (or there was none) — only now is it safe to discard
  // pending sync operations. Clearing here (rather than at the top) means a
  // FAILED server deletion above preserves the durable journal so the user
  // doesn't lose unsynced writes; on success it stops a queued write from
  // resurrecting the just-deleted rows before we wipe local state (LIFT-782).
  syncQueue.clear()

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
  _initialized = false
}

export function useAuth(): UseAuthReturn {
  return { user, loading, init, signInWithProvider, signInWithEmail, signUp, signOut, devSignIn, deleteAccount, destroy }
}
