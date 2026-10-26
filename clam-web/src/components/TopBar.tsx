import { useEffect, useRef, useState } from 'react'
import type { Theme } from '../types'
import { THEMES } from '../lib/theme'

interface TopBarProps {
  username: string
  theme: Theme
  onTheme: (theme: Theme) => void
  onLogout: () => void
}

export function TopBar({ username, theme, onTheme, onLogout }: TopBarProps) {
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

  return (
    <div className="sticky top-0 z-[8] bg-paper pt-[calc(env(safe-area-inset-top)+8px)] pb-2">
      <div className="mx-auto max-w-[calc(72rem+32px)] px-4">
        <header className="flex items-baseline justify-between gap-4 border-b-2 border-rule pb-2">
          <a className="wordmark" href="/">
            <span className="wordmark-mark" aria-hidden="true" />
            Clam
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
                  <p className="micro">Style</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {THEMES.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        data-theme-choice={option.id}
                        aria-pressed={theme === option.id}
                        className={`grid gap-1.5 border p-0 text-[10px] uppercase tracking-[0.08em] ${
                          theme === option.id ? 'border-rule text-ink' : 'border-hair text-muted'
                        }`}
                        onClick={() => {
                          onTheme(option.id)
                          setOpen(false)
                        }}
                      >
                        <span className={`theme-swatch ${option.className}`}>Aa</span>
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </header>
      </div>
    </div>
  )
}
