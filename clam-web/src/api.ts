import type { Book, Library, SavedProgress, Stats } from './types'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: unknown }
    if (typeof data.error === 'string' && data.error) return data.error
  } catch {
    // The old server returns text for some failures.
  }
  return `Request failed (${response.status})`
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body instanceof URLSearchParams ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(init?.body ? { Accept: 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) throw new ApiError(await errorMessage(response), response.status)
  return (await response.json()) as T
}

function form(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values)
}

export const api = {
  session: () => json<{ signedIn: boolean; username: string | null }>('/__auth/me'),

  login: (username: string, password: string) =>
    json<{ ok: boolean; username: string }>('/__auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),

  logout: async () => {
    const response = await fetch('/__auth/logout', { method: 'POST', credentials: 'same-origin' })
    if (!response.ok) throw new ApiError(await errorMessage(response), response.status)
  },

  books: () => json<Library>('/api/books'),

  updateBook: (id: string, values: Record<string, string>) =>
    json<{ ok: boolean; book: Book }>(`/api/books/${id}`, { method: 'POST', body: form(values) }),

  createShelf: (name: string) =>
    json<{ ok: boolean }>('/api/shelves', { method: 'POST', body: form({ name }) }),

  renameShelf: (oldKey: string, name: string) =>
    json<{ ok: boolean }>('/api/series', { method: 'POST', body: form({ old: oldKey, name }) }),

  saveLayout: (shelves: string[], books: Record<string, string[]>) =>
    json<Library>('/api/layout', {
      method: 'POST',
      body: form({ shelves: JSON.stringify(shelves), books: JSON.stringify(books) }),
    }),

  progress: async (bookId: string, progress: SavedProgress, beacon = false): Promise<void> => {
    const body = form({
      chapter: String(progress.chapter),
      position: String(progress.position),
      updated: String(progress.updated),
    })
    if (beacon && navigator.sendBeacon?.(`/api/progress/${bookId}`, body)) return
    const response = await fetch(`/api/progress/${bookId}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      keepalive: true,
    })
    if (!response.ok && response.status !== 401) throw new ApiError(await errorMessage(response), response.status)
  },

  listening: async (seconds: number, beacon = false): Promise<Stats | null> => {
    const body = form({ seconds: String(Math.round(seconds * 10) / 10) })
    if (beacon && navigator.sendBeacon?.('/api/listen', body)) return null
    const response = await fetch('/api/listen', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      keepalive: true,
    })
    if (!response.ok) return null
    return (await response.json()) as Stats
  },
}
