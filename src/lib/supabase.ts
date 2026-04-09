import { createClient, type SupabaseClient } from '@supabase/supabase-js'
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

export const supabase: SupabaseClient<Database> | null = !import.meta.env.DEV && supabaseUrl && supabaseAnonKey
  ? createClient<Database>(supabaseUrl, supabaseAnonKey)
  : null
