import { useEffect, useState } from 'react'
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
}

interface WordBannerProps {
  selection: WordSelection | null
}

type Translation = { status: 'idle' | 'loading' | 'ready' | 'error'; text?: string; provider?: string }
type Dictionary = { status: 'loading' | 'ready' | 'error'; data: WordbookData | null }

const translationCache = new Map<string, { text: string; provider?: string }>()

export function WordBanner({ selection }: WordBannerProps) {
  const [dictionary, setDictionary] = useState<Dictionary>({ status: 'loading', data: null })
  const [lookup, setLookup] = useState<WordLookup | null>(null)
  const [translation, setTranslation] = useState<Translation>({ status: 'idle' })
  const [marked, setMarked] = useState(false)
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

  const key = markKey('de', lookup?.key ?? normalized)
  useEffect(() => {
    setMarked(loadWordMarks().some((mark) => mark.key === key))
  }, [key])

  function toggleMark() {
    if (!selection) return
    const lemma = lookup?.key ?? normalized
    if (marked) {
      removeWordMark(key)
      setMarked(false)
      return
    }
    saveWordMark({
      key,
      surface: selection.surface,
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

  const original = entry
    ? [entry.article, entry.display ?? entry.key].filter(Boolean).join(' ')
    : selection?.surface ?? ''
  const gloss = entry?.shortGloss ?? (translation.status === 'ready' ? translation.text : '')
  const pending = dictionary.status === 'loading' || (lookup?.status === 'missing' && translation.status === 'loading')

  return (
    <div className="word-banner" role="status" aria-live="polite">
      {selection ? (
        <>
          <span className="word-banner__word">{original}</span>
          <span className="word-banner__gloss">
            {pending ? '…' : gloss || (translation.status === 'error' ? 'no translation' : '')}
          </span>
          <button
            type="button"
            className={`word-banner__mark${marked ? ' is-marked' : ''}`}
            aria-label={marked ? 'Remove saved word' : 'Save word'}
            aria-pressed={marked}
            onClick={toggleMark}
          >
            {marked ? '★' : '☆'}
          </button>
        </>
      ) : null}
    </div>
  )
}
