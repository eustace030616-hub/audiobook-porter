import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

const source = await fs.readFile(new URL('../clam-web/public/sw.js', import.meta.url), 'utf8')
function worker() {
  const handlers = {}
  const stores = new Map()
  const context = vm.createContext({
    URL, Response, Date,
    self: { location: { origin: 'https://clam.test' }, addEventListener: (event, handler) => { handlers[event] = handler } },
    caches: {
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
      open: async (name) => {
        if (!stores.has(name)) stores.set(name, new Map())
        const entries = stores.get(name)
        return {
          match: async (request) => entries.get(request.url || request)?.clone(),
          put: async (request, response) => { entries.set(request.url || request, response.clone()) },
        }
      },
    },
    fetch: async () => Response.json({ signedIn: true, username: 'Fixture', expires: Date.now() / 1000 + 3600 }),
  })
  vm.runInContext(source, context)
  return { context, handlers, stores }
}
const session = new Request('https://clam.test/__auth/me')
const books = new Request('https://clam.test/api/books')

test('valid cached session supports offline boot until expiry', async () => {
  const { context } = worker()
  await context.networkFirst(session, '/', true)
  context.fetch = async () => { throw Error('offline') }
  assert.equal((await (await context.networkFirst(session, '/', true)).json()).signedIn, true)
})

test('logout invalidates cached identity and library even if its request fails', async () => {
  const { context, handlers, stores } = worker()
  await context.networkFirst(session, '/', true)
  await context.networkFirst(books, '/', true)
  context.fetch = async () => { throw Error('offline') }
  let response
  handlers.fetch({ request: new Request('https://clam.test/__auth/logout', { method: 'POST' }), respondWith: (promise) => { response = promise } })
  await assert.rejects(response)
  assert.equal(stores.has('clam-private-clam-v4'), false)
  assert.equal((await context.networkFirst(session, '/', true)).status, 503)
  assert.equal((await context.networkFirst(books, '/', true)).status, 503)
})

test('expired cached sessions cannot restore offline access', async () => {
  const { context } = worker()
  context.fetch = async () => Response.json({ signedIn: true, expires: 1 })
  await context.networkFirst(session, '/', true)
  context.fetch = async () => { throw Error('offline') }
  assert.equal((await (await context.networkFirst(session, '/', true)).json()).signedIn, false)
})

test('signed-out server responses remove private library data', async () => {
  const { context } = worker()
  await context.networkFirst(books, '/', true)
  context.fetch = async () => Response.json({ signedIn: false })
  await context.networkFirst(session, '/', true)
  context.fetch = async () => { throw Error('offline') }
  assert.equal((await context.networkFirst(books, '/', true)).status, 503)
})

test('responses already in flight cannot repopulate private cache after logout', async () => {
  const { context, handlers } = worker()
  let resolveFetch
  context.fetch = () => new Promise((resolve) => { resolveFetch = resolve })
  const old = context.networkFirst(books, '/', true)
  await new Promise((resolve) => setImmediate(resolve))
  context.fetch = async () => new Response(null, { status: 204 })
  let logout
  handlers.fetch({ request: new Request('https://clam.test/__auth/logout', { method: 'POST' }), respondWith: (promise) => { logout = promise } })
  await logout
  resolveFetch(Response.json({ books: ['private'] }))
  await old
  context.fetch = async () => { throw Error('offline') }
  assert.equal((await context.networkFirst(books, '/', true)).status, 503)
})
