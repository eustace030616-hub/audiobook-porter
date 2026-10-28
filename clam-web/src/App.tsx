import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { api, ApiError } from './api'
import type { Library, Stats, Theme } from './types'
import { applyTheme, readThemePreference, resolveTheme, saveThemePreference, type ThemePreference } from './lib/theme'
import { navigate, parseRoute, useLinkHandler, useLocation } from './lib/router'
import { todayKey } from './lib/progress'
import { PlayerProvider, usePlayer } from './player'
import { ChapterCacheProvider } from './chapter-cache'
import { Splash } from './components/Splash'
import { TopBar } from './components/TopBar'
import { MiniPlayer } from './components/MiniPlayer'
import { Login } from './pages/Login'
import { Home } from './pages/Home'
import { Shelf } from './pages/Shelf'
import { Cache } from './pages/Cache'
import { Book } from './pages/Book'
import { Play } from './pages/Play'
import { NotFound } from './pages/NotFound'

type AuthState = 'checking' | 'signedIn' | 'signedOut'

interface SignedInProps {
  path: string
  library: Library
  stats: Stats
  username: string
  theme: Theme
  preference: ThemePreference
  setLibrary: Dispatch<SetStateAction<Library | null>>
  reload: () => Promise<void>
  onTheme: (theme: Theme) => void
  onSystem: () => void
  onLogout: () => void
}

function SignedInApp({
  path,
  library,
  stats,
  username,
  theme,
  preference,
  setLibrary,
  reload,
  onTheme,
  onSystem,
  onLogout,
}: SignedInProps) {
  const route = parseRoute(path)
  const isPlay = route.kind === 'play'
  const player = usePlayer()

  useEffect(() => {
    if (path !== '/' && path !== '/shelf') return
    if (player.book) return
    let lastId = ''
    try { lastId = localStorage.getItem('shelf:last') || '' } catch { /* ignore */ }
    const last = library.books.find((book) => book.id === lastId)
    if (last) void player.prepare(last, { restore: true })
  }, [path, library.books, player.book, player.prepare])

  const body = (() => {
    if (route.kind === 'home') return <Home library={library} stats={stats} />
    if (route.kind === 'shelf') return <Shelf library={library} onLibrary={setLibrary} reload={reload} />
    if (route.kind === 'cache') return <Cache library={library} />
    if (route.kind === 'book') {
      const book = library.books.find((entry) => entry.id === route.id)
      return book ? <Book book={book} /> : <NotFound />
    }
    if (route.kind === 'play') {
      const book = library.books.find((entry) => entry.id === route.id)
      return book ? <Play book={book} search={route.search} /> : <NotFound />
    }
    return <NotFound />
  })()

  return (
    <div className={isPlay ? '' : 'pb-[calc(72px+env(safe-area-inset-bottom))]'}>
      {isPlay ? null : (
        <TopBar username={username} theme={theme} preference={preference} onTheme={onTheme} onSystem={onSystem} onLogout={() => { player.pause(); onLogout() }} />
      )}
      {body}
      {isPlay ? null : <MiniPlayer path={path} />}
    </div>
  )
}

export default function App() {
  useLinkHandler()
  const path = useLocation()
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference())
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(readThemePreference()))
  const [auth, setAuth] = useState<AuthState>('checking')
  const [username, setUsername] = useState('User')
  const [library, setLibrary] = useState<Library | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [bootError, setBootError] = useState('')
  const bootAt = useRef(Date.now())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const sync = () => {
      if (preference === 'system') setTheme(resolveTheme('system'))
    }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [preference])

  useEffect(() => {
    let alive = true
    void (async () => {
      const minimum = new Promise((resolve) => {
        const wait = Math.max(0, 500 - (Date.now() - bootAt.current))
        window.setTimeout(resolve, wait)
      })
      try {
        const session = await api.session()
        if (!alive) return
        if (!session.signedIn) {
          await minimum
          if (alive) setAuth('signedOut')
          return
        }
        setUsername(session.username || 'User')
        const data = await api.books()
        if (!alive) return
        setLibrary(data)
        setStats(data.stats)
        await minimum
        if (alive) setAuth('signedIn')
      } catch (cause) {
        if (!alive) return
        await minimum
        if (!alive) return
        if (cause instanceof ApiError && cause.status === 401) {
          setAuth('signedOut')
        } else {
          setBootError('Could not reach the shelf.')
          setAuth('signedOut')
        }
      }
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (auth === 'signedOut' && path !== '/login') navigate('/login', { replace: true })
    if (auth === 'signedIn' && path === '/login') navigate('/', { replace: true })
  }, [auth, path])

  const reload = useCallback(async () => {
    try {
      const data = await api.books()
      setLibrary(data)
      setStats(data.stats)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setAuth('signedOut')
        return
      }
      throw cause
    }
  }, [])

  const onSignedIn = useCallback(async (name: string) => {
    setUsername(name)
    try {
      const data = await api.books()
      setLibrary(data)
      setStats(data.stats)
      setAuth('signedIn')
      navigate('/', { replace: true })
    } catch {
      setBootError('Signed in, but the shelf could not load.')
      setAuth('signedOut')
    }
  }, [])

  const onLogout = useCallback(async () => {
    try { await api.logout() } catch { /* clear locally anyway */ }
    setLibrary(null)
    setStats(null)
    setAuth('signedOut')
    navigate('/login', { replace: true })
  }, [])

  const chooseTheme = useCallback((next: Theme) => {
    setPreference(next)
    saveThemePreference(next)
    setTheme(next)
  }, [])

  const chooseSystem = useCallback(() => {
    setPreference('system')
    saveThemePreference('system')
    setTheme(resolveTheme('system'))
  }, [])

  const addListening = useCallback((seconds: number) => {
    setStats((previous) => {
      const next = previous ?? { weekSeconds: 0, days: [] }
      const days = Array.isArray(next.days) ? next.days.map((day) => ({ ...day })) : []
      const key = todayKey()
      const day = days.find((entry) => entry.date === key)
      if (day) day.seconds = (Number(day.seconds) || 0) + seconds
      return {
        ...next,
        weekSeconds: Math.max(0, Number(next.weekSeconds) || 0) + seconds,
        days,
      }
    })
  }, [setStats])

  if (auth === 'checking') return <Splash />

  if (auth === 'signedOut') {
    if (bootError) {
      return (
        <main className="mx-auto max-w-[calc(34rem+32px)] px-4 pt-24">
          <p className="micro">Clam</p>
          <h1 className="mt-4 text-[clamp(32px,8vw,52px)] font-medium tracking-[-0.04em]">Not available.</h1>
          <p className="mt-4 text-muted">{bootError}</p>
          <p className="mt-6"><button type="button" className="min-h-11 text-micro uppercase tracking-[0.12em] underline underline-offset-[3px]" onClick={() => window.location.reload()}>Try again</button></p>
        </main>
      )
    }
    return <Login onSignedIn={onSignedIn} />
  }

  if (!library || !stats) return <Splash />

  return (
    <ChapterCacheProvider>
      <PlayerProvider onListening={addListening} onStats={setStats}>
        <SignedInApp
          path={path}
          library={library}
          stats={stats}
          username={username}
          theme={theme}
          preference={preference}
          setLibrary={setLibrary}
          reload={reload}
          onTheme={chooseTheme}
          onSystem={chooseSystem}
          onLogout={onLogout}
        />
      </PlayerProvider>
    </ChapterCacheProvider>
  )
}
