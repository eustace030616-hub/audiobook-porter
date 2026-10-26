import type { ReactNode } from 'react'
import type { Book, Library, Stats } from '../types'
import { chapterFor, clock, weekBars } from '../lib/progress'
import { usePlayer } from '../player'
import { Cover } from '../components/Cover'
import { ChevronIcon } from '../components/Icons'

interface HomeProps {
  library: Library
  stats: Stats
}

function lastBook(library: Library, active: Book | null): Book | null {
  if (active) return active
  let id = ''
  try { id = localStorage.getItem('shelf:last') || '' } catch { /* ignore */ }
  return library.books.find((book) => book.id === id) || null
}

function SectionHead({ id, children, aside }: { id: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="micro flex-none" id={id}>{children}</h2>
      <span className="h-px flex-1 bg-hair" aria-hidden="true" />
      {aside}
    </div>
  )
}

export function Home({ library, stats }: HomeProps) {
  const player = usePlayer()
  const book = lastBook(library, player.book)
  const index = book ? Math.max(0, Math.min((book.chapters.length || 1) - 1, Number(book.chapter) || 0)) : 0
  const chapter = book ? chapterFor(book, index) : null
  const duration = chapter?.duration || 0
  const position = book ? Math.max(0, player.book?.id === book.id ? player.current : Number(book.position) || 0) : 0
  const percent = duration ? Math.min(100, (position / duration) * 100) : 0
  const bars = weekBars(stats)
  const hours = (Math.max(0, Number(stats.weekSeconds) || 0) / 3600).toFixed(1)

  return (
    <main className="mx-auto max-w-[calc(56rem+32px)] px-4 pt-12 pb-8 max-[680px]:pt-8">
      <a
        className="flex items-baseline justify-between gap-4 border-b-2 border-rule pb-4 no-underline"
        href="/shelf"
      >
        <h1 className="text-[clamp(40px,8vw,64px)] font-medium leading-[0.94] tracking-[-0.05em]">Your shelf</h1>
        <span className="flex-none text-micro font-medium uppercase tracking-[0.14em] text-muted underline underline-offset-4">
          All books <span aria-hidden="true">→</span>
        </span>
      </a>

      <section className="mt-12" aria-labelledby="continue-title">
        <SectionHead id="continue-title">Continue listening</SectionHead>
        {book ? (
          <a
            className="mt-4 grid grid-cols-[96px_minmax(0,1fr)_44px] items-center gap-6 border-b border-hair py-4 no-underline max-[680px]:grid-cols-[72px_minmax(0,1fr)_44px] max-[680px]:gap-4"
            href={`/play/${book.id}`}
          >
            <div className="w-24 max-[680px]:w-[72px]">
              <Cover book={book} className="cover--compact" />
            </div>
            <div className="min-w-0">
              <p className="micro">{book.shelf}</p>
              <h3 className="mt-1 text-[clamp(24px,4vw,34px)] font-medium leading-[1.02] tracking-[-0.035em]">
                {book.title}
              </h3>
              <p className="mt-2 text-small text-muted">
                {chapter ? `Chapter ${index + 1} · ${chapter.title}` : 'Open player'}
              </p>
              <div className="mt-4 h-0.5 bg-hair">
                <span className="block h-full bg-accent" style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-2 text-micro uppercase tracking-[0.08em] text-muted">
                {position > 0 ? `${clock(position)} / ${clock(duration)}` : book.durationLabel || 'Start listening'}
              </p>
            </div>
            <span className="grid h-11 w-11 place-items-center" aria-hidden="true">
              <ChevronIcon className="h-6 w-6" />
            </span>
          </a>
        ) : (
          <div className="mt-4 flex items-baseline justify-between gap-4 border-b border-hair py-6">
            <p className="text-muted">Nothing in progress.</p>
            <a className="flex-none text-micro uppercase tracking-[0.12em]" href="/shelf">
              Choose a book <span aria-hidden="true">→</span>
            </a>
          </div>
        )}
      </section>

      <section className="mt-12 border-t-2 border-rule pt-4" aria-labelledby="stats-title">
        <SectionHead id="stats-title" aside={<p className="micro flex-none">Mon–Sun</p>}>
          Listening this week
        </SectionHead>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-[clamp(56px,12vw,96px)] font-medium leading-[0.86] tracking-[-0.06em] max-[680px]:text-[clamp(56px,18vw,88px)]">{hours}</span>
          <span className="text-micro uppercase tracking-[0.14em] text-muted">hours</span>
        </div>
        <div className="mt-6 grid h-[104px] grid-cols-7 items-end gap-2 max-[680px]:h-[88px]">
          {bars.map((bar, barIndex) => (
            <div key={barIndex} className="flex h-full flex-col items-center justify-end gap-2">
              <span className="flex h-[72px] w-full max-w-6 items-end bg-hair max-[680px]:h-[60px]">
                <span className="block w-full bg-ink" style={{ height: `${bar.height}%` }} />
              </span>
              <span className="text-[10px] uppercase tracking-[0.1em] text-muted">{bar.label}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
