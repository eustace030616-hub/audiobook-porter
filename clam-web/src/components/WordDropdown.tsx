import { useEffect, useRef, useState } from 'react'
import {
  loadWordbook,
  lookupWord,
  normalizeWord,
  type WordbookData,
  type WordLookup,
} from '../lib/wordlookup'

export interface WordSelection {
  surface: string
  sentence: string
  cueStart: number
  bookId: string
  bookTitle: string
  chapterIndex: number
  chapterTitle: string
}

interface WordBannerProps {
  selection: WordSelection | null
  onClose: () => void
}

type Translation = { status: 'idle' | 'loading' | 'ready' | 'error'; text?: string; provider?: string }
type Dictionary = { status: 'loading' | 'ready' | 'error'; data: WordbookData | null }

const translationCache = new Map<string, { text: string; provider?: string }>()

export function WordDropdown({ selection, onClose }: WordBannerProps) {
  const root = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)
  const [dictionary, setDictionary] = useState<Dictionary>({ status: 'loading', data: null })
  const [lookup, setLookup] = useState<WordLookup | null>(null)
  const [translation, setTranslation] = useState<Translation>({ status: 'idle' })
  const surface = selection?.surface ?? ''
  const normalized = normalizeWord(surface)

  useEffect(() => {
    if (!selection) return
    let alive = true
    setDictionary({ status: 'loading', data: null })
    setLookup(null)
    setTranslation({ status: 'idle' })
    void loadWordbook()
      .then((data) => {
        if (!alive) return
        setDictionary({ status: 'ready', data })
        setLookup(lookupWord(selection.surface, data))
      })
      .catch(() => {
        if (alive) setDictionary({ status: 'error', data: null })
      })
    return () => { alive = false }
  }, [selection])

  const entry = lookup?.status === 'found' ? lookup.entry : null

  useEffect(() => {
    if (!dictionary.data || lookup?.status !== 'missing') return
    const cached = translationCache.get(normalized)
    if (cached) {
      setTranslation({ status: 'ready', text: cached.text, provider: cached.provider })
      return
    }
    const controller = new AbortController()
    setTranslation({ status: 'loading' })
    const params = new URLSearchParams({ q: surface, source: 'de', target: 'en' })
    void fetch(`/api/word/translate?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('translation')
        return await response.json() as { translation?: string; provider?: string }
      })
      .then((value) => {
        const text = value.translation
        if (!text || text.toLowerCase() === surface.toLowerCase()) throw new Error('translation')
        translationCache.set(normalized, { text, provider: value.provider })
        setTranslation({ status: 'ready', text, provider: value.provider })
      })
      .catch(() => {
        if (!controller.signal.aborted) setTranslation({ status: 'error' })
      })
    return () => controller.abort()
  }, [dictionary.data, lookup, normalized, surface])

  const original = entry
    ? [entry.article, entry.display ?? entry.key].filter(Boolean).join(' ')
    : selection?.surface ?? ''
  const gloss = entry?.shortGloss ?? (translation.status === 'ready' ? translation.text : '')
  const pending = dictionary.status === 'loading' || (lookup?.status === 'missing' && translation.status === 'loading')
  const meta = [entry?.pos, entry?.level].filter(Boolean).join(' · ')

  useEffect(() => {
    setClosing(false)
    if (!selection) return
    const timer = window.setTimeout(() => setClosing(true), 3000)
    return () => window.clearTimeout(timer)
  }, [selection])

  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(onClose, 180)
    return () => window.clearTimeout(timer)
  }, [closing, onClose])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (root.current?.contains(target)) return
      if (target?.closest('.transcript__word, .transcript__time')) return
      setClosing(true)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  if (!selection) return null

  return (
    <div ref={root} className={`word-dropdown${closing ? ' is-closing' : ''}`} role="status" aria-live="polite">
      <div className="word-dropdown__head">
        <span className="word-dropdown__word">{original}</span>
        {meta ? <span className="word-dropdown__meta">{meta}</span> : null}
      </div>
      <p className="word-dropdown__gloss">
        {pending ? '…' : gloss || (translation.status === 'error' ? 'no translation' : '')}
      </p>
    </div>
  )
}
