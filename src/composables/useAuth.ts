import { ref, type Ref } from 'vue'
import { supabase } from '../lib/supabase'
import { migrateLocalStorageToSupabase } from '../lib/migrate'
import { useWorkoutStore } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { usePreferencesStore } from '../stores/preferences'
import type { User, Provider } from '@supabase/supabase-js'

interface AuthError {
  message: string
}

const user: Ref<User | { id: string; email: string } | null> = ref(null)
const loading: Ref<boolean> = ref(true)

let _initialized = false

async function initStores(userId: string): Promise<void> {
  const workoutStore = useWorkoutStore()
  const bodyweightStore = useBodyweightStore()
  const preferencesStore = usePreferencesStore()
  await migrateLocalStorageToSupabase(userId)
  await Promise.all([
    workoutStore.init(userId),
    bodyweightStore.init(userId),
    preferencesStore.init(userId),
  ])
}

function init(): void {
  if (_initialized) return
  _initialized = true

  // Dev bypass: skip OAuth on localhost so we can test without pushing to prod
  // Deferred so Pinia is installed by the time stores are accessed
  if (import.meta.env.DEV) {
    user.value = { id: 'local-dev', email: 'dev@localhost' }
    setTimeout(() => initStores('local-dev').then(() => { loading.value = false }), 0)
    return
  }

  supabase!.auth.getSession().then(({ data: { session } }) => {
    user.value = session?.user ?? null
    if (session?.user) {
      initStores(session.user.id).then(() => { loading.value = false })
    } else {
      loading.value = false
    }
  })

  supabase!.auth.onAuthStateChange((_event, session) => {
    const prev = user.value
    user.value = session?.user ?? null
    if (session?.user && !prev) {
      initStores(session.user.id)
    }
  })
}

init()

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

async function signOut(): Promise<void> {
  try {
    await supabase?.auth.signOut()
  } finally {
    user.value = null
  }
}

export function useAuth() {
  return { user, loading, signInWithProvider, signInWithEmail, signUp, signOut }
}
