import type { CSSProperties } from 'react'
import { chapterFor, clock } from '../lib/progress'
import { usePlayer } from '../player'
import { ChevronIcon, PauseIcon, PlayIcon, SeekIcon } from './Icons'
import { TransportButton } from './TransportButton'

interface MiniPlayerProps {
  path: string
}

export function MiniPlayer({ path }: MiniPlayerProps) {
  const { book, chapter, current, duration, playing, toggle } = usePlayer()
  if (path.startsWith('/play/')) return null

  const percent = duration ? Math.min(100, (current / duration) * 100) : 0

  return (
    <div className="fixed right-0 bottom-0 left-0 z-30 bg-player-bg pb-[env(safe-area-inset-bottom)] text-player-fg">
      <div className="h-0.5 bg-[#3a3a3a]">
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      {book ? (
        <div className="relative">
          <a
            className="absolute top-0 right-0 left-0 z-[2] h-6"
            href={`/play/${book.id}`}
            aria-label="Open player"
          />
          <div className="mx-auto flex max-w-[72rem] items-center gap-2 px-4 py-2 max-[680px]:px-3 max-[680px]:py-1.5">
            <div
              className={`mini-cover ${book.coverUrl ? 'mini-cover--image' : ''}`}
              style={{ '--ribbon': book.ribbon } as CSSProperties}
            >
              {book.coverUrl ? <img src={book.coverUrl} alt="" /> : null}
            </div>
            <a className="min-w-0 flex-1 text-player-fg no-underline" href={`/play/${book.id}`} title="Open player">
              <div className="truncate text-small leading-tight">{chapterFor(book, chapter)?.title || book.title}</div>
              <div className="truncate text-[10px] uppercase tracking-[0.06em] text-[#a8a8a8]">
                {book.title} · <span>{clock(current)}</span>
              </div>
            </a>
            <div className="flex items-center">
              <TransportButton
                direction={-1}
                className="grid h-11 w-11 place-items-center text-player-fg active:bg-player-fg active:text-player-bg"
                label="Back 15 seconds, hold for previous chapter"
              >
                <SeekIcon direction={-1} className="text-[18px]" />
              </TransportButton>
              <button
                type="button"
                className="grid h-11 w-11 place-items-center text-player-fg active:bg-player-fg active:text-player-bg"
                aria-label={playing ? 'Pause' : 'Play'}
                onClick={toggle}
              >
                {playing ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
              </button>
              <TransportButton
                direction={1}
                className="grid h-11 w-11 place-items-center text-player-fg active:bg-player-fg active:text-player-bg"
                label="Forward 15 seconds, hold for next chapter"
              >
                <SeekIcon direction={1} className="text-[18px]" />
              </TransportButton>
              <a
                className="ml-1 grid h-11 w-11 place-items-center text-player-fg"
                href={`/play/${book.id}`}
                aria-label="Open player"
                title="Open player"
              >
                <ChevronIcon className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>
      ) : (
        <a className="flex min-h-11 items-center justify-between gap-4 px-4 py-1.5 text-player-fg no-underline" href="/shelf">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-small leading-tight">Nothing playing</span>
            <span className="text-[10px] uppercase tracking-[0.06em] text-[#a8a8a8]">
              {path === '/shelf' ? 'Choose a book above' : 'Open your shelf'}
            </span>
          </span>
          <span className="flex-none text-2xl leading-none" aria-hidden="true">→</span>
        </a>
      )}
    </div>
  )
}
