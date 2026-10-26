import type { Book } from '../types'
import { cacheKey } from '../lib/chapter-cache'
import { useChapterCache } from '../chapter-cache'

export function CacheButton({ book, index }: { book: Book; index: number }) {
  const { cached, downloading, request, pause, resume, remove } = useChapterCache()
  const key = cacheKey(book.id, index)
  const entry = cached(book.id, index)
  const task = downloading[key]

  if (task) {
    const percent = Math.round(task.progress * 100)
    return (
      <button
        type="button"
        className={`cache-button is-downloading${task.paused ? ' is-paused' : ''}`}
        aria-label={task.paused ? `Resume caching chapter, ${percent}%` : `Pause caching chapter, ${percent}%`}
        title={task.paused ? 'Resume download' : 'Pause download'}
        onClick={() => (task.paused ? resume(book.id, index) : pause(book.id, index))}
      >
        {task.paused ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" />
          </svg>
        )}
        <span className="cache-button__progress tabular-nums">{percent}</span>
      </button>
    )
  }

  if (entry) {
    return (
      <button
        type="button"
        className="cache-button is-cached"
        aria-label={`Delete cached chapter ${entry.title}`}
        title="Cached — tap to delete"
        onClick={() => void remove(book.id, index)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      </button>
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
