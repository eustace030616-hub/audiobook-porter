import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
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
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

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

  return (
    <button
      type="button"
      className={className}
      aria-label={`${label}. Shift+Enter skips a chapter.`}
      aria-keyshortcuts="Shift+Enter"
      onPointerDown={start}
      onPointerUp={clear}
      onPointerCancel={() => { clear(); fired.current = false }}
      onClick={() => {
        if (fired.current) fired.current = false
        else skip(direction * 15)
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') clear()
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || !event.shiftKey) return
        event.preventDefault()
        jumpChapter(direction)
      }}
    >
      {children}
    </button>
  )
}
