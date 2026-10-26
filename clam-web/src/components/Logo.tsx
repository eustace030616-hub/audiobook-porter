interface LogoProps {
  full?: boolean
  className?: string
}

export function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg className={`logo__mark ${className}`} viewBox="0 0 48 48" aria-hidden="true">
      <path
        d="M5 44V24a19 19 0 0 1 38 0v20"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
      />
      <rect x="15" y="31" width="4.5" height="13" fill="currentColor" />
      <rect x="21.75" y="26" width="4.5" height="18" fill="var(--accent)" />
      <rect x="28.5" y="34" width="4.5" height="10" fill="currentColor" />
    </svg>
  )
}

export function Logo({ full = false, className = '' }: LogoProps) {
  return (
    <span className={`logo ${full ? 'logo--full' : ''} ${className}`}>
      <LogoMark />
      <span className="logo__text">clam</span>
      {full ? <span className="logo__sub">Audiobooks</span> : null}
    </span>
  )
}
