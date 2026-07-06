const token = process.env.CLOUDFLARE_API_TOKEN
const zoneId = process.env.CLOUDFLARE_ZONE_ID ?? 'bac3193498d4550dffe6bb1b4a02c7ad'
const recordName = process.env.CLOUDFLARE_RECORD_NAME ?? 'tag.zenmeasure.space'
const target = process.env.CLOUDFLARE_RECORD_TARGET ?? 'tag-app2web.pages.dev'

if (!token) {
  throw new Error('CLOUDFLARE_API_TOKEN is required.')
}

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
}

async function cf(path, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  })
  const payload = await response.json()
  if (!response.ok || payload.success === false) {
    const message = payload.errors?.map((error) => `${error.code}: ${error.message}`).join('; ') || response.statusText
    throw new Error(`${options.method ?? 'GET'} ${path} failed: ${message}`)
  }
  return payload.result
}

const existing = await cf(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(recordName)}`)

const configured = existing.find((record) => record.type === 'CNAME' && record.content === target && record.proxied === true)

if (configured) {
  console.log(JSON.stringify({ status: 'already-configured', recordName, target, id: configured.id }, null, 2))
} else {
  for (const record of existing) {
    if (['A', 'AAAA', 'CNAME'].includes(record.type)) {
      await cf(`/zones/${zoneId}/dns_records/${record.id}`, { method: 'DELETE' })
    }
  }

  const created = await cf(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'CNAME',
      name: recordName,
      content: target,
      proxied: true,
      ttl: 1,
    }),
  })

  console.log(JSON.stringify({ status: 'created', recordName, target, id: created.id }, null, 2))
}
