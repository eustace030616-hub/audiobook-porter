import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STUDIO_STATE = path.join(HERE, 'ui', 'studio.json')

function studioState(): Plugin {
  return {
    name: 'clam-studio',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next()
        const url = new URL(req.url, 'http://localhost')
        if (url.pathname === '/studio') {
          req.url = `/studio.html${url.search}`
          return next()
        }
        if (url.pathname !== '/__studio/state') return next()
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(fs.existsSync(STUDIO_STATE) ? fs.readFileSync(STUDIO_STATE) : '{"content":[],"root":{"props":{}},"zones":{}}')
          return
        }
        if (req.method === 'POST') {
          let body = ''
          let tooLarge = false
          req.on('data', (chunk) => {
            body += chunk
            if (body.length > 2_000_000) {
              tooLarge = true
              req.destroy()
            }
          })
          req.on('end', () => {
            if (tooLarge) return
            try {
              const parsed = JSON.parse(body)
              fs.mkdirSync(path.dirname(STUDIO_STATE), { recursive: true })
              fs.writeFileSync(STUDIO_STATE, `${JSON.stringify(parsed, null, 2)}\n`)
              res.writeHead(204, { 'Cache-Control': 'no-store' })
              res.end()
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end('{"error":"invalid state"}')
            }
          })
          return
        }
        res.writeHead(405)
        res.end()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), studioState()],
  server: {
    proxy: {
      '/__auth': 'http://127.0.0.1:13378',
      '/api': 'http://127.0.0.1:13378',
      '/audio': 'http://127.0.0.1:13378',
      '/hls': 'http://127.0.0.1:13378',
      '/cover': 'http://127.0.0.1:13378',
      '/subtitle': 'http://127.0.0.1:13378',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
