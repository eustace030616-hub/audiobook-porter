import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

export function PlayIcon({ className = '', ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...props}>
      <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function PauseIcon({ className = '', ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...props}>
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function BackIcon({ className = '', ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...props}>
      <path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function ChevronIcon({ className = '', ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...props}>
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function ListIcon({ className = '', ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function SeekIcon({ direction, className = '' }: IconProps & { direction: -1 | 1 }) {
  return (
    <span className={`flex flex-col items-center justify-center leading-none ${className}`}>
      <span className="text-[20px] leading-[0.9]">{direction < 0 ? '↺' : '↻'}</span>
      <span className="text-[8px] tracking-[0.02em]">15</span>
    </span>
  )
}
