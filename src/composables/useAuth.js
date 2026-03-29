import { ref } from 'vue'
import { supabase } from '../lib/supabase'
import { migrateLocalStorageToSupabase } from '../lib/migrate'
import { useWorkoutStore } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { usePreferencesStore } from '../stores/preferences'

const user = ref(null)
const loading = ref(true)

let _initialized = false

async function initStores(userId) {
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

function init() {
  if (_initialized || !supabase) {
    loading.value = false
    return
  }
  _initialized = true

  supabase.auth.getSession().then(({ data: { session } }) => {
    user.value = session?.user ?? null
    if (session?.user) {
      initStores(session.user.id).then(() => { loading.value = false })
    } else {
      loading.value = false
    }
  })

  supabase.auth.onAuthStateChange((_event, session) => {
    const prev = user.value
    user.value = session?.user ?? null
    if (session?.user && !prev) {
      initStores(session.user.id)
    }
  })
}

init()

async function signInWithProvider(provider) {
  if (!supabase) return { error: { message: 'Supabase not configured' } }
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin }
  })
  return { error }
}

async function signInWithEmail(email, password) {
  if (!supabase) return { error: { message: 'Supabase not configured' } }
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return { error }
}

async function signUp(email, password) {
  if (!supabase) return { error: { message: 'Supabase not configured' } }
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (!error && data?.user?.identities?.length === 0) {
    return { error: { message: 'An account with this email already exists.' } }
  }
  return { error, needsConfirmation: !error && !!data?.user && !data?.session }
}

async function signOut() {
  if (!supabase) return
  await supabase.auth.signOut()
  user.value = null
}

export function useAuth() {
  return { user, loading, signInWithProvider, signInWithEmail, signUp, signOut }
}
