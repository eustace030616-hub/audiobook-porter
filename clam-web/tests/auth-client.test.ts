import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../src/api'

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

it('remembers explicit logout even when offline and will not restore a cached identity', async () => {
  const fetch = vi.fn(async () => { throw Error('offline') })
  const remove = vi.fn(async () => true)
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('caches', { keys: async () => ['clam-private-clam-v4', 'clam-shell-clam-v4', 'unrelated'], delete: remove })
  localStorage.setItem('shelf:pos:book', JSON.stringify({ position: 100 }))
  await expect(api.logout()).rejects.toThrow('offline')
  expect(remove).toHaveBeenCalledExactlyOnceWith('clam-private-clam-v4')
  expect(localStorage.getItem('shelf:pos:book')).toBeNull()
  expect(await api.session()).toEqual({ signedIn: false, username: null })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('allows session checks again after a successful fresh login', async () => {
  localStorage.setItem('clam:signed-out', '1')
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, username: 'New user' })))
  vi.stubGlobal('fetch', fetch)
  await api.login('New user', 'fixture')
  expect(localStorage.getItem('clam:signed-out')).toBeNull()
  await api.session()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('still revokes the server cookie if browser cache storage is denied', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('caches', { keys: async () => { throw Error('storage denied') } })
  await api.logout()
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/__auth/logout', { method: 'POST', credentials: 'same-origin' })
})
