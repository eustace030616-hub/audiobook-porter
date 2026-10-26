import { useEffect, useRef, useState } from 'react'
import type { Book as BookType } from '../types'
import { chapterFor, clock, savedProgress } from '../lib/progress'
import { usePlayer } from '../player'
import { Cover } from '../components/Cover'
import { Sheet } from '../components/Sheet'
import { BackIcon, PauseIcon, PlayIcon, SeekIcon } from '../components/Icons'
import { TransportButton } from '../components/TransportButton'

interface PlayProps {
  book: BookType
  search: URLSearchParams
}

export function Play({ book, search }: PlayProps) {
  const player = usePlayer()
  const [showDescription, setShowDescription] = useState(false)
  const [chaptersOpen, setChaptersOpen] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)
  const seekTimer = useRef<number | null>(null)
  const dialogList = useRef<HTMLDivElement>(null)

  const chapterParam = Number(search.get('chapter'))
  const autoplay = search.get('autoplay') === '1'

  useEffect(() => {
    const saved = savedProgress(book)
    const target = autoplay && Number.isInteger(chapterParam) && chapterParam > 0
      ? chapterParam - 1
      : player.book?.id === book.id
        ? player.chapter
        : saved.chapter
    void player.prepare(book, { chapterIndex: target, restore: !autoplay, autoplay })
    // The route book is the only input that should switch the playing book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id])

  useEffect(() => {
    if (!chaptersOpen) return
    const element = dialogList.current?.querySelector<HTMLElement>('[aria-current="true"]')
    const previous = element?.previousElementSibling as HTMLElement | null
    ;(previous || element)?.scrollIntoView({ block: 'start' })
  }, [chaptersOpen])

  const chapterIndex = player.book?.id === book.id ? player.chapter : 0
  const chapter = chapterFor(book, chapterIndex)
  const duration = player.book?.id === book.id && player.duration ? player.duration : chapter?.duration || book.duration || 0
  const current = player.book?.id === book.id ? player.current : 0
  const shown = drag ?? current
  const percent = duration ? Math.min(100, (shown / duration) * 100) : 0
  const chapterLine = book.chapters.length ? `Chapter ${chapterIndex + 1} of ${book.chapters.length}` : book.title

  function setSeeking(value: boolean) {
    player.setSeeking(value)
    if (seekTimer.current) window.clearTimeout(seekTimer.current)
    if (value) {
      seekTimer.current = window.setTimeout(() => player.setSeeking(false), 900)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[calc(34rem+32px)] flex-col px-4 pt-[calc(env(safe-area-inset-top)+8px)] pb-[calc(env(safe-area-inset-bottom)+16px)] max-[680px]:pb-[calc(env(safe-area-inset-bottom)+8px)]">
      <header className="grid grid-cols-[44px_1fr_44px] items-center gap-2 border-b-2 border-rule pb-2">
        <a className="grid h-11 w-11 place-items-center no-underline" href={`/book/${book.id}`} aria-label="Back to book">
          <BackIcon className="h-[22px] w-[22px]" />
        </a>
        <p className="micro text-center">Now playing</p>
        <span aria-hidden="true" />
      </header>

      <div className="flex flex-1 flex-col justify-center pt-6">
        <div
          className="relative cursor-pointer"
          role="button"
          tabIndex={0}
          aria-label={showDescription ? 'Show cover' : 'Show book description'}
          onClick={() => setShowDescription((value) => !value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            setShowDescription((value) => !value)
          }}
        >
          <div className={`transition-opacity duration-200 ${showDescription ? 'invisible' : ''}`}>
            <div className="mx-auto w-[min(68vw,280px)] max-[680px]:w-[min(68vw,260px)]">
              <Cover book={book} />
            </div>
            <div className="mt-6 text-center">
              <h1 className="mt-2 text-[clamp(24px,6.5vw,32px)] font-medium leading-[1.02] tracking-[-0.035em]">
                {chapter?.title || book.title}
              </h1>
            </div>
          </div>
          <div
            className={`absolute inset-0 overflow-y-auto transition-opacity duration-200 ${
              showDescription ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            <p className="micro">From the book</p>
            <h1 className="mt-2 text-[clamp(24px,6.5vw,32px)] font-medium leading-[1.02] tracking-[-0.035em]">{book.title}</h1>
            <p className="mt-2 text-small text-muted">{book.authors.join(', ') || 'Unknown author'}</p>
            <p className="mt-4 text-muted">{book.description || 'No description for this book.'}</p>
            <p className="micro mt-4">Tap to return to the cover</p>
          </div>
        </div>

        <button
          type="button"
          className="micro mx-auto mt-2 block min-h-11 p-0 text-center uppercase tracking-[0.12em] underline underline-offset-[3px]"
          onClick={() => setChaptersOpen(true)}
          aria-label="Open chapter list"
        >
          {chapterLine}
        </button>

        <div className="mt-8">
          <div className="seek-wrap">
            <div className="seek-track" aria-hidden="true">
              <div className="seek-fill" style={{ width: `${percent}%` }} />
            </div>
            <input
              className="seek"
              type="range"
              min="0"
              max={String(Math.max(1, duration || 1))}
              step="1"
              value={String(shown)}
              aria-label="Seek"
              onPointerDown={() => {
                setDrag(current)
                setSeeking(true)
              }}
              onInput={(event) => {
                const value = Number(event.currentTarget.value)
                setDrag(value)
                player.seekTo(value)
                setSeeking(true)
              }}
              onPointerUp={() => {
                setDrag(null)
                setSeeking(false)
              }}
              onChange={() => {
                setDrag(null)
                setSeeking(false)
              }}
            />
          </div>
          <div className="flex justify-between text-micro text-muted tabular-nums">
            <span>{clock(shown)}</span>
            <span>{clock(duration)}</span>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-8 max-[680px]:gap-6">
          <TransportButton
            direction={-1}
            className="grid h-14 w-14 place-items-center border border-rule text-ink active:bg-ink active:text-paper"
            label="Back 15 seconds, hold for previous chapter"
          >
            <SeekIcon direction={-1} />
          </TransportButton>
          <button
            type="button"
            className="grid h-[72px] w-[72px] place-items-center text-ink active:text-muted"
            aria-label={player.playing ? 'Pause' : 'Play'}
            onClick={player.toggle}
          >
            {player.playing ? <PauseIcon className="h-[38px] w-[38px]" /> : <PlayIcon className="h-[38px] w-[38px]" />}
          </button>
          <TransportButton
            direction={1}
            className="grid h-14 w-14 place-items-center border border-rule text-ink active:bg-ink active:text-paper"
            label="Forward 15 seconds, hold for next chapter"
          >
            <SeekIcon direction={1} />
          </TransportButton>
        </div>
      </div>

      <Sheet open={chaptersOpen} onClose={() => setChaptersOpen(false)}>
        <header className="dialog-head">
          <h2>Chapters</h2>
        </header>
        <div className="dialog-list" ref={dialogList}>
          {book.chapters.map((item, index) => (
            <button
              key={index}
              type="button"
              className="dialog-chapter"
              aria-current={index === chapterIndex ? 'true' : undefined}
              onClick={() => {
                player.setChapter(book, index, true)
                setChaptersOpen(false)
              }}
            >
              <span className="micro text-[10px]">{String(index + 1).padStart(2, '0')}</span>
              <span>{item.title}</span>
              <span className="micro text-[10px]">{clock(item.start / 1000)}</span>
            </button>
          ))}
        </div>
      </Sheet>
    </main>
  )
}
