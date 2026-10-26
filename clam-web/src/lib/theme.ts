import type { Theme } from '../types'

export const THEMES: { id: Theme; label: string }[] = [
  { id: 'paper', label: 'Paper' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'night', label: 'Night' },
]

const KEY = 'clam:theme'
const COLORS: Record<Theme, string> = {
  paper: '#fafafa',
  sepia: '#f3ead8',
  night: '#101012',
}

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'paper' || stored === 'sepia' || stored === 'night') return stored
  } catch {
    // fall through
  }
  return 'paper'
}

export function applyTheme(theme: Theme, persist = true): void {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme === 'night' ? 'dark' : 'light'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', COLORS[theme])
  if (persist) {
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      // Storage is a convenience, not state.
    }
  }
  for (const button of document.querySelectorAll<HTMLElement>('[data-theme-choice]')) {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme))
  }
}
