import { ref, type Ref } from 'vue'
import { supabase } from '../lib/supabase'
import { migrateLocalStorageToSupabase } from '../lib/migrate'
import { useWorkoutStore } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { usePreferencesStore } from '../stores/preferences'
import { useProgressionStore } from '../stores/progression'
import { syncQueue } from '../lib/syncQueue'
import { logError } from '../lib/logger'
import { onCrossTabUpdate, closeSyncChannel } from '../lib/crossTabSync'
import type { SyncableStore } from '../lib/crossTabSync'
import type { User, Provider } from '@supabase/supabase-js'

interface AuthError {
  message: string
}

const user: Ref<User | { id: string; email: string } | null> = ref(null)
const loading: Ref<boolean> = ref(true)

let _initialized = false
let _unsubCrossTab: (() => void) | null = null

async function initStores(userId: string): Promise<void> {
  const workoutStore = useWorkoutStore()
  const bodyweightStore = useBodyweightStore()
  const preferencesStore = usePreferencesStore()
  const progressionStore = useProgressionStore()
  await migrateLocalStorageToSupabase(userId)
  await Promise.all([
    workoutStore.init(userId),
    bodyweightStore.init(userId),
    preferencesStore.init(userId),
    progressionStore.init(userId),
  ])

  // Listen for cross-tab store updates and reload from localStorage
  _unsubCrossTab?.()
  _unsubCrossTab = onCrossTabUpdate((store: SyncableStore) => {
    const handlers: Record<SyncableStore, () => void> = {
      workout: () => workoutStore._reloadFromStorage(),
      bodyweight: () => bodyweightStore._reloadFromStorage(),
      preferences: () => preferencesStore._reloadFromStorage(),
      progression: () => progressionStore._reloadFromStorage(),
    }
    handlers[store]?.()
  })
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

  supabase.auth.onAuthStateChange((_event, session) => {
    const prev = user.value
    user.value = session?.user ?? null
    if (session?.user && !prev) {
      initStores(session.user.id)
    }
  })
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

async function signOut(): Promise<void> {
  _unsubCrossTab?.()
  _unsubCrossTab = null
  closeSyncChannel()
  try {
    await supabase?.auth.signOut()
  } catch {
    // Network errors during sign-out should not block clearing the user
  } finally {
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
    'lift-custom-tags', 'onboarding-complete', 'sample-data', 'active-tab',
    'rest-duration', 'rest-warning-options', 'rest-warnings', 'rest-presets-disabled', 'rest-presets',
    'app-theme', 'app-mode', 'app-glass', 'rest-timer', 'rest-timer-autostart', 'weight-unit',
  ]
  for (const key of localStorageKeys) {
    localStorage.removeItem(key)
  }

  // Delete IndexedDB backup database
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

export function useAuth() {
  return { user, loading, init, signInWithProvider, signInWithEmail, signUp, signOut, devSignIn, deleteAccount }
}
