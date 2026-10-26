import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(HERE, '..', 'dist')
const ORIGIN = (process.env.CLAM_ORIGIN || 'http://127.0.0.1:13378').replace(/\/$/, '')
const PORT = Number(process.env.CLAM_WEB_PORT || 13379)
const HOSTS = (process.env.CLAM_WEB_HOST || '127.0.0.1').split(',').map((host) => host.trim()).filter(Boolean)
const COOKIE = 'shelf_session'
const MAX_BODY = 64 * 1024

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
}

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(JSON.stringify(value))
}

function parseCookies(header) {
  const out = {}
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return out
}

function decodeSession(cookie) {
  if (!cookie) return null
  const split = cookie.lastIndexOf('.')
  if (split < 0) return null
  try {
    const data = JSON.parse(Buffer.from(cookie.slice(0, split), 'base64url').toString('utf8'))
    if (!Number.isFinite(Number(data.expires)) || Number(data.expires) < Math.floor(Date.now() / 1000)) return null
    const username = String(data.username || '').replace(/\s+/g, ' ').trim()
    return { username: username || 'User' }
  } catch {
    return null
  }
}

function sessionFrom(req) {
  return decodeSession(parseCookies(req.headers.cookie)[COOKIE])
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function proxy(req, res, url) {
  const headers = { ...req.headers }
  headers.host = new URL(ORIGIN).host
  headers['accept-encoding'] = 'identity'
  delete headers.connection
  const method = req.method || 'GET'
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req)
  let upstream
  try {
    upstream = await fetch(`${ORIGIN}${url.pathname}${url.search}`, {
      method,
      headers,
      body,
      redirect: 'manual',
    })
  } catch {
    return sendJson(res, 502, { error: 'Clam is unavailable' })
  }

  const out = {}
  for (const [key, value] of upstream.headers) {
    if (['content-encoding', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie'].includes(key)) continue
    out[key] = value
  }
  const cookies = upstream.headers.getSetCookie()
  if (cookies.length) out['set-cookie'] = cookies
  res.writeHead(upstream.status, out)
  if (!upstream.body || method === 'HEAD') {
    res.end()
    return
  }
  const stream = Readable.fromWeb(upstream.body)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

async function login(req, res) {
  let payload
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8'))
  } catch {
    return sendJson(res, 400, { error: 'Could not read the form.' })
  }
  const username = String(payload.username || '').replace(/\s+/g, ' ').trim()
  const password = String(payload.password || '')
  if (!username || !password) return sendJson(res, 400, { error: 'Username and password are required.' })

  let upstream
  try {
    upstream = await fetch(`${ORIGIN}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html',
      },
      body: new URLSearchParams({ username, password }),
      redirect: 'manual',
    })
  } catch {
    return sendJson(res, 503, { error: 'Flowwing identity is unavailable. Try again.' })
  }

  if (upstream.status === 302 || upstream.status === 303) {
    const cookies = upstream.headers.getSetCookie()
    if (!cookies.length) return sendJson(res, 502, { error: 'Login succeeded without a session.' })
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': cookies,
    })
    res.end(JSON.stringify({ ok: true, username }))
    return
  }
  if (upstream.status === 401) return sendJson(res, 401, { error: 'Wrong name or password.' })
  if (upstream.status === 429) return sendJson(res, 429, { error: 'Too many attempts. Wait a minute.' })
  if (upstream.status === 503) return sendJson(res, 503, { error: 'Flowwing identity is unavailable. Try again.' })
  return sendJson(res, 502, { error: 'Flowwing identity returned an unexpected response.' })
}

async function logout(req, res) {
  const cookie = req.headers.cookie
  let upstream
  try {
    upstream = await fetch(`${ORIGIN}/logout`, {
      method: 'POST',
      headers: cookie ? { cookie } : {},
      redirect: 'manual',
    })
  } catch {
    return sendJson(res, 502, { error: 'Clam is unavailable' })
  }
  const cookies = upstream.headers.getSetCookie()
  if (cookies.length) res.setHeader('Set-Cookie', cookies)
  res.writeHead(204, { 'Cache-Control': 'no-store' })
  res.end()
}

function serveStatic(req, res, url) {
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return sendJson(res, 400, { error: 'Bad path' })
  }
  if (pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'clam-web', origin: ORIGIN })
  }
  if (pathname === '/__auth/me') {
    const session = sessionFrom(req)
    return sendJson(res, 200, { signedIn: Boolean(session), username: session?.username || null })
  }
  if (pathname === '/__auth/login' && req.method === 'POST') return login(req, res)
  if (pathname === '/__auth/logout' && req.method === 'POST') return logout(req, res)

  if (pathname.startsWith('/api/') || pathname.startsWith('/audio/') || pathname.startsWith('/cover/')) {
    return proxy(req, res, url)
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  const candidate = path.resolve(DIST, `.${pathname}`)
  const inside = candidate === DIST || candidate.startsWith(`${DIST}${path.sep}`)
  let file = inside && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : ''
  if (!file && !path.extname(pathname)) file = path.join(DIST, 'index.html')
  if (!file) return sendJson(res, 404, { error: 'Not found' })

  const ext = path.extname(file)
  const cache = file.endsWith('index.html')
    ? 'no-cache'
    : pathname.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache'
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; script-src 'self'; worker-src 'self'; manifest-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res)
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`clam-web: no build at ${DIST}; run pnpm build first`)
}

function handler(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  Promise.resolve(serveStatic(req, res, url)).catch((error) => {
    console.error('clam-web request failed:', error?.message || error)
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' })
    else res.destroy()
  })
}

for (const host of HOSTS) {
  const server = http.createServer(handler)
  server.on('error', (error) => {
    console.error(`clam-web failed to listen on ${host}:${PORT}:`, error.message)
  })
  server.listen(PORT, host, () => {
    console.log(`clam-web listening on http://${host}:${PORT}`)
  })
}
console.log(`proxying Clam at ${ORIGIN}`)
