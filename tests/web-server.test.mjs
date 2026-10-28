import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
async function port() {
  const socket = net.createServer()
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve))
  const result = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  return result
}
async function launch(t, file, env, health) {
  const child = spawn(process.execPath, [file], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stdout.on('data', (chunk) => { logs += chunk })
  child.stderr.on('data', (chunk) => { logs += chunk })
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill()
      await new Promise((resolve) => child.once('exit', resolve))
    }
  })
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(health)).ok) return } catch {}
    if (child.exitCode !== null) break
    await delay(50)
  }
  throw new Error(`Server did not start: ${logs}`)
}

test('real shelf and proxy reject forged sessions and stale progress', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'clam-test-'))
  t.after(() => fs.rm(temp, { recursive: true, force: true }))
  const library = path.join(temp, 'library')
  const data = path.join(temp, 'data')
  const book = path.join(library, 'Author', 'Book')
  await fs.mkdir(book, { recursive: true })
  await fs.mkdir(data)
  const secret = crypto.randomBytes(32)
  await fs.writeFile(path.join(data, 'session-secret'), secret.toString('hex'))
  await fs.writeFile(path.join(book, 'one.m4b'), 'fixture')
  await fs.writeFile(path.join(book, 'two.m4b'), 'fixture')
  await fs.writeFile(path.join(book, 'subtitles.json'), JSON.stringify({ cues: [{ start: 0, end: 1, text: 'Hallo' }] }))
  const id = '123456789abc'
  await fs.writeFile(path.join(book, 'metadata.json'), JSON.stringify({ id, title: 'Fixture', chapters: [
    { title: 'One', start: 0, end: 100_000, duration_ms: 100_000, file: 'one.m4b', subtitle_file: 'subtitles.json' },
    { title: 'Two', start: 100_000, end: 200_000, duration_ms: 100_000, file: 'two.m4b' },
  ] }))
  const shelfPort = await port()
  const proxyPort = await port()
  const shelf = `http://127.0.0.1:${shelfPort}`
  const proxy = `http://127.0.0.1:${proxyPort}`
  await launch(t, 'shelf/server.mjs', { SHELF_PORT: String(shelfPort), SHELF_HOST: '127.0.0.1', SHELF_DATA: data, SHELF_LIBRARY: library }, `${shelf}/health`)
  await launch(t, 'clam-web/server/server.mjs', { CLAM_WEB_PORT: String(proxyPort), CLAM_ORIGIN: shelf }, `${proxy}/health`)
  const payload = Buffer.from(JSON.stringify({ username: 'Fixture', expires: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  const valid = { cookie: `shelf_session=${payload}.${signature}` }
  const forged = { cookie: `shelf_session=${payload}.forged` }

  assert.equal((await (await fetch(`${proxy}/__auth/me`, { headers: forged })).json()).signedIn, false)
  assert.equal((await fetch(`${proxy}/api/word/translate?q=Hallo`, { headers: forged })).status, 401)
  assert.equal((await (await fetch(`${proxy}/__auth/me`, { headers: valid })).json()).username, 'Fixture')
  assert.equal((await fetch(`${proxy}/api/books`, { headers: forged })).status, 401)
  const save = (chapter, position, updated) => fetch(`${proxy}/api/progress/${id}`, { method: 'POST', headers: valid, body: new URLSearchParams({ chapter: String(chapter), position: String(position), updated: String(updated) }) })
  const now = Date.now()
  assert.equal((await save(1, 0, now)).status, 204)
  assert.equal((await save(0, 50, now - 1000)).status, 204)
  const result = await (await fetch(`${proxy}/api/books`, { headers: valid })).json()
  assert.equal(result.books[0].chapter, 1)
  assert.equal(result.books[0].position, 0)
  assert.equal((await save(0, 0, Infinity)).status, 400)

  // Exercise the actual Vite configuration, including auth and subtitles.
  const vitePort = await port()
  const { createServer, loadConfigFromFile } = await import('../clam-web/node_modules/vite/dist/node/index.js')
  const { config } = await loadConfigFromFile({ command: 'serve', mode: 'test' }, path.join(root, 'clam-web/vite.config.ts'))
  assert.equal(config.server.proxy['/__auth'], 'http://127.0.0.1:13379')
  assert.equal(config.server.proxy['/api'], 'http://127.0.0.1:13379')
  assert.equal(config.server.proxy['/subtitle'], 'http://127.0.0.1:13378')
  const vite = await createServer({ ...config, root: path.join(root, 'clam-web'), configFile: false, server: { host: '127.0.0.1', port: vitePort, strictPort: true, proxy: {
    '/__auth': proxy, '/api': proxy, '/subtitle': shelf,
  } } })
  t.after(() => vite.close())
  await vite.listen()
  const dev = `http://127.0.0.1:${vitePort}`
  assert.equal((await (await fetch(`${dev}/__auth/me`, { headers: valid })).json()).signedIn, true)
  const subtitle = result.books[0].chapters[0].subtitleUrl
  assert.equal((await (await fetch(`${dev}${subtitle}`, { headers: valid })).json()).cues[0].text, 'Hallo')
})
