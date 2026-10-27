import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Book as BookType } from '../types'
import { chapterFor, clock, savedProgress } from '../lib/progress'
import { cueAt, loadTranscript, type Transcript } from '../lib/subtitles'
import { loadWordbook, segmentWords, type WordSegment } from '../lib/wordlookup'
import { WordBanner, type WordSelection } from '../components/WordBanner'
import { usePlayer } from '../player'
import { Cover } from '../components/Cover'
import { Sheet } from '../components/Sheet'
import { CacheButton } from '../components/CacheButton'
import { BackIcon, PauseIcon, PlayIcon, SeekIcon } from '../components/Icons'
import { TransportButton } from '../components/TransportButton'

function shortTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

type WordHandler = (surface: string, sentence: string, cueStart: number) => void

interface WordButtonsProps {
  segments: WordSegment[]
  sentence: string
  cueStart: number
  onWord: WordHandler
}

const WordButtons = memo(function WordButtons({ segments, sentence, cueStart, onWord }: WordButtonsProps) {
  return segments.map((part, index) =>
    part.word ? (
      <button
        key={index}
        type="button"
        className="transcript__word"
        onClick={() => onWord(part.text, sentence, cueStart)}
      >
        {part.text}
      </button>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  )
})

interface PlayProps {
  book: BookType
  search: URLSearchParams
}

export function Play({ book, search }: PlayProps) {
  const player = usePlayer()
  const [showDescription, setShowDescription] = useState(false)
  const [chaptersOpen, setChaptersOpen] = useState(false)
  const [sleepOpen, setSleepOpen] = useState(false)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [transcriptLoading, setTranscriptLoading] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)
  const [word, setWord] = useState<WordSelection | null>(null)
  const seekTimer = useRef<number | null>(null)
  const dialogList = useRef<HTMLDivElement>(null)
  const currentCue = useRef<HTMLParagraphElement>(null)
  const textOverlay = useRef<HTMLDivElement>(null)

  const chapterParam = Number(search.get('chapter'))
  const autoplay = search.get('autoplay') === '1'

  useEffect(() => {
    const saved = savedProgress(book)
    const target = Number.isInteger(chapterParam) && chapterParam > 0
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
  const currentCueIndex = transcript ? cueAt(transcript.cues, current) : -1
  const cueSegments = useMemo(
    () => transcript?.cues.map((cue) => segmentWords(cue.text)) ?? [],
    [transcript],
  )

  const openWord = useCallback<WordHandler>((surface, sentence, cueStart) => {
    setWord({
      surface,
      sentence,
      cueStart,
      bookId: book.id,
      bookTitle: book.title,
      chapterIndex,
      chapterTitle: chapter?.title || book.title,
    })
  }, [book.id, book.title, chapter?.title, chapterIndex])

  useEffect(() => {
    setTranscript(null)
    setTranscriptLoading(false)
    setWord(null)
    const url = chapter?.subtitleUrl
    if (!url) return
    let alive = true
    setTranscriptLoading(true)
    void loadTranscript(url).then((value) => {
      if (!alive) return
      setTranscript(value)
      setTranscriptLoading(false)
    })
    return () => { alive = false }
  }, [chapter?.subtitleUrl])

  useEffect(() => {
    if (!showDescription) setWord(null)
  }, [showDescription])

  useEffect(() => {
    if (!showDescription || !transcript) return
    void loadWordbook().catch(() => undefined)
  }, [showDescription, transcript])

  useEffect(() => {
    if (!showDescription || !transcript) return
    const overlay = textOverlay.current
    const cue = currentCue.current
    if (!overlay || !cue) return
    const frame = window.requestAnimationFrame(() => {
      const cueTop = cue.getBoundingClientRect().top - overlay.getBoundingClientRect().top + overlay.scrollTop
      overlay.scrollTop = Math.max(0, cueTop - overlay.clientHeight * 0.7)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [showDescription, transcript, currentCueIndex])
  const speedLabel = player.speed === 1 ? '1×' : `${player.speed}×`
  const sleepSeconds = Math.max(0, Math.ceil(player.sleepRemaining || 0))
  const sleepLabel = !player.sleep
    ? 'Sleep'
    : player.sleep.kind === 'chapter'
      ? 'End chapter'
      : `${Math.floor(sleepSeconds / 60)}:${String(sleepSeconds % 60).padStart(2, '0')}`
  const textToggleLabel = showDescription ? 'Cover' : chapter?.subtitleUrl ? 'Transcript' : 'Description'

  function setSeeking(value: boolean) {
    player.setSeeking(value)
    if (seekTimer.current) window.clearTimeout(seekTimer.current)
    if (value) {
      seekTimer.current = window.setTimeout(() => player.setSeeking(false), 900)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[calc(34rem+32px)] flex-col px-4 pt-[calc(env(safe-area-inset-top)+8px)] pb-[calc(env(safe-area-inset-bottom)+16px)] max-[680px]:pb-[calc(env(safe-area-inset-bottom)+8px)]">
      <header className="flex items-center justify-between gap-4 border-b-2 border-rule pb-2">
        <a className="grid h-11 w-11 place-items-center no-underline" href={`/book/${book.id}`} aria-label="Back to book">
          <BackIcon className="h-[22px] w-[22px]" />
        </a>
        <div className="flex items-baseline gap-4">
          <button
            type="button"
            className={`min-h-11 p-0 text-micro uppercase tracking-[0.12em] ${player.sleep ? 'font-medium text-ink' : 'text-muted'}`}
            aria-label="Sleep timer"
            onClick={() => setSleepOpen(true)}
          >
            {sleepLabel}
          </button>
          <button
            type="button"
            className="min-h-11 p-0 text-micro uppercase tracking-[0.08em] text-muted"
            aria-label={`Playback speed ${speedLabel}`}
            title="Playback speed"
            onClick={player.cycleSpeed}
          >
            {speedLabel}
          </button>
        </div>
      </header>

      <div className="play-stage relative flex min-h-0 flex-1 flex-col justify-center pt-6">
        <div>
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
        </div>

        <div
          ref={textOverlay}
          className={`play-text-overlay absolute inset-0 overflow-y-auto bg-paper transition-opacity duration-200 ${
            showDescription ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          {transcript ? (
            <div>
              <div className="transcript__top-space" aria-hidden="true" />
              <p className="micro">Transcription · Deutsch</p>
              <h1 className="mt-2 text-[clamp(20px,5vw,26px)] font-medium leading-[1.06] tracking-[-0.03em]">{chapter?.title || book.title}</h1>
              <div className="transcript mt-5">
                {transcript.cues.map((cue, index) => (
                  <div key={`${cue.start}-${index}`} className="transcript__row">
                    <button
                      type="button"
                      className="transcript__time"
                      aria-label={`Jump to ${shortTime(cue.start)}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        player.seekTo(cue.start)
                      }}
                    >
                      {shortTime(cue.start)}
                    </button>
                    <p
                      ref={index === currentCueIndex ? currentCue : undefined}
                      className={`transcript__cue${index === currentCueIndex ? ' is-current' : ''}`}
                      aria-current={index === currentCueIndex ? 'true' : undefined}
                    >
                      <WordButtons
                        segments={cueSegments[index] ?? []}
                        sentence={cue.text}
                        cueStart={cue.start}
                        onWord={openWord}
                      />
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : transcriptLoading ? (
            <p className="micro">Loading transcription…</p>
          ) : (
            <>
              <p className="micro">From the book</p>
              <h1 className="mt-2 text-[clamp(24px,6.5vw,32px)] font-medium leading-[1.02] tracking-[-0.035em]">{book.title}</h1>
              <p className="mt-2 text-small text-muted">{book.authors.join(', ') || 'Unknown author'}</p>
              <p className="mt-4 text-muted">{book.description || 'No description for this book.'}</p>
              <p className="micro mt-4">Tap to return to the cover</p>
            </>
          )}
        </div>
        {showDescription ? (
          <>
            <div className="transcript-edge transcript-edge--top" aria-hidden="true" />
            <div className="transcript-edge transcript-edge--bottom" aria-hidden="true" />
          </>
        ) : null}
      </div>

      <div className="play-lower">
        <WordBanner selection={word} />

        <div className="mt-3 flex items-center justify-between gap-4">
          <button
            type="button"
            className="min-h-11 p-0 text-micro uppercase tracking-[0.12em] text-muted underline underline-offset-[3px]"
            aria-label={showDescription ? 'Show cover' : `Show ${textToggleLabel.toLowerCase()}`}
            onClick={() => setShowDescription((value) => !value)}
          >
            {textToggleLabel}
          </button>
          <button
            type="button"
            className="min-h-11 p-0 text-right text-micro uppercase tracking-[0.12em] text-muted underline underline-offset-[3px]"
            onClick={() => setChaptersOpen(true)}
            aria-label="Open chapter list"
          >
            {chapterLine}
          </button>
        </div>
      </div>

        <div className="mt-3">
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

      <Sheet open={chaptersOpen} onClose={() => setChaptersOpen(false)}>
        <header className="dialog-head">
          <h2>Chapters</h2>
        </header>
        <div className="dialog-list" ref={dialogList}>
          {book.chapters.map((item, index) => (
            <div key={index} className="dialog-chapter-row">
              <button
                type="button"
                className="dialog-chapter"
                aria-current={index === chapterIndex ? 'true' : undefined}
                onClick={() => {
                  player.setChapter(book, index, true)
                  setChaptersOpen(false)
                }}
              >
                <span className="micro text-[10px]">{String(index + 1).padStart(2, '0')}</span>
                <span className="dialog-chapter__title">{item.title}</span>
                <span className="micro text-[10px]">{clock(item.start / 1000)}</span>
              </button>
              <CacheButton book={book} index={index} />
            </div>
          ))}
        </div>
      </Sheet>

      <Sheet open={sleepOpen} onClose={() => setSleepOpen(false)}>
        <header className="dialog-head">
          <h2>Sleep timer</h2>
          <button
            type="button"
            className="min-h-11 text-micro uppercase tracking-[0.12em] text-muted underline underline-offset-[3px]"
            onClick={() => setSleepOpen(false)}
          >
            Close
          </button>
        </header>
        <div className="px-4 pb-4">
          {([
            { label: 'Off', value: null },
            { label: '15 minutes', value: 15 },
            { label: '30 minutes', value: 30 },
            { label: '45 minutes', value: 45 },
            { label: 'End of chapter', value: 'chapter' },
          ] as const).map((option) => {
            const active =
              option.value === null
                ? !player.sleep
                : option.value === 'chapter'
                  ? player.sleep?.kind === 'chapter'
                  : player.sleep?.kind === 'minutes' && player.sleep.minutes === option.value
            return (
              <button
                key={option.label}
                type="button"
                className={`flex min-h-11 w-full items-center justify-between border-b border-hair py-3 text-left text-body ${
                  active ? 'font-medium text-accent' : 'text-ink'
                }`}
                onClick={() => {
                  player.setSleep(option.value)
                  setSleepOpen(false)
                }}
              >
                <span>{option.label}</span>
                {active ? <span aria-hidden="true">✓</span> : null}
              </button>
            )
          })}
        </div>
      </Sheet>
    </main>
  )
}
