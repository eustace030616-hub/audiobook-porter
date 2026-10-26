import type { Book } from '../types'
import { cacheKey } from '../lib/chapter-cache'
import { useChapterCache } from '../chapter-cache'

export function CacheButton({ book, index }: { book: Book; index: number }) {
  const { cached, downloading, request } = useChapterCache()
  const key = cacheKey(book.id, index)
  const entry = cached(book.id, index)
  const progress = downloading[key]

  if (progress !== undefined) {
    return (
      <span className="cache-button" aria-label="Caching chapter" role="status">
        <span className="cache-button__progress tabular-nums">{Math.round(progress * 100)}</span>
      </span>
    )
  }

  if (entry) {
    return (
      <span className="cache-button is-cached" role="img" aria-label="Cached chapter" title="Cached">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      </span>
    )
  }

  return (
    <button
      type="button"
      className="cache-button"
      aria-label="Cache chapter"
      title="Cache chapter"
      onClick={() => request(book, index)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </button>
  )
}
