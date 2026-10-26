import type { Book, SavedProgress } from '../types'

export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function absoluteToProgress(book: Book, seconds: number): SavedProgress {
  if (book.audioMode !== 'chapters' || !book.chapters.length) {
    return { chapter: 0, position: Math.max(0, seconds), updated: 0 }
  }
  const ms = Math.max(0, seconds) * 1000
  let index = 0
  for (let i = 0; i < book.chapters.length; i += 1) {
    if (ms >= (book.chapters[i].start || 0)) index = i
    else break
  }
  const chapter = book.chapters[index]
  return {
    chapter: index,
    position: Math.max(0, seconds - (chapter.start || 0) / 1000),
    updated: 0,
  }
}

function localProgress(book: Book): SavedProgress | null {
  try {
    const raw = localStorage.getItem(`shelf:pos:${book.id}`)
    if (raw) {
      const parsed = JSON.parse(raw) as { chapter?: unknown; position?: unknown; updated?: unknown }
      if (parsed && Number.isFinite(Number(parsed.position))) {
        const position = Number(parsed.position)
        const legacyRaw = localStorage.getItem(`shelf:position:${book.id}`)
        const legacy = legacyRaw && Number.isFinite(Number(legacyRaw)) ? Number(legacyRaw) : 0
        if (position === 0 && legacy > 0) return absoluteToProgress(book, legacy)
        if (Number.isFinite(Number(parsed.chapter))) {
          return {
            chapter: Number(parsed.chapter),
            position,
            updated: Number(parsed.updated) || 0,
          }
        }
        return { ...absoluteToProgress(book, position), updated: Number(parsed.updated) || 0 }
      }
    }
    const legacyRaw = localStorage.getItem(`shelf:position:${book.id}`)
    if (legacyRaw && Number.isFinite(Number(legacyRaw))) {
      return absoluteToProgress(book, Number(legacyRaw))
    }
  } catch {
    // Storage can be unavailable in private mode.
  }
  return null
}

export function savedProgress(book: Book): SavedProgress {
  const local = localProgress(book)
  const server = {
    chapter: Math.max(0, Number(book.chapter) || 0),
    position: Math.max(0, Number(book.position) || 0),
    updated: Number(book.positionUpdated) || 0,
  }
  if (!local) return server
  if (local.position > 0 && server.position === 0) return local
  if (!server.updated) return local
  return local.updated >= server.updated ? local : server
}

export function bookPercent(book: Book): number {
  const chapters = book.chapters || []
  const index = Math.max(0, Math.min((chapters.length || 1) - 1, Number(book.chapter) || 0))
  let total = 0
  let before = 0
  if (chapters.length) {
    for (let i = 0; i < chapters.length; i += 1) {
      total += Number(chapters[i].duration) || 0
      if (i < index) before += Number(chapters[i].duration) || 0
    }
  }
  if (!total) total = Number(book.duration) || 0
  if (!total) return 0
  return Math.max(0, Math.min(100, ((before + (Number(book.position) || 0)) / total) * 100))
}

export function chapterFor(book: Book | null, index: number) {
  if (!book?.chapters.length) return null
  return book.chapters[Math.max(0, Math.min(book.chapters.length - 1, index))] || null
}

export function isContinuous(book: Book | null): boolean {
  return Boolean(book?.continuousUrl && book.chapters.length)
}

export function chapterStart(book: Book, index: number): number {
  return Math.max(0, (book.chapters[index]?.start || 0) / 1000)
}

export function chapterDuration(book: Book, index: number): number {
  const chapter = book.chapters[index]
  if (!chapter) return 0
  return Math.max(0, Number(chapter.duration) || (chapter.end - chapter.start) / 1000)
}

export function chapterAt(book: Book, absoluteSeconds: number): number {
  if (!book.chapters.length) return 0
  const ms = Math.max(0, absoluteSeconds) * 1000
  let index = 0
  for (let i = 0; i < book.chapters.length; i += 1) {
    if (ms >= (book.chapters[i].start || 0)) index = i
    else break
  }
  return index
}

export function audioUrl(book: Book, index: number): string {
  if (book.continuousUrl) return `${book.continuousUrl}?v=${book.continuousVersion || book.audioVersion || 0}`
  if (book.audioMode === 'chapters') {
    const chapter = chapterFor(book, index)
    return `/audio/${book.id}/${index}?v=${chapter?.fileVersion || 0}`
  }
  return `/audio/${book.id}?v=${book.audioVersion || 0}`
}

export function weekBars(stats?: { days?: { date: string; seconds: number }[] }) {
  const names = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  let days = Array.isArray(stats?.days) ? stats.days : []
  if (days.length !== 7) days = names.map((_, index) => ({ date: `day-${index}`, seconds: 0 }))
  const max = Math.max(1, ...days.map((day) => Number(day.seconds) || 0))
  return days.map((day, index) => {
    const value = Math.max(0, Number(day.seconds) || 0)
    return {
      label: names[index],
      height: value > 0 ? Math.max(4, (value / max) * 100) : 0,
    }
  })
}

export function todayKey(): string {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}
