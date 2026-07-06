import { createClient } from '@supabase/supabase-js'

declare const __SUPABASE_URL__: string
declare const __SUPABASE_ANON_KEY__: string
declare const __APP_BASE_URL__: string
declare const __API_BASE_URL__: string

const supabaseUrl = __SUPABASE_URL__ || import.meta.env.VITE_SUPABASE_URL || 'https://example.supabase.co'
const supabaseAnonKey = __SUPABASE_ANON_KEY__ || import.meta.env.VITE_SUPABASE_ANON_KEY || 'missing-anon-key'

export const hasSupabaseConfig =
  Boolean(supabaseUrl) &&
  Boolean(supabaseAnonKey) &&
  supabaseUrl !== 'https://example.supabase.co' &&
  supabaseAnonKey !== 'missing-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

export const appBaseUrl = __APP_BASE_URL__ || import.meta.env.VITE_APP_BASE_URL || window.location.origin
export const apiBaseUrl = __API_BASE_URL__ || import.meta.env.VITE_API_BASE_URL || ''
