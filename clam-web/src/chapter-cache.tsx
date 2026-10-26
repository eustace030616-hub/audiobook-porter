import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Book } from './types'
import { chapterFor } from './lib/progress'
import {
  CACHE_LIMIT,
  cacheKey,
  deleteCached,
  startChapterDownload,
  type ChapterDownload,
  listCached,
  putCached,
  type CachedChapterMeta,
} from './lib/chapter-cache'
import { Sheet } from './components/Sheet'

export interface DownloadState {
  progress: number
  paused: boolean
}

interface CacheContextValue {
  entries: CachedChapterMeta[]
  downloading: Record<string, DownloadState>
  cached: (bookId: string, index: number) => CachedChapterMeta | undefined
  request: (book: Book, index: number) => void
  pause: (bookId: string, index: number) => void
  resume: (bookId: string, index: number) => void
  remove: (bookId: string, index: number) => Promise<void>
}

const CacheContext = createContext<CacheContextValue | null>(null)

interface PendingCache {
  book: Book
  index: number
  oldest: CachedChapterMeta
}

export function ChapterCacheProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<CachedChapterMeta[]>([])
  const [downloading, setDownloading] = useState<Record<string, DownloadState>>({})
  const downloads = useRef(new Map<string, ChapterDownload>())
  const [pending, setPending] = useState<PendingCache | null>(null)

  const refresh = useCallback(async () => {
    try {
      setEntries(await listCached())
    } catch {
      // Private mode or a denied quota leaves the cache unavailable.
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const start = useCallback(
    async (book: Book, index: number, replaceKey?: string) => {
      const key = cacheKey(book.id, index)
      setDownloading((current) => ({ ...current, [key]: { progress: 0, paused: false } }))
      const task = startChapterDownload(book, index, (fraction) => {
        setDownloading((current) => ({ ...current, [key]: { progress: fraction, paused: current[key]?.paused ?? false } }))
      })
      downloads.current.set(key, task)
      try {
        const result = await task.promise
        const chapter = chapterFor(book, index)
        const meta: CachedChapterMeta = {
          key,
          bookId: book.id,
          chapterIndex: index,
          title: chapter?.title || `Chapter ${index + 1}`,
          size: result.size,
          type: result.type,
          cachedAt: Date.now(),
        }
        if (replaceKey) await deleteCached(replaceKey)
        await putCached(meta, result.blob)
        await refresh()
      } catch (cause) {
        console.error('Chapter cache failed', cause)
      } finally {
        downloads.current.delete(key)
        setDownloading((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })
      }
    },
    [refresh],
  )

  const request = useCallback(
    (book: Book, index: number) => {
      const key = cacheKey(book.id, index)
      if (downloading[key] !== undefined || entries.some((entry) => entry.key === key)) return
      if (entries.length >= CACHE_LIMIT) {
        setPending({ book, index, oldest: entries[0] })
        return
      }
      void start(book, index)
    },
    [downloading, entries, start],
  )

  const pause = useCallback((bookId: string, index: number) => {
    const key = cacheKey(bookId, index)
    const task = downloads.current.get(key)
    if (!task) return
    task.pause()
    setDownloading((current) => ({ ...current, [key]: { ...current[key], paused: true } }))
  }, [])

  const resume = useCallback((bookId: string, index: number) => {
    const key = cacheKey(bookId, index)
    const task = downloads.current.get(key)
    if (!task) return
    task.resume()
    setDownloading((current) => ({ ...current, [key]: { ...current[key], paused: false } }))
  }, [])

  const remove = useCallback(
    async (bookId: string, index: number) => {
      await deleteCached(cacheKey(bookId, index))
      await refresh()
    },
    [refresh],
  )

  const cached = useCallback(
    (bookId: string, index: number) => entries.find((entry) => entry.key === cacheKey(bookId, index)),
    [entries],
  )

  const value: CacheContextValue = { entries, downloading, cached, request, pause, resume, remove }

  const pendingTitle = pending ? chapterFor(pending.book, pending.index)?.title || `Chapter ${pending.index + 1}` : ''

  return (
    <CacheContext.Provider value={value}>
      {children}
      <Sheet open={Boolean(pending)} onClose={() => setPending(null)} className="cache-dialog">
        {pending ? (
          <div className="cache-dialog__body">
            <p className="micro">Cache full</p>
            <h2 className="mt-3 text-[24px] font-medium leading-[1.02] tracking-[-0.03em]">
              Replace the oldest chapter?
            </h2>
            <p className="mt-4 text-body text-muted">
              Only {CACHE_LIMIT} chapters can be cached. Caching <strong className="text-ink">{pendingTitle}</strong>{' '}
              will discard <strong className="text-ink">{pending.oldest.title}</strong>.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-3">
              <button
                type="button"
                className="min-h-11 border border-rule px-4 text-small uppercase tracking-[0.06em]"
                onClick={() => setPending(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="min-h-11 border border-rule bg-ink px-4 text-small uppercase tracking-[0.06em] text-paper"
                onClick={() => {
                  const current = pending
                  setPending(null)
                  void start(current.book, current.index, current.oldest.key)
                }}
              >
                Cache it
              </button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </CacheContext.Provider>
  )
}

export function useChapterCache(): CacheContextValue {
  const value = useContext(CacheContext)
  if (!value) throw new Error('useChapterCache must be used inside ChapterCacheProvider')
  return value
}
