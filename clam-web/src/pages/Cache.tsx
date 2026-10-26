import type { Library } from '../types'
import { useChapterCache } from '../chapter-cache'
import { Cover } from '../components/Cover'

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1_000))} KB`
}

export function Cache({ library }: { library: Library }) {
  const { entries, remove } = useChapterCache()
  const groups = library.books
    .map((book) => ({
      book,
      chapters: entries
        .filter((entry) => entry.bookId === book.id)
        .sort((a, b) => a.chapterIndex - b.chapterIndex),
    }))
    .filter((group) => group.chapters.length)
    .sort((a, b) => a.book.title.localeCompare(b.book.title))
  const total = entries.reduce((sum, entry) => sum + entry.size, 0)

  return (
    <main className="mx-auto max-w-[calc(72rem+32px)] px-4 pt-8 pb-8">
      <a className="inline-block min-h-11 py-2 text-micro uppercase tracking-[0.12em] no-underline" href="/shelf">
        ← Your shelf
      </a>
      <header className="mt-4 flex items-baseline justify-between gap-4 border-b-2 border-rule pb-4">
        <h1 className="text-[clamp(34px,7vw,52px)] font-medium leading-[0.95] tracking-[-0.045em]">Cached</h1>
        <p className="micro text-right">
          {entries.length} / 3 chapters
          {total ? <> · {formatSize(total)}</> : null}
        </p>
      </header>

      {groups.length ? (
        groups.map((group) => (
          <section key={group.book.id} className="mt-10 border-t-2 border-rule pt-4">
            <header className="grid grid-cols-[96px_minmax(0,1fr)_auto] items-start gap-6 max-[680px]:grid-cols-[72px_minmax(0,1fr)] max-[680px]:gap-4">
              <a className="block no-underline" href={`/book/${group.book.id}`} aria-label={group.book.title}>
                <Cover book={group.book} className="cover--compact" />
              </a>
              <div className="min-w-0">
                <p className="micro">{group.book.shelf}</p>
                <h2 className="mt-1 text-[clamp(22px,4vw,32px)] font-medium leading-[1.02] tracking-[-0.035em]">
                  {group.book.title}
                </h2>
                <p className="mt-2 text-small text-muted">{group.book.authors.join(', ') || 'Unknown author'}</p>
              </div>
              <p className="micro text-right max-[680px]:col-start-2 max-[680px]:row-start-2 max-[680px]:mt-2 max-[680px]:text-left">
                {group.chapters.length} {group.chapters.length === 1 ? 'chapter' : 'chapters'} ·{' '}
                {formatSize(group.chapters.reduce((sum, entry) => sum + entry.size, 0))}
              </p>
            </header>
            <ol className="mt-4 border-t border-hair">
              {group.chapters.map((entry) => (
                <li
                  key={entry.key}
                  className="grid min-h-11 grid-cols-[2rem_minmax(0,1fr)_auto_44px] items-center gap-4 border-b border-hair"
                >
                  <span className="text-micro text-muted">{String(entry.chapterIndex + 1).padStart(2, '0')}</span>
                  <span className="truncate text-body">{entry.title}</span>
                  <span className="text-micro text-muted tabular-nums">{formatSize(entry.size)}</span>
                  <button
                    type="button"
                    className="grid h-11 w-11 place-items-center text-muted active:text-ink"
                    aria-label={`Remove cached ${entry.title}`}
                    title="Remove cache"
                    onClick={() => void remove(entry.bookId, entry.chapterIndex)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ))
      ) : (
        <div className="pt-24">
          <p className="micro">Cache</p>
          <h1 className="mt-4 text-[clamp(32px,8vw,52px)] font-medium leading-[1.02] tracking-[-0.04em]">
            Nothing cached yet.
          </h1>
          <p className="mt-4 max-w-[34rem] text-muted">
            Download a chapter from any book. Three chapters stay on this device for offline listening.
          </p>
          <a className="mt-8 inline-block min-h-11 border border-rule bg-ink px-6 py-3 text-small uppercase tracking-[0.06em] text-paper no-underline" href="/shelf">
            Browse the shelf
          </a>
        </div>
      )}
    </main>
  )
}
