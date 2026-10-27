export interface WordEntry {
  key: string
  level: string | null
  article: string | null
  pos: string | null
  plural: string | null
  display: string | null
  difficulty: number | null
  gloss: string
  shortGloss: string
}

export type WordLookup =
  | { status: 'found'; key: string; entry: WordEntry }
  | { status: 'missing'; key: string }

export interface WordbookData {
  words: Map<string, WordEntry>
  lemmas: Map<string, string>
  separations: Map<string, string>
  compounds: Set<string>
}

const VERSION = 'v3'
const ARTIFACTS = {
  words: `/wordbook/de-${VERSION}.json`,
  lemmas: `/wordbook/de-lemmas-${VERSION}.json`,
  separations: `/wordbook/de-separations-${VERSION}.json`,
  compounds: `/wordbook/de-compound-forms-${VERSION}.json`,
} as const
const DB_NAME = 'clam-wordlookup'
const STORE = 'artifacts'

let loadPromise: Promise<WordbookData> | null = null

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function cached(key: string): Promise<unknown | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(key)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => resolve(null)
  })
}

async function remember(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

async function readJson(url: string, key: string): Promise<unknown> {
  const hit = await cached(key)
  if (hit) return hit
  const response = await fetch(url)
  if (!response.ok) throw new Error(`wordbook ${response.status}`)
  const value = await response.json()
  void remember(key, value)
  return value
}

export function normalizeWord(surface: string): string {
  return surface
    .normalize('NFC')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .toLowerCase()
    .trim()
}

function compactGloss(gloss: string): string {
  const parts = gloss.split(/[,;，；]/u).map((part) => part.trim()).filter(Boolean)
  return parts.slice(0, 3).join(', ') || gloss
}

function parseWords(rows: unknown): Map<string, WordEntry> {
  const out = new Map<string, WordEntry>()
  if (!Array.isArray(rows)) return out
  for (const row of rows) {
    if (!Array.isArray(row) || typeof row[0] !== 'string') continue
    const gloss = typeof row[3] === 'string' ? row[3] : ''
    if (!row[0] || !gloss) continue
    out.set(row[0], {
      key: row[0],
      level: typeof row[1] === 'string' ? row[1] : null,
      article: typeof row[4] === 'string' ? row[4] : null,
      pos: typeof row[5] === 'string' ? row[5] : null,
      plural: typeof row[6] === 'string' ? row[6] : null,
      display: typeof row[7] === 'string' ? row[7] : null,
      difficulty: typeof row[2] === 'number' ? row[2] : null,
      gloss,
      shortGloss: compactGloss(gloss),
    })
  }
  return out
}

function parseLemmas(value: unknown): Map<string, string> {
  const out = new Map<string, string>()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [form, lemma] of Object.entries(value as Record<string, unknown>)) {
    if (typeof lemma !== 'string' || !lemma) continue
    const key = normalizeWord(form)
    if (key) out.set(key, normalizeWord(lemma))
  }
  return out
}

function parseSeparations(value: unknown): Map<string, string> {
  const out = new Map<string, string>()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [pair, merged] of Object.entries(value as Record<string, unknown>)) {
    if (typeof merged !== 'string' || !merged) continue
    const [particle, verb] = pair.split('|')
    if (!particle || !verb) continue
    out.set(`${normalizeWord(particle)}|${normalizeWord(verb)}`, normalizeWord(merged))
  }
  return out
}

function parseCompounds(value: unknown): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(value)) return out
  for (const item of value) {
    if (typeof item === 'string' && item) out.add(normalizeWord(item))
  }
  return out
}

export function loadWordbook(): Promise<WordbookData> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const [wordsRaw, lemmasRaw, separationsRaw, compoundsRaw] = await Promise.all([
      readJson(ARTIFACTS.words, `de-${VERSION}-words`),
      readJson(ARTIFACTS.lemmas, `de-${VERSION}-lemmas`),
      readJson(ARTIFACTS.separations, `de-${VERSION}-separations`),
      readJson(ARTIFACTS.compounds, `de-${VERSION}-compounds`),
    ])
    return {
      words: parseWords(wordsRaw),
      lemmas: parseLemmas(lemmasRaw),
      separations: parseSeparations(separationsRaw),
      compounds: parseCompounds(compoundsRaw),
    }
  })().catch((error) => {
    loadPromise = null
    throw error
  })
  return loadPromise
}

function compoundEntry(surface: string, data: WordbookData): WordEntry | null {
  const key = normalizeWord(surface)
  if (key.length < 6 || data.words.has(key)) return null
  if (data.compounds.size && !data.compounds.has(key)) return null
  for (let i = key.length - 3; i >= 3; i -= 1) {
    const right = key.slice(i)
    const leftRaw = key.slice(0, i)
    for (const linking of ['', 's', 'n', 'en', 'es', 'er']) {
      if (linking && !leftRaw.endsWith(linking)) continue
      const left = linking ? leftRaw.slice(0, -linking.length) : leftRaw
      if (left.length < 3) continue
      const first = data.words.get(left)
      const second = data.words.get(right)
      if (!first || !second) continue
      const gloss = [first.shortGloss, second.shortGloss].filter(Boolean).join(' + ')
      if (!gloss) return null
      return {
        key,
        level: [first.level, second.level].filter(Boolean).sort().at(-1) ?? null,
        article: null,
        pos: 'compound',
        plural: null,
        display: surface,
        difficulty: Math.max(first.difficulty ?? -1, second.difficulty ?? -1) || null,
        gloss,
        shortGloss: gloss,
      }
    }
  }
  return null
}

export function lookupWord(surface: string, data: WordbookData): WordLookup {
  const normalized = normalizeWord(surface)
  const exact = data.words.get(normalized)
  if (exact) return { status: 'found', key: normalized, entry: exact }
  const lemma = data.lemmas.get(normalized)
  if (lemma) {
    const entry = data.words.get(lemma)
    if (entry) return { status: 'found', key: lemma, entry }
  }
  const compound = compoundEntry(surface, data)
  if (compound) return { status: 'found', key: compound.key, entry: compound }
  return { status: 'missing', key: lemma ?? normalized }
}

export interface WordSegment {
  text: string
  word: boolean
}

const FALLBACK_WORD = /[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu

/** Split a sentence while preserving every space and punctuation character. */
export function segmentWords(text: string): WordSegment[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    try {
      const segmenter = new Intl.Segmenter('de', { granularity: 'word' })
      return Array.from(segmenter.segment(text), (part) => ({
        text: part.segment,
        word: Boolean(part.isWordLike),
      }))
    } catch {
      // Fall through to the regex.
    }
  }
  const out: WordSegment[] = []
  let last = 0
  for (const match of text.matchAll(FALLBACK_WORD)) {
    const index = match.index ?? 0
    if (index > last) out.push({ text: text.slice(last, index), word: false })
    out.push({ text: match[0], word: true })
    last = index + match[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), word: false })
  return out
}
