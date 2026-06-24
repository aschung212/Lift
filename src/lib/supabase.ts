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

/**
 * Auth options passed to `createClient`.
 *
 * Explicit auth lifecycle (LIFT-784): `persistSession`/`autoRefreshToken`/
 * `detectSessionInUrl` match supabase-js defaults but are stated outright so the
 * token-refresh contract is unambiguous — the session is persisted and the access
 * token auto-refreshes. supabase-js drives refresh off a visibility timer that is
 * unreliable in WKWebView/Capacitor when resuming from the background, so useAuth
 * re-arms it on visibility/focus/pageshow and sessionHealth recovers any 401 that
 * still slips through.
 *
 * `flowType: 'pkce'` (LIFT-808): supabase-js v2 defaults to the legacy implicit
 * flow, which returns the access token in the URL fragment where it leaks into
 * history/Referer. PKCE exchanges a one-time `?code=` for the token via a verifier
 * held in localStorage — the recommended flow for SPAs and required for safe
 * Capacitor deep-link OAuth redirects (the App Store target). `detectSessionInUrl`
 * performs the code→session exchange automatically on the redirect back.
 */
export const SUPABASE_AUTH_OPTIONS = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
  flowType: 'pkce',
} as const

/** Lazily load the Supabase SDK and create the client. */
export async function initSupabase(): Promise<void> {
  if (import.meta.env.DEV || !supabaseUrl || !supabaseAnonKey) return
  const { createClient } = await import('@supabase/supabase-js')
  supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: SUPABASE_AUTH_OPTIONS,
  })
}
