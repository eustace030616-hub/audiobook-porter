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
import { audioUrl, chapterFor, savedProgress } from './lib/progress'

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

  const savePosition = useCallback((beacon = false) => {
    const audio = audioRef.current
    const active = bookRef.current
    if (!audio || !active || !readyRef.current || audio.readyState < 1 || !Number.isFinite(audio.currentTime)) return
    const position = Math.max(0, audio.currentTime)
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
    const sameBook = bookRef.current?.id === next.id
    const sameChapter = sameBook && chapterRef.current === target && audio.dataset.chapter === String(target)

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
    bookRef.current = next
    setBook(next)
    chapterRef.current = target
    setChapterState(target)
    readyRef.current = false
    setReady(false)
    setCurrent(0)
    setDuration(chapterData?.duration || next.duration || 0)
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

    audio.src = audioUrl(next, target)
    audio.load()
    // Start the next chapter immediately, while the ended/click gesture is still
    // fresh. Waiting for metadata first loses the audio session on iOS.
    const earlyPlay = options.autoplay
      ? audio.play().catch(() => undefined)
      : null
    await loaded
    if (bookRef.current?.id !== next.id || chapterRef.current !== target) return

    let seekTo = options.position ?? null
    if (seekTo === null && options.restore && saved.chapter === target) seekTo = saved.position
    const actualDuration = Number.isFinite(audio.duration) ? audio.duration : chapterData?.duration || 0
    if (seekTo && seekTo > 0 && (!actualDuration || seekTo < actualDuration - 1)) {
      try { audio.currentTime = seekTo } catch { /* ignore */ }
    }
    readyRef.current = true
    setReady(true)
    setDuration(actualDuration)
    setCurrent(Number.isFinite(audio.currentTime) ? audio.currentTime : 0)
    savePosition()
    if (options.autoplay) {
      if (earlyPlay) await earlyPlay
      if (audio.paused) await play()
    }
  }, [play, savePosition])

  const setChapter = useCallback((next: Book, index: number, playNow = false) => {
    if (!next.chapters.length) return
    const target = Math.max(0, Math.min(next.chapters.length - 1, index))
    if (bookRef.current?.id === next.id && chapterRef.current === target) {
      const audio = audioRef.current
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
    if (!audio || !Number.isFinite(audio.duration)) return
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds))
    setCurrent(audio.currentTime)
  }, [])

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
    if (!audio || !Number.isFinite(seconds)) return
    audio.currentTime = Math.max(0, Math.min(audio.duration || seconds, seconds))
    setCurrent(audio.currentTime)
  }, [])

  const setSeeking = useCallback((value: boolean) => setSeekingState(value), [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTime = () => {
      setCurrent(audio.currentTime)
      if (Date.now() - lastTickSave.current > 2000) {
        lastTickSave.current = Date.now()
        savePosition()
      }
    }
    const onMeta = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration)
      setCurrent(audio.currentTime)
    }
    const onPlay = () => {
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
    prepare,
    play,
    pause,
    toggle,
    seekTo,
    setSeeking,
    skip,
    setChapter,
    jumpChapter,
  }), [book, chapter, current, duration, playing, ready, seeking, prepare, play, pause, toggle, seekTo, setSeeking, skip, setChapter, jumpChapter])

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
