import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api } from './api'
import type { Book, SavedProgress, Stats } from './types'
import { audioUrl, chapterAt, chapterDuration, chapterFor, chapterStart, isContinuous, savedProgress } from './lib/progress'
import { cacheKey, getCachedBlob } from './lib/chapter-cache'

export type SleepTimer = { kind: 'minutes'; endsAt: number; minutes: number } | { kind: 'chapter' } | null

const SPEEDS = [0.8, 1, 1.25, 1.5] as const

function readSpeed(): number {
  try {
    const value = Number(localStorage.getItem('clam:speed'))
    if (SPEEDS.includes(value as (typeof SPEEDS)[number])) return value
  } catch {
    // fall through
  }
  return 1
}

interface PrepareOptions {
  restore?: boolean
  chapterIndex?: number | null
  autoplay?: boolean
  position?: number | null
}

interface PlayerValue {
  book: Book | null
  chapter: number
  current: number
  duration: number
  playing: boolean
  ready: boolean
  seeking: boolean
  sleep: SleepTimer
  sleepRemaining: number | null
  setSleep: (value: number | 'chapter' | null) => void
  speed: number
  cycleSpeed: () => void
  prepare: (book: Book, options?: PrepareOptions) => Promise<void>
  play: () => Promise<void>
  pause: () => void
  toggle: () => void
  seekTo: (seconds: number) => void
  setSeeking: (value: boolean) => void
  skip: (seconds: number) => void
  setChapter: (book: Book, index: number, playNow?: boolean) => void
  jumpChapter: (direction: number) => void
}

const PlayerContext = createContext<PlayerValue | null>(null)

interface PlayerProviderProps {
  children: ReactNode
  onListening: (seconds: number) => void
  onStats: (stats: Stats) => void
}

export function PlayerProvider({ children, onListening, onStats }: PlayerProviderProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const bookRef = useRef<Book | null>(null)
  const chapterRef = useRef(0)
  const readyRef = useRef(false)
  const modeRef = useRef<'continuous' | 'chapter'>('chapter')
  const blobUrlRef = useRef<string | null>(null)
  const lastServerSave = useRef(0)
  const lastTickSave = useRef(0)
  const listenSince = useRef(0)
  const [book, setBook] = useState<Book | null>(null)
  const [chapter, setChapterState] = useState(0)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [seeking, setSeekingState] = useState(false)
  const [sleep, setSleepState] = useState<SleepTimer>(null)
  const sleepRef = useRef<SleepTimer>(null)
  const [sleepRemaining, setSleepRemaining] = useState<number | null>(null)
  const [speed, setSpeedState] = useState(readSpeed)
  const speedRef = useRef(speed)

  const clearBlobUrl = useCallback(() => {
    if (!blobUrlRef.current) return
    URL.revokeObjectURL(blobUrlRef.current)
    blobUrlRef.current = null
  }, [])

  useEffect(() => clearBlobUrl, [clearBlobUrl])

  const savePosition = useCallback((beacon = false) => {
    const audio = audioRef.current
    const active = bookRef.current
    if (!audio || !active || !readyRef.current || audio.readyState < 1 || !Number.isFinite(audio.currentTime)) return
    const position = modeRef.current === 'continuous'
      ? Math.max(0, audio.currentTime - chapterStart(active, chapterRef.current))
      : Math.max(0, audio.currentTime)
    const updated = Date.now()
    try {
      localStorage.setItem(`shelf:pos:${active.id}`, JSON.stringify({
        chapter: chapterRef.current,
        position,
        updated,
      }))
      localStorage.removeItem(`shelf:position:${active.id}`)
    } catch {
      // ignore storage failures
    }
    active.chapter = chapterRef.current
    active.position = position
    active.positionUpdated = updated
    if (beacon || updated - lastServerSave.current > 5000) {
      lastServerSave.current = updated
      const progress: SavedProgress = { chapter: chapterRef.current, position, updated }
      void api.progress(active.id, progress, beacon).catch(() => {})
    }
  }, [])

  const flushListening = useCallback((beacon = false) => {
    const audio = audioRef.current
    if (!audio || !listenSince.current) return
    const now = Date.now()
    const seconds = (now - listenSince.current) / 1000
    listenSince.current = audio.paused ? 0 : now
    if (seconds < 1) return
    onListening(seconds)
    void api.listening(seconds, beacon).then((stats) => {
      if (stats) onStats(stats)
    }).catch(() => {})
  }, [onListening, onStats])

  const play = useCallback(async () => {
    const audio = audioRef.current
    if (!audio || !bookRef.current) return
    if (audio.readyState >= 1) readyRef.current = true
    try {
      await audio.play()
    } catch {
      // Autoplay rejection is expected until a user gesture.
    }
    setPlaying(!audio.paused)
  }, [])

  const setSleep = useCallback((value: number | 'chapter' | null) => {
    let next: SleepTimer = null
    if (value === 'chapter') next = { kind: 'chapter' }
    else if (value) next = { kind: 'minutes', endsAt: Date.now() + value * 60_000, minutes: value }
    sleepRef.current = next
    setSleepState(next)
    setSleepRemaining(next?.kind === 'minutes' ? Math.max(0, (next.endsAt - Date.now()) / 1000) : null)
  }, [])

  const cycleSpeed = useCallback(() => {
    const index = Math.max(0, SPEEDS.indexOf(speedRef.current as (typeof SPEEDS)[number]))
    const next = SPEEDS[(index + 1) % SPEEDS.length]
    speedRef.current = next
    setSpeedState(next)
    if (audioRef.current) audioRef.current.playbackRate = next
    try { localStorage.setItem('clam:speed', String(next)) } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!sleep || sleep.kind !== 'minutes') return
    const tick = () => {
      const remaining = Math.max(0, (sleep.endsAt - Date.now()) / 1000)
      setSleepRemaining(remaining)
      if (remaining > 0) return
      audioRef.current?.pause()
      sleepRef.current = null
      setSleepState(null)
      setSleepRemaining(null)
    }
    tick()
    const interval = window.setInterval(tick, 500)
    return () => window.clearInterval(interval)
  }, [sleep])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])

  const prepare = useCallback(async (next: Book, options: PrepareOptions = {}) => {
    const audio = audioRef.current
    if (!audio) return
    const saved = savedProgress(next)
    let target: number
    if (options.chapterIndex === null || options.chapterIndex === undefined) {
      if (bookRef.current?.id === next.id) target = chapterRef.current
      else target = options.restore ? saved.chapter : 0
    } else {
      target = options.chapterIndex
    }
    target = Math.max(0, Math.min((next.chapters.length || 1) - 1, target))
    const chapterData = chapterFor(next, target)
    const cachedBlob = !navigator.onLine ? await getCachedBlob(cacheKey(next.id, target)).catch(() => null) : null
    const continuous = isContinuous(next) && !cachedBlob
    const mode = continuous ? 'continuous' : 'chapter'
    const sameMode = modeRef.current === mode
    const sameBook = bookRef.current?.id === next.id
    const start = continuous ? chapterStart(next, target) : 0
    let relative = options.position ?? null
    if (relative === null && options.restore && saved.chapter === target) relative = saved.position

    if (continuous && sameMode && sameBook) {
      // The single file is already loaded — a chapter change is a seek, not a
      // source swap. That is what lets iOS keep playing through a locked screen.
      const moved = chapterRef.current !== target
      let position = options.position ?? null
      if (position === null && options.restore && saved.chapter === target) position = saved.position
      if (audio.readyState >= 1) {
        try {
          if (position !== null) audio.currentTime = start + position
          else if (moved) audio.currentTime = start
        } catch {
          // metadata may not be ready yet
        }
      }
      if (moved) {
        chapterRef.current = target
        setChapterState(target)
        setDuration(chapterDuration(next, target))
        setCurrent(position ?? 0)
      } else if (position !== null) {
        setCurrent(position)
      }
      readyRef.current = audio.readyState >= 1
      setReady(readyRef.current)
      if (options.autoplay) await play()
      return
    }

    const sameChapter = sameMode && sameBook && chapterRef.current === target && audio.dataset.chapter === String(target)
    if (sameChapter) {
      if (audio.readyState >= 1) readyRef.current = true
      if (options.position !== null && options.position !== undefined) {
        try { audio.currentTime = options.position } catch { /* ignore */ }
      }
      if (options.autoplay) await play()
      setCurrent(Number.isFinite(audio.currentTime) ? audio.currentTime : 0)
      return
    }

    savePosition()
    modeRef.current = mode
    bookRef.current = next
    setBook(next)
    chapterRef.current = target
    setChapterState(target)
    readyRef.current = false
    setReady(false)
    setCurrent(0)
    setDuration(continuous ? chapterDuration(next, target) : chapterData?.duration || next.duration || 0)
    try { localStorage.setItem('shelf:last', next.id) } catch { /* ignore */ }

    const wasEnded = audio.ended
    if (!wasEnded) audio.pause()
    audio.dataset.book = next.id
    audio.dataset.chapter = String(target)

    const loaded = new Promise<void>((resolve) => {
      let done = false
      let timer: number | undefined
      const finish = () => {
        if (done) return
        done = true
        if (timer) window.clearTimeout(timer)
        audio.removeEventListener('loadedmetadata', finish)
        audio.removeEventListener('error', finish)
        resolve()
      }
      timer = window.setTimeout(finish, 8000)
      audio.addEventListener('loadedmetadata', finish, { once: true })
      audio.addEventListener('error', finish, { once: true })
    })

    clearBlobUrl()
    if (cachedBlob) {
      blobUrlRef.current = URL.createObjectURL(cachedBlob)
      audio.src = blobUrlRef.current
      audio.load()
    } else {
      audio.src = audioUrl(next, target)
      if (continuous) {
        // Set the pending seek before play so a chapter click does not briefly
        // start at chapter one. iOS accepts a seek while metadata is loading.
        try { audio.currentTime = start + (relative ?? 0) } catch { /* ignore */ }
      } else {
        audio.load()
      }
    }
    // Start immediately, while the ended/click gesture is still fresh. Waiting
    // for metadata first loses the audio session on iOS.
    const earlyPlay = options.autoplay ? audio.play().catch(() => undefined) : null
    await loaded
    if (bookRef.current?.id !== next.id || chapterRef.current !== target) return

    const absolute = continuous ? start + (relative ?? 0) : relative
    if (absolute !== null) {
      try { audio.currentTime = Math.max(0, absolute) } catch { /* ignore */ }
    }
    const actualDuration = continuous
      ? chapterDuration(next, target)
      : Number.isFinite(audio.duration) ? audio.duration : chapterData?.duration || 0
    readyRef.current = true
    setReady(true)
    setDuration(actualDuration)
    setCurrent(continuous ? Math.max(0, audio.currentTime - start) : Number.isFinite(audio.currentTime) ? audio.currentTime : 0)
    savePosition()
    if (options.autoplay) {
      if (earlyPlay) await earlyPlay
      if (audio.paused) await play()
    }
  }, [play, savePosition])

  const syncContinuous = useCallback((active: Book, absolute: number) => {
    const index = chapterAt(active, absolute)
    if (index !== chapterRef.current) {
      chapterRef.current = index
      setChapterState(index)
      setDuration(chapterDuration(active, index))
    }
    setCurrent(Math.max(0, absolute - chapterStart(active, index)))
  }, [])

  const setChapter = useCallback((next: Book, index: number, playNow = false) => {
    if (!next.chapters.length) return
    const target = Math.max(0, Math.min(next.chapters.length - 1, index))
    const audio = audioRef.current
    const continuous = modeRef.current === 'continuous' && isContinuous(next)

    if (continuous && bookRef.current?.id === next.id && audio && audio.readyState >= 1) {
      savePosition()
      const start = chapterStart(next, target)
      try { audio.currentTime = start } catch { /* ignore */ }
      chapterRef.current = target
      setChapterState(target)
      setDuration(chapterDuration(next, target))
      setCurrent(0)
      readyRef.current = true
      setReady(true)
      if (playNow) void play()
      return
    }

    if (bookRef.current?.id === next.id && chapterRef.current === target) {
      if (audio) {
        try { audio.currentTime = 0 } catch { /* ignore */ }
        readyRef.current = true
        savePosition()
        if (playNow) void play()
      }
      setCurrent(0)
      return
    }
    void prepare(next, { chapterIndex: target, restore: false, autoplay: playNow, position: 0 })
  }, [play, prepare, savePosition])

  const jumpChapter = useCallback((direction: number) => {
    const active = bookRef.current
    if (!active || active.audioMode !== 'chapters' || !active.chapters.length) return
    const target = Math.max(0, Math.min(active.chapters.length - 1, chapterRef.current + direction))
    setChapter(active, target, !audioRef.current?.paused)
  }, [setChapter])

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current
    const active = bookRef.current
    if (!audio || !Number.isFinite(audio.duration)) return
    const next = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds))
    audio.currentTime = next
    if (modeRef.current === 'continuous' && active) syncContinuous(active, next)
    else setCurrent(next)
  }, [syncContinuous])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !bookRef.current) return
    if (audio.paused) void play()
    else audio.pause()
  }, [play])

  const pause = useCallback(() => {
    audioRef.current?.pause()
  }, [])

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current
    const active = bookRef.current
    if (!audio || !Number.isFinite(seconds)) return
    if (modeRef.current === 'continuous' && active) {
      const chapter = chapterRef.current
      const max = chapterDuration(active!, chapter)
      const value = Math.max(0, Math.min(max || seconds, seconds))
      audio.currentTime = chapterStart(active!, chapter) + value
      setCurrent(value)
      return
    }
    audio.currentTime = Math.max(0, Math.min(audio.duration || seconds, seconds))
    setCurrent(audio.currentTime)
  }, [])

  const setSeeking = useCallback((value: boolean) => setSeekingState(value), [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTime = () => {
      const active = bookRef.current
      if (active && modeRef.current === 'continuous') {
        const absolute = audio.currentTime
        const index = chapterAt(active, absolute)
        if (index !== chapterRef.current) {
          savePosition()
          chapterRef.current = index
          setChapterState(index)
          setDuration(chapterDuration(active, index))
          if (sleepRef.current?.kind === 'chapter') {
            audio.pause()
            sleepRef.current = null
            setSleepState(null)
            setSleepRemaining(null)
          }
          if ('mediaSession' in navigator) {
            const chapter = chapterFor(active, index)
            try {
              navigator.mediaSession.metadata = new MediaMetadata({
                title: chapter?.title || active.title,
                artist: active.authors.join(', '),
                album: active.title,
              })
            } catch {
              // metadata is best effort
            }
          }
        }
        setCurrent(Math.max(0, absolute - chapterStart(active, index)))
      } else {
        setCurrent(audio.currentTime)
      }
      if (Date.now() - lastTickSave.current > 2000) {
        lastTickSave.current = Date.now()
        savePosition()
      }
    }
    const onMeta = () => {
      audio.playbackRate = speedRef.current
      const active = bookRef.current
      if (active && modeRef.current === 'continuous') {
        setDuration(chapterDuration(active, chapterRef.current))
        setCurrent(Math.max(0, audio.currentTime - chapterStart(active, chapterRef.current)))
      } else {
        if (Number.isFinite(audio.duration)) setDuration(audio.duration)
        setCurrent(audio.currentTime)
      }
    }
    const onPlay = () => {
      audio.playbackRate = speedRef.current
      setPlaying(true)
      if (!listenSince.current) listenSince.current = Date.now()
      const active = bookRef.current
      if (active && 'mediaSession' in navigator) {
        const currentChapter = chapterFor(active, chapterRef.current)
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: currentChapter?.title || active.title,
            artist: active.authors.join(', '),
            album: active.title,
          })
          navigator.mediaSession.setActionHandler('play', () => { void play() })
          navigator.mediaSession.setActionHandler('pause', () => audio.pause())
          navigator.mediaSession.setActionHandler('seekbackward', () => skip(-15))
          navigator.mediaSession.setActionHandler('seekforward', () => skip(15))
          navigator.mediaSession.setActionHandler('previoustrack', () => jumpChapter(-1))
          navigator.mediaSession.setActionHandler('nexttrack', () => jumpChapter(1))
        } catch {
          // Some browsers reject individual handlers.
        }
      }
    }
    const onPlaying = () => {
      if (!listenSince.current) listenSince.current = Date.now()
      setPlaying(true)
    }
    const onPause = () => {
      flushListening()
      savePosition()
      setPlaying(false)
    }
    const onEnded = () => {
      flushListening()
      listenSince.current = 0
      const active = bookRef.current
      if (active && modeRef.current === 'continuous') {
        // The continuous file has reached the end of the book; chapter changes
        // are handled by timeupdate without a source swap.
        savePosition(true)
        setPlaying(false)
        return
      }
      if (sleepRef.current?.kind === 'chapter') {
        savePosition(true)
        sleepRef.current = null
        setSleepState(null)
        setSleepRemaining(null)
        setPlaying(false)
        return
      }
      if (active && active.audioMode === 'chapters' && chapterRef.current < active.chapters.length - 1) {
        void prepare(active, { chapterIndex: chapterRef.current + 1, autoplay: true, restore: false })
        return
      }
      savePosition(true)
      setPlaying(false)
    }
    const onHide = () => {
      flushListening(true)
      savePosition(true)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide()
    }
    const interval = window.setInterval(() => {
      if (!audio.paused) flushListening()
    }, 15000)

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('durationchange', onMeta)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onHide)
    document.addEventListener('freeze', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(interval)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('durationchange', onMeta)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('beforeunload', onHide)
      document.removeEventListener('freeze', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flushListening, jumpChapter, prepare, play, savePosition, skip])

  const value = useMemo<PlayerValue>(() => ({
    book,
    chapter,
    current,
    duration,
    playing,
    ready,
    seeking,
    sleep,
    sleepRemaining,
    setSleep,
    speed,
    cycleSpeed,
    prepare,
    play,
    pause,
    toggle,
    seekTo,
    setSeeking,
    skip,
    setChapter,
    jumpChapter,
  }), [book, chapter, current, duration, playing, ready, seeking, sleep, sleepRemaining, setSleep, speed, cycleSpeed, prepare, play, pause, toggle, seekTo, setSeeking, skip, setChapter, jumpChapter])

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio ref={audioRef} preload="metadata" />
    </PlayerContext.Provider>
  )
}

export function usePlayer(): PlayerValue {
  const value = useContext(PlayerContext)
  if (!value) throw new Error('usePlayer must be used inside PlayerProvider')
  return value
}
