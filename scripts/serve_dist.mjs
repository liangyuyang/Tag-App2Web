import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const root = join(process.cwd(), 'dist')
const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 5173)

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function resolvePath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://${host}:${port}`).pathname)
  const safePath = normalize(pathname).replace(/^[/\\]+/, '').replace(/^(\.\.[/\\])+/, '')
  const target = safePath ? join(root, safePath) : join(root, 'index.html')
  return existsSync(target) ? target : join(root, 'index.html')
}

createServer(async (request, response) => {
  try {
    const filePath = resolvePath(request.url ?? '/')
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) throw new Error('Not found')
    response.writeHead(200, { 'content-type': types[extname(filePath)] ?? 'application/octet-stream' })
    createReadStream(filePath).pipe(response)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  }
}).listen(port, host, () => {
  console.log(`ZenMeasure Tag Monitor preview: http://${host}:${port}`)
})
