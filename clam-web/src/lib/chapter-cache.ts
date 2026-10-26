import type { Book } from '../types'

export const CACHE_LIMIT = 3
const DB_NAME = 'clam-cache'
const DB_VERSION = 1
const META = 'meta'
const BLOBS = 'blobs'

export interface CachedChapterMeta {
  key: string
  bookId: string
  chapterIndex: number
  title: string
  size: number
  type: string
  cachedAt: number
}

export function cacheKey(bookId: string, chapterIndex: number): string {
  return `${bookId}:${chapterIndex}`
}

export function chapterFileUrl(book: Book, index: number): string {
  const chapter = book.chapters[index]
  return `/audio/${book.id}/${index}?v=${chapter?.fileVersion || 0}`
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS)
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function listCached(): Promise<CachedChapterMeta[]> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(META, 'readonly').objectStore(META).getAll()
      request.onsuccess = () => resolve((request.result as CachedChapterMeta[]).sort((a, b) => a.cachedAt - b.cachedAt))
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function getCachedBlob(key: string): Promise<Blob | null> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(BLOBS, 'readonly').objectStore(BLOBS).get(key)
      request.onsuccess = () => resolve((request.result as Blob | undefined) || null)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function putCached(meta: CachedChapterMeta, blob: Blob): Promise<void> {
  const db = await openDb()
  try {
    const transaction = db.transaction([META, BLOBS], 'readwrite')
    transaction.objectStore(META).put(meta)
    transaction.objectStore(BLOBS).put(blob, meta.key)
    await done(transaction)
  } finally {
    db.close()
  }
}

export async function deleteCached(key: string): Promise<void> {
  const db = await openDb()
  try {
    const transaction = db.transaction([META, BLOBS], 'readwrite')
    transaction.objectStore(META).delete(key)
    transaction.objectStore(BLOBS).delete(key)
    await done(transaction)
  } finally {
    db.close()
  }
}

export interface DownloadResult {
  blob: Blob
  size: number
  type: string
}

export async function downloadChapter(
  book: Book,
  index: number,
  onProgress?: (fraction: number) => void,
): Promise<DownloadResult> {
  const response = await fetch(chapterFileUrl(book, index), { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Chapter download failed (${response.status})`)
  const type = response.headers.get('content-type') || 'audio/mp4'
  const total = Number(response.headers.get('content-length')) || 0

  if (!response.body) {
    const blob = await response.blob()
    onProgress?.(1)
    return { blob, size: blob.size, type }
  }

  const reader = response.body.getReader()
  const chunks: BlobPart[] = []
  let received = 0
  for (;;) {
    const { done: finished, value } = await reader.read()
    if (finished) break
    if (!value) continue
    chunks.push(value as BlobPart)
    received += value.byteLength
    if (total) onProgress?.(Math.min(1, received / total))
  }
  onProgress?.(1)
  return { blob: new Blob(chunks, { type }), size: received, type }
}
