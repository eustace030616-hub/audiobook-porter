import { useEffect, useRef, useState } from 'react'
import type { Theme } from '../types'
import { THEMES, type ThemePreference } from '../lib/theme'
import { Logo } from './Logo'

interface TopBarProps {
  username: string
  theme: Theme
  preference: ThemePreference
  onTheme: (theme: Theme) => void
  onSystem: () => void
  onLogout: () => void
}

export function TopBar({ username, theme, preference, onTheme, onSystem, onLogout }: TopBarProps) {
  const [open, setOpen] = useState(false)
  const control = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!control.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const initial = (username.trim().charAt(0) || 'U').toUpperCase()
  const themeIndex = Math.max(0, THEMES.findIndex((option) => option.id === theme))
  const nextTheme = THEMES[(themeIndex + 1) % THEMES.length]

  return (
    <div className="sticky top-0 z-[8] bg-paper pt-[calc(env(safe-area-inset-top)+8px)] pb-2">
      <div className="mx-auto max-w-[calc(72rem+32px)] px-4">
        <header className="flex items-baseline justify-between gap-4 border-b-2 border-rule pb-2">
          <a className="logo-link" href="/" aria-label="Clam home">
            <Logo />
          </a>
          <div className="relative" ref={control}>
            <button
              type="button"
              className={`grid h-11 w-11 place-items-center border border-rule text-small font-bold tracking-[0.08em] ${
                open ? 'bg-ink text-paper' : 'bg-surface text-ink'
              }`}
              aria-label={`Account and style for ${username}`}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {initial}
            </button>
            {open ? (
              <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[248px] border border-rule bg-surface p-4 text-ink">
                <button
                  type="button"
                  className="w-full min-h-11 border-y border-hair py-2 text-left text-micro uppercase tracking-[0.12em]"
                  onClick={onLogout}
                >
                  Log out
                </button>
                <div className="mt-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="micro">Style</p>
                    <button
                      type="button"
                      className={`text-[10px] uppercase tracking-[0.12em] underline underline-offset-[3px] ${
                        preference === 'system' ? 'text-ink' : 'text-muted'
                      }`}
                      aria-pressed={preference === 'system'}
                      onClick={onSystem}
                    >
                      Auto
                    </button>
                  </div>
                  <button
                    type="button"
                    className="theme-cycle mt-1.5"
                    aria-label={`Theme: ${THEMES[themeIndex].label}. Switch to ${nextTheme.label}`}
                    title={`Theme: ${THEMES[themeIndex].label} → ${nextTheme.label}`}
                    onClick={() => onTheme(nextTheme.id)}
                  >
                    {THEMES.map((option) => (
                      <span
                        key={option.id}
                        className={`theme-cycle__swatch theme-cycle__swatch--${option.id}${
                          option.id === theme ? ' is-active' : ''
                        }`}
                        aria-hidden="true"
                      />
                    ))}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </header>
      </div>
    </div>
  )
}
