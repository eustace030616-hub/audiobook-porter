import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  loadWordbook,
  lookupWord,
  normalizeWord,
  type WordbookData,
  type WordLookup,
} from '../lib/wordlookup'
import { loadWordMarks, markKey, removeWordMark, saveWordMark } from '../lib/wordmarks'

export interface WordSelection {
  surface: string
  sentence: string
  cueStart: number
  bookId: string
  bookTitle: string
  chapterIndex: number
  chapterTitle: string
  anchor: { top: number; left: number; width: number; height: number }
}

interface WordCardProps {
  selection: WordSelection
  onClose: () => void
}

type Translation = { status: 'idle' | 'loading' | 'ready' | 'error'; text?: string; provider?: string }
type Dictionary = { status: 'loading' | 'ready' | 'error'; data: WordbookData | null }

const translationCache = new Map<string, { text: string; provider?: string }>()

export function WordCard({ selection, onClose }: WordCardProps) {
  const [dictionary, setDictionary] = useState<Dictionary>({ status: 'loading', data: null })
  const [lookup, setLookup] = useState<WordLookup | null>(null)
  const [translation, setTranslation] = useState<Translation>({ status: 'idle' })
  const [marked, setMarked] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const surface = selection.surface
  const normalized = normalizeWord(surface)

  useEffect(() => {
    let alive = true
    setDictionary({ status: 'loading', data: null })
    setLookup(null)
    setTranslation({ status: 'idle' })
    void loadWordbook()
      .then((data) => {
        if (!alive) return
        setDictionary({ status: 'ready', data })
        setLookup(lookupWord(surface, data))
      })
      .catch(() => {
        if (alive) setDictionary({ status: 'error', data: null })
      })
    return () => { alive = false }
  }, [surface])

  const entry = lookup?.status === 'found' ? lookup.entry : null

  useLayoutEffect(() => {
    const element = card.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const gap = 10
      const inset = 8
      const chrome = 64
      let top = selection.anchor.top - rect.height - gap
      if (top < chrome) top = selection.anchor.top + selection.anchor.height + gap
      if (top + rect.height > window.innerHeight - inset) {
        top = Math.max(chrome, window.innerHeight - rect.height - inset)
      }
      const left = Math.min(
        Math.max(inset, selection.anchor.left + selection.anchor.width / 2 - rect.width / 2),
        Math.max(inset, window.innerWidth - rect.width - inset),
      )
      setPosition({ top, left })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [selection, lookup, translation.status])


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
        if (!value.translation || value.translation.toLowerCase() === surface.toLowerCase()) throw new Error('translation')
        const text = value.translation
        if (!text) throw new Error('translation')
        translationCache.set(normalized, { text, provider: value.provider })
        setTranslation({ status: 'ready', text, provider: value.provider })
      })
      .catch(() => {
        if (!controller.signal.aborted) setTranslation({ status: 'error' })
      })
    return () => controller.abort()
  }, [dictionary.data, lookup, normalized, surface])

  const key = markKey('de', lookup?.key ?? normalized)
  useEffect(() => {
    const marks = loadWordMarks()
    setMarked(marks.some((mark) => mark.key === key))
  }, [key])

  const waiting = dictionary.status === 'loading' || (entry == null && translation.status === 'loading')
  useEffect(() => {
    if (waiting) return
    const timer = window.setTimeout(onClose, 3000)
    return () => window.clearTimeout(timer)
  }, [onClose, waiting, lookup, translation.status])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  function toggleMark() {
    const lemma = lookup?.key ?? normalized
    if (marked) {
      removeWordMark(key)
      setMarked(false)
      return
    }
    saveWordMark({
      key,
      surface,
      lemma,
      gloss: entry?.shortGloss ?? translation.text ?? '',
      article: entry?.article ?? null,
      level: entry?.level ?? null,
      bookId: selection.bookId,
      bookTitle: selection.bookTitle,
      chapterIndex: selection.chapterIndex,
      chapterTitle: selection.chapterTitle,
      cueStart: selection.cueStart,
      sentence: selection.sentence,
      createdAt: Date.now(),
    })
    setMarked(true)
  }

  const gloss = entry?.shortGloss ?? (translation.status === 'ready' ? translation.text : '')
  const facts = [
    entry?.article ? `${entry.article} ${entry.display ?? entry.key}` : '',
    entry?.plural ? `die ${entry.plural}` : '',
    entry?.level ?? '',
  ].filter(Boolean)

  return (
    <div
      ref={card}
      className="word-card"
      style={position ? { top: position.top, left: position.left } : { top: -9999, left: -9999 }}
      role="dialog"
      aria-label={`Look up ${surface}`}
      aria-live="polite"
    >
      <div className="word-card__head">
        <div className="min-w-0">
          <span className="word-card__word">{surface}</span>
          {facts.length ? <span className="word-card__facts">{facts.join(' · ')}</span> : null}
        </div>
        <button
          type="button"
          className={`word-card__mark${marked ? ' is-marked' : ''}`}
          aria-label={marked ? 'Remove saved word' : 'Save word'}
          aria-pressed={marked}
          onClick={toggleMark}
        >
          {marked ? '★' : '☆'}
        </button>
      </div>
      <p className="word-card__gloss">
        {dictionary.status === 'loading'
          ? 'Loading dictionary…'
          : dictionary.status === 'error'
            ? 'Dictionary unavailable.'
            : entry
              ? gloss
              : translation.status === 'ready'
                ? gloss
                : translation.status === 'error'
                  ? 'Not in the wordbook. No translation.'
                  : 'Translating…'}
      </p>
      <p className="word-card__foot">
        <span>{entry ? 'WORD BOOK' : translation.provider ? `AUTO · ${translation.provider}` : 'LOOKUP'}</span>
        <span>{selection.chapterTitle}</span>
      </p>
    </div>
  )
}
