const accessToken = process.env.SUPABASE_ACCESS_TOKEN
const projectRef = process.env.SUPABASE_PROJECT_REF ?? 'irwnulzddzfcwncqsabn'
const smtpPassword = process.env.ZENMEASURE_SMTP_PASS

const siteUrl = process.env.AUTH_SITE_URL ?? 'https://tag.zenmeasure.space'
const redirectUrls = process.env.AUTH_REDIRECT_URLS ?? [
  'https://tag.zenmeasure.space',
  'https://tag.zenmeasure.space/**',
  'https://tag-app2web.pages.dev',
  'https://tag-app2web.pages.dev/**',
  'http://localhost:5173',
  'http://localhost:5173/**',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5173/**',
].join(',')

if (!accessToken) {
  throw new Error('SUPABASE_ACCESS_TOKEN is required.')
}

if (!smtpPassword) {
  throw new Error('ZENMEASURE_SMTP_PASS is required. Store it as a local User environment variable, not in Git.')
}

const body = {
  site_url: siteUrl,
  uri_allow_list: redirectUrls,
  smtp_enabled: true,
  smtp_host: process.env.ZENMEASURE_SMTP_HOST ?? 'gsgpm1049.siteground.biz',
  smtp_port: Number(process.env.ZENMEASURE_SMTP_PORT ?? 465),
  smtp_user: process.env.ZENMEASURE_SMTP_USER ?? 'support@zenmeasure.com',
  smtp_pass: smtpPassword,
  smtp_admin_email: process.env.ZENMEASURE_SMTP_ADMIN_EMAIL ?? 'support@zenmeasure.com',
  smtp_sender_name: process.env.ZENMEASURE_SMTP_SENDER_NAME ?? 'ZenMeasure Support',
}

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
})

const result = await response.json().catch(() => ({}))
if (!response.ok) {
  throw new Error(`Supabase Auth email config failed: ${response.status} ${JSON.stringify(result)}`)
}

console.log(JSON.stringify({
  projectRef,
  site_url: result.site_url,
  uri_allow_list: result.uri_allow_list,
  smtp_enabled: result.smtp_enabled ?? true,
  smtp_host: result.smtp_host,
  smtp_port: result.smtp_port,
  smtp_admin_email: result.smtp_admin_email,
  smtp_sender_name: result.smtp_sender_name,
}, null, 2))
