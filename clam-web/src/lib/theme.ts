import type { Theme } from '../types'

export type ThemePreference = Theme | 'system'

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

function isTheme(value: unknown): value is Theme {
  return value === 'paper' || value === 'sepia' || value === 'night'
}

export function systemTheme(): Theme {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'paper'
  } catch {
    return 'paper'
  }
}

export function resolveTheme(preference: ThemePreference): Theme {
  return preference === 'system' ? systemTheme() : preference
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'system' || isTheme(stored)) return stored
  } catch {
    // fall through
  }
  return 'system'
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(KEY, preference)
  } catch {
    // Storage is a convenience, not state.
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme === 'night' ? 'dark' : 'light'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', COLORS[theme])
}
