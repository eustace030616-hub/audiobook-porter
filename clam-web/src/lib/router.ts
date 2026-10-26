import { useEffect, useState } from 'react'

function current(): string {
  return `${window.location.pathname}${window.location.search}`
}

export function navigate(to: string, { replace = false } = {}): void {
  if (to === current()) return
  if (replace) window.history.replaceState({}, '', to)
  else window.history.pushState({}, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useLocation(): string {
  const [path, setPath] = useState(current)

  useEffect(() => {
    const update = () => setPath(current())
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])

  return path
}

export function useLinkHandler(): void {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target as Element | null
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      if (anchor.target || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/audio/') || url.pathname.startsWith('/cover/')) return
      event.preventDefault()
      navigate(`${url.pathname}${url.search}`)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])
}

export type Route =
  | { kind: 'home' }
  | { kind: 'shelf' }
  | { kind: 'cache' }
  | { kind: 'book'; id: string }
  | { kind: 'play'; id: string; search: URLSearchParams }
  | { kind: 'login' }
  | { kind: 'notFound' }

export function parseRoute(path: string): Route {
  const url = new URL(path, window.location.origin)
  if (url.pathname === '/' || url.pathname === '') return { kind: 'home' }
  if (url.pathname === '/shelf') return { kind: 'shelf' }
  if (url.pathname === '/cache') return { kind: 'cache' }
  if (url.pathname === '/login') return { kind: 'login' }
  const book = url.pathname.match(/^\/book\/([a-f0-9]{12})\/?$/)
  if (book) return { kind: 'book', id: book[1] }
  const play = url.pathname.match(/^\/play\/([a-f0-9]{12})\/?$/)
  if (play) return { kind: 'play', id: play[1], search: url.searchParams }
  return { kind: 'notFound' }
}
