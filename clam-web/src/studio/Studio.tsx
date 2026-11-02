import { useEffect, useRef, useState } from 'react'
import { Puck, type Data } from '@puckeditor/core'
import { studioConfig } from './config'

const STATE_URL = '/__studio/state'

export function Studio() {
  const [data, setData] = useState<Data | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    fetch(STATE_URL, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('state unavailable')))
      .then((value: Data) => { setData(value); setStatus('ready') })
      .catch(() => { setData({ content: [], root: { props: {} }, zones: {} }); setStatus('ready') })
  }, [])

  const save = (next: Data) => {
    setData(next)
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void fetch(STATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
    }, 250)
  }

  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
  }, [])

  if (status === 'loading' || !data) return <main className="studio-loading">Loading UI lab…</main>
  return (
    <div className="studio-shell">
      <Puck
        config={studioConfig}
        data={data}
        onChange={save}
        onPublish={save}
      />
    </div>
  )
}
