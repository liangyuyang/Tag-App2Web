import { createClient } from '@supabase/supabase-js'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Env = {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  APP_ORIGIN?: string
}

type UserAccess = {
  email: string
  role: 'admin' | 'viewer'
  source: 'domain' | 'allowlist'
}

const app = new Hono<{ Bindings: Env; Variables: { access: UserAccess } }>()
const internalDomains = ['miaomiaoce.com', 'zenmeasure.com', 'zenmeasure.space']

function adminDb(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
}

function anonDb(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY)
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function emailDomain(email: string) {
  return normalizeEmail(email).split('@')[1] ?? ''
}

function isInternal(email: string) {
  return internalDomains.includes(emailDomain(email))
}

app.use(
  '*',
  cors({
    origin: (origin, c) => c.env.APP_ORIGIN || origin || '*',
    allowHeaders: ['authorization', 'content-type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
)

app.post('/api/auth/check-email', async (c) => {
  const payload = await c.req.json<{ email?: string }>().catch(() => ({}))
  const email = normalizeEmail(payload.email ?? '')
  if (!email.includes('@')) return c.json({ error: 'Valid email is required.' }, 400)
  if (isInternal(email)) return c.json({ allowed: true, role: 'admin', source: 'domain' })

  const { data, error } = await adminDb(c.env)
    .from('customer_email_allowlist')
    .select('email, role, active')
    .eq('email', email)
    .eq('active', true)
    .maybeSingle()

  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: 'Email is not allowlisted.' }, 403)
  return c.json({ allowed: true, role: data.role, source: 'allowlist' })
})

app.use('/api/*', async (c, next) => {
  const authorization = c.req.header('authorization') ?? ''
  const token = authorization.replace(/^Bearer\s+/i, '')
  if (!token) return c.json({ error: 'Missing bearer token.' }, 401)

  const { data, error } = await anonDb(c.env).auth.getUser(token)
  const email = normalizeEmail(data.user?.email ?? '')
  if (error || !email) return c.json({ error: 'Invalid session.' }, 401)

  if (isInternal(email)) {
    c.set('access', { email, role: 'admin', source: 'domain' })
    return next()
  }

  const { data: allowlist } = await adminDb(c.env)
    .from('customer_email_allowlist')
    .select('email, role, active')
    .eq('email', email)
    .eq('active', true)
    .maybeSingle()

  if (!allowlist) return c.json({ error: 'Email is not allowlisted.' }, 403)
  c.set('access', { email, role: allowlist.role, source: 'allowlist' })
  return next()
})

app.get('/api/me', (c) => c.json(c.get('access')))

app.get('/api/allowlist', async (c) => {
  if (c.get('access').role !== 'admin') return c.json({ error: 'Admin role required.' }, 403)
  const { data, error } = await adminDb(c.env)
    .from('customer_email_allowlist')
    .select('id, email, role, active, notes, tag_access(tag_id, tags(tag_code, nickname))')
    .order('created_at', { ascending: false })
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data ?? [])
})

app.post('/api/allowlist', async (c) => {
  if (c.get('access').role !== 'admin') return c.json({ error: 'Admin role required.' }, 403)
  const payload = await c.req.json<{ email?: string; role?: 'admin' | 'viewer'; tagIds?: string[]; notes?: string }>()
  const email = normalizeEmail(payload.email ?? '')
  if (!email.includes('@')) return c.json({ error: 'Valid email is required.' }, 400)

  const db = adminDb(c.env)
  const { data, error } = await db
    .from('customer_email_allowlist')
    .upsert({ email, role: payload.role ?? 'viewer', active: true, notes: payload.notes ?? null }, { onConflict: 'email' })
    .select('id, email, role, active, notes')
    .single()
  if (error) return c.json({ error: error.message }, 500)

  if (Array.isArray(payload.tagIds)) {
    await db.from('tag_access').delete().eq('email', email)
    if (payload.tagIds.length) {
      const { error: accessError } = await db
        .from('tag_access')
        .insert(payload.tagIds.map((tagId) => ({ email, tag_id: tagId })))
      if (accessError) return c.json({ error: accessError.message }, 500)
    }
  }

  return c.json(data, 201)
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

export default app
