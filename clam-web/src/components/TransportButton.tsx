import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { usePlayer } from '../player'

interface TransportButtonProps {
  direction: -1 | 1
  className?: string
  label: string
  children: ReactNode
}

export function TransportButton({ direction, className = '', label, children }: TransportButtonProps) {
  const { skip, jumpChapter } = usePlayer()
  const timer = useRef<number | null>(null)
  const fired = useRef(false)

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
  }

  const start = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* ignore */ }
    clear()
    fired.current = false
    timer.current = window.setTimeout(() => {
      fired.current = true
      jumpChapter(direction)
    }, 550)
  }

  const end = () => {
    clear()
    if (!fired.current) skip(direction * 15)
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      onPointerDown={start}
      onPointerUp={end}
      onPointerCancel={clear}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') clear()
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        skip(direction * 15)
      }}
    >
      {children}
    </button>
  )
}
