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
  supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
}
