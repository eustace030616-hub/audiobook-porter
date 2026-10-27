import { useEffect, useRef, useState } from 'react'
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
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const [descriptionCanExpand, setDescriptionCanExpand] = useState(false)
  const [chaptersOpen, setChaptersOpen] = useState(false)
  const description = useRef<HTMLDivElement>(null)
  const chapterHeader = useRef<HTMLDivElement>(null)
  const chapterList = useRef<HTMLOListElement>(null)
  const chapterAnchor = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (!player.book) void player.prepare(book, { restore: true })
    // Prime the mini player for the book page, exactly as the old client did.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id])

  useEffect(() => {
    setDescriptionOpen(false)
    setChaptersOpen(false)
  }, [book.id])

  useEffect(() => {
    if (descriptionOpen) return
    const element = description.current
    if (!element) return
    const measure = () => setDescriptionCanExpand(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [book.description, descriptionOpen])

  const currentIndex = player.book?.id === book.id ? Math.max(0, Math.min(book.chapters.length - 1, player.chapter)) : -1
  const anchorIndex = currentIndex >= 0 ? currentIndex : 0
  const folded = currentIndex >= 0
    ? [currentIndex - 1, currentIndex, currentIndex + 1].filter((index) => index >= 0 && index < book.chapters.length)
    : [0]
  const chapterIndices = chaptersOpen ? book.chapters.map((_, index) => index) : folded

  useEffect(() => {
    if (!chaptersOpen) return
    const frame = window.requestAnimationFrame(() => {
      const header = chapterHeader.current
      if (header) {
        const top = header.getBoundingClientRect().top + window.scrollY - 64
        window.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
      }
      const list = chapterList.current
      const row = chapterAnchor.current
      if (!list || !row) return
      const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
      list.scrollTop = Math.max(0, top - 8)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [chaptersOpen, currentIndex, book.id])

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
          {book.description ? (
            <div className="book-description mt-6">
              <div
                ref={description}
                role={descriptionCanExpand ? 'button' : undefined}
                tabIndex={descriptionCanExpand ? 0 : undefined}
                className={`book-description__text${descriptionOpen ? '' : ' is-clamped'}`}
                aria-expanded={descriptionCanExpand ? descriptionOpen : undefined}
                onClick={() => {
                  if (descriptionCanExpand) setDescriptionOpen((value) => !value)
                }}
                onKeyDown={(event) => {
                  if (!descriptionCanExpand) return
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  setDescriptionOpen((value) => !value)
                }}
              >
                {book.description}
              </div>
              {descriptionCanExpand ? (
                <button
                  type="button"
                  className="book-description__more"
                  aria-expanded={descriptionOpen}
                  onClick={() => setDescriptionOpen((value) => !value)}
                >
                  {descriptionOpen ? 'Show less' : '…'}
                </button>
              ) : null}
            </div>
          ) : null}

          <section className={`book-chapters mt-10${chaptersOpen ? ' is-open' : ''}`}>
            <div ref={chapterHeader} className="book-chapters__head flex items-baseline justify-between gap-4 pb-4">
              <button
                type="button"
                className="chapter-toggle flex min-h-11 items-baseline gap-3 text-left"
                aria-expanded={chaptersOpen}
                aria-controls="book-chapter-list"
                onClick={() => setChaptersOpen((value) => !value)}
              >
                <h2 className="text-[clamp(20px,3vw,28px)] font-medium leading-[1.05] tracking-[-0.025em]">Chapters</h2>
                <span className="text-[clamp(20px,3vw,28px)] font-normal leading-none text-muted" aria-hidden="true">
                  {chaptersOpen ? '−' : '+'}
                </span>
              </button>
              <p className="micro">{book.chapters.length || 0}</p>
            </div>
            {book.chapters.length ? (
              <ol ref={chapterList} id="book-chapter-list" className="book-chapters__list border-t border-hair">
                {chapterIndices.map((index) => {
                  const chapter = book.chapters[index]
                  const isCurrent = currentIndex === index
                  return (
                    <li
                      key={index}
                      ref={index === anchorIndex ? chapterAnchor : undefined}
                      className="chapter-row border-b border-hair"
                    >
                      <button
                        type="button"
                        className="chapter-main grid min-h-11 w-full grid-cols-[3rem_1fr_auto] items-center gap-4 bg-transparent py-2 text-left text-ink hover:bg-surface-2"
                        aria-current={isCurrent ? 'true' : undefined}
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
                  )
                })}
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
