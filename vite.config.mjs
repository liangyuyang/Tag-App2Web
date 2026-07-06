import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'

function readLocalEnv() {
  const result = {}
  for (const file of ['.env', '.env.local']) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const index = trimmed.indexOf('=')
      if (index === -1) continue
      const key = trimmed.slice(0, index).trim()
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
      result[key] = value
    }
  }
  return result
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...readLocalEnv(), ...process.env }

  return {
    plugins: [react()],
    define: {
      __SUPABASE_URL__: JSON.stringify(env.VITE_SUPABASE_URL ?? ''),
      __SUPABASE_ANON_KEY__: JSON.stringify(env.VITE_SUPABASE_ANON_KEY ?? ''),
      __APP_BASE_URL__: JSON.stringify(env.VITE_APP_BASE_URL ?? ''),
      __API_BASE_URL__: JSON.stringify(env.VITE_API_BASE_URL ?? ''),
    },
  }
})
