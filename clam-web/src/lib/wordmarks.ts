export interface WordMark {
  key: string
  surface: string
  lemma: string
  gloss: string
  article: string | null
  level: string | null
  bookId: string
  bookTitle: string
  chapterIndex: number
  chapterTitle: string
  cueStart: number
  sentence: string
  createdAt: number
}

const KEY = 'clam.wordmarks.v1'

export function markKey(lang: string, lemma: string): string {
  return `${lang}:${lemma.toLowerCase()}`
}

export function loadWordMarks(): WordMark[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? (value as WordMark[]) : []
  } catch {
    return []
  }
}

export function saveWordMark(mark: WordMark): void {
  try {
    const marks = loadWordMarks().filter((item) => item.key !== mark.key)
    marks.unshift(mark)
    localStorage.setItem(KEY, JSON.stringify(marks.slice(0, 500)))
  } catch {
    // A full/blocked localStorage must not interrupt reading.
  }
}

export function removeWordMark(key: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadWordMarks().filter((item) => item.key !== key)))
  } catch {
    // Ignore quota/private mode.
  }
}
