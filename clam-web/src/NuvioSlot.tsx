import { useEffect, useState, type ComponentType } from 'react'

export function NuvioSlot() {
  const [Shell, setShell] = useState<ComponentType | null>(null)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    let alive = true
    void import('./NuvioShell').then(({ NuvioShell }) => {
      if (alive) setShell(() => NuvioShell)
    })
    return () => { alive = false }
  }, [])

  return Shell ? <Shell /> : null
}
