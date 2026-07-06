import { hash as blake3Hash } from 'blake3-wasm'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? 'bc2ac4bad6f535fcde57fa10a22f131b'
const projectName = process.env.CLOUDFLARE_PAGES_PROJECT ?? 'tag-app2web'
const distDir = process.env.CLOUDFLARE_PAGES_DIST ?? 'dist'
const customDomain = process.env.CLOUDFLARE_PAGES_DOMAIN ?? 'tag.zenmeasure.space'
const token = process.env.CLOUDFLARE_API_TOKEN

if (!token) {
  throw new Error('CLOUDFLARE_API_TOKEN is required.')
}

const headers = {
  Authorization: `Bearer ${token}`,
}

async function cf(path, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok || payload.success === false) {
    const errors = payload.errors?.map((error) => error.message).join('; ') || text
    throw new Error(`${options.method ?? 'GET'} ${path} failed: ${response.status} ${errors}`)
  }
  return payload
}

async function pagesAsset(path, jwt, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok || payload.success === false) {
    const errors = payload.errors?.map((error) => error.message).join('; ') || text
    throw new Error(`POST ${path} failed: ${response.status} ${errors}`)
  }
  return payload.result
}

function contentTypeFor(route) {
  if (route.endsWith('.html')) return 'text/html; charset=utf-8'
  if (route.endsWith('.js')) return 'application/javascript; charset=utf-8'
  if (route.endsWith('.css')) return 'text/css; charset=utf-8'
  if (route.endsWith('.svg')) return 'image/svg+xml'
  if (route.endsWith('.png')) return 'image/png'
  if (route.endsWith('.json')) return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

function pagesHash(file, buffer) {
  const base64Contents = buffer.toString('base64')
  const extension = extname(file).slice(1)
  return blake3Hash(base64Contents + extension).toString('hex').slice(0, 32)
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)
      return entry.isDirectory() ? listFiles(path) : [path]
    }),
  )
  return files.flat()
}

async function ensureProject() {
  try {
    return await cf(`/accounts/${accountId}/pages/projects/${projectName}`)
  } catch (error) {
    if (!String(error.message).includes('404')) throw error
  }
  return cf(`/accounts/${accountId}/pages/projects`, {
    method: 'POST',
    body: JSON.stringify({
      name: projectName,
      production_branch: 'main',
    }),
  })
}

async function deploy() {
  await ensureProject()
  const files = await listFiles(distDir)
  const manifest = {}
  const filePayloads = []

  for (const file of files) {
    const buffer = await readFile(file)
    const hash = pagesHash(file, buffer)
    const route = `/${relative(distDir, file).split(sep).join('/')}`
    manifest[route] = hash
    filePayloads.push({ file, route, hash, buffer, contentType: contentTypeFor(route) })
  }

  const uploadToken = await cf(`/accounts/${accountId}/pages/projects/${projectName}/upload-token`)
  const jwt = uploadToken.result?.jwt
  if (!jwt) throw new Error('Cloudflare Pages upload token response did not include a JWT.')

  const missingHashes =
    (await pagesAsset('/pages/assets/check-missing', jwt, { hashes: filePayloads.map((file) => file.hash) })) ?? []
  const missing = filePayloads.filter((file) => missingHashes.includes(file.hash))
  if (missing.length) {
    await pagesAsset(
      '/pages/assets/upload',
      jwt,
      missing.map((file) => ({
        key: file.hash,
        value: file.buffer.toString('base64'),
        metadata: { contentType: file.contentType },
        base64: true,
      })),
    )
  }
  await pagesAsset('/pages/assets/upsert-hashes', jwt, { hashes: filePayloads.map((file) => file.hash) })

  const form = new FormData()
  form.set('manifest', JSON.stringify(manifest))
  form.set('branch', 'main')

  const deployment = await cf(`/accounts/${accountId}/pages/projects/${projectName}/deployments`, {
    method: 'POST',
    body: form,
  })

  let domainResult = null
  try {
    domainResult = await cf(`/accounts/${accountId}/pages/projects/${projectName}/domains`, {
      method: 'POST',
      body: JSON.stringify({ name: customDomain }),
    })
  } catch (error) {
    if (!String(error.message).includes('already exists') && !String(error.message).includes('already added')) {
      domainResult = { warning: error.message }
    } else {
      domainResult = { warning: 'unchanged' }
    }
  }

  console.log(
    JSON.stringify(
      {
        projectName,
        deploymentId: deployment.result?.id,
        deploymentUrl: deployment.result?.url,
        customDomain,
        domainStatus: domainResult?.result?.status ?? domainResult?.warning ?? 'unchanged',
        uploadedFiles: files.length,
        newlyUploadedFiles: missing.length,
      },
      null,
      2,
    ),
  )
}

deploy().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
