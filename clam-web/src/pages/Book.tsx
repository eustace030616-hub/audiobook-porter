import { useEffect } from 'react'
import type { Book as BookType } from '../types'
import { clock } from '../lib/progress'
import { navigate } from '../lib/router'
import { usePlayer } from '../player'
import { Cover } from '../components/Cover'
import { CacheButton } from '../components/CacheButton'

interface BookProps {
  book: BookType
}

export function Book({ book }: BookProps) {
  const player = usePlayer()

  useEffect(() => {
    if (!player.book) void player.prepare(book, { restore: true })
    // Prime the mini player for the book page, exactly as the old client did.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id])

  return (
    <main className="mx-auto max-w-[calc(72rem+32px)] px-4 pt-8 pb-8">
      <a className="inline-block min-h-11 py-2 text-micro uppercase tracking-[0.12em] no-underline" href="/shelf">
        ← Your shelf
      </a>
      <div className="mt-6 grid grid-cols-[240px_1fr] items-start gap-8 max-[680px]:grid-cols-1">
        <div className="w-full max-[680px]:max-w-[220px]">
          <Cover book={book} />
        </div>
        <div>
          <p className="micro">
            {book.shelf}
            {book.sequence ? ` · Book ${book.sequence}` : ''}
          </p>
          <h1 className="mt-4 text-[clamp(32px,5vw,52px)] font-medium leading-[0.98] tracking-[-0.04em]">{book.title}</h1>
          <p className="mt-4 text-small text-muted">
            {book.authors.join(', ') || 'Unknown author'}
            {book.narrator ? ` · read by ${book.narrator}` : ''}
          </p>
          {book.description ? <p className="mt-6 max-w-[58ch] text-muted">{book.description}</p> : null}

          <section className="mt-10">
            <div className="flex items-baseline justify-between gap-4 pb-4">
              <h2 className="text-[clamp(20px,3vw,28px)] font-medium leading-[1.05] tracking-[-0.025em]">Chapters</h2>
              <p className="micro">{book.chapters.length || 0}</p>
            </div>
            {book.chapters.length ? (
              <ol className="border-t border-hair">
                {book.chapters.map((chapter, index) => (
                  <li key={index} className="chapter-row border-b border-hair">
                    <button
                      type="button"
                      className="chapter-main grid min-h-11 w-full grid-cols-[3rem_1fr_auto] items-center gap-4 bg-transparent py-2 text-left text-ink hover:bg-surface-2"
                      aria-current={player.book?.id === book.id && index === player.chapter ? 'true' : undefined}
                      onClick={() => {
                        void player.prepare(book, { chapterIndex: index, restore: false, autoplay: true })
                        navigate(`/play/${book.id}?chapter=${index + 1}&autoplay=1`)
                      }}
                    >
                      <span className="text-micro text-muted">{String(index + 1).padStart(2, '0')}</span>
                      <span className="chapter-title text-body">{chapter.title}</span>
                      <span className="text-micro text-muted tabular-nums">{clock(chapter.start / 1000)}</span>
                    </button>
                    <CacheButton book={book} index={index} />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted">No chapters.</p>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
