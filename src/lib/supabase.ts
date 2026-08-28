import type { SupabaseClient } from '@supabase/supabase-js'
import { ref } from 'vue'
import type { Database } from './database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const PROD_HOSTNAME = 'spa-rho-sandy.vercel.app'

/** True when running on a Vercel preview deployment (not prod, not localhost). */
export const isPreviewDeploy: boolean =
  typeof window !== 'undefined' &&
  !import.meta.env.DEV &&
  window.location.hostname !== PROD_HOSTNAME &&
  window.location.hostname.endsWith('.vercel.app')

/** Reactive flag — true when writes should be blocked. Starts true on preview deploys, can be toggled. */
export const isPreviewMode = ref(isPreviewDeploy)

/** Supabase client — null until initSupabase() resolves. */
export let supabase: SupabaseClient<Database> | null = null

/** Lazily load the Supabase SDK and create the client. */
export async function initSupabase(): Promise<void> {
  if (import.meta.env.DEV || !supabaseUrl || !supabaseAnonKey) return
  const { createClient } = await import('@supabase/supabase-js')
  // Explicit auth lifecycle (LIFT-784). These match supabase-js defaults but are
  // stated outright so the token-refresh contract is unambiguous: the session is
  // persisted and the access token auto-refreshes. supabase-js drives refresh off
  // a visibility timer that is unreliable in WKWebView/Capacitor when resuming
  // from the background — useAuth re-arms it on visibility/focus/pageshow, and
  // sessionHealth recovers any 401 that still slips through.
  supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // PKCE instead of the implicit-flow default (LIFT-808): with implicit,
      // signInWithOAuth returned the access token in the URL FRAGMENT —
      // exposed to browser history, and the standing risk for SPAs. Under
      // PKCE the redirect carries a one-time ?code= which supabase-js
      // exchanges automatically via detectSessionInUrl (the code_verifier
      // lives in the same persistSession storage). Existing persisted
      // sessions are unaffected — flowType only changes NEW OAuth sign-ins —
      // and PKCE is also the flow Capacitor deep-link OAuth requires for the
      // App Store target.
      flowType: 'pkce',
    },
  })
}
