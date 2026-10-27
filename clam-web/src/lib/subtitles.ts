export interface SubtitleCue {
  start: number
  end: number
  text: string
}

export interface Transcript {
  language: string
  cues: SubtitleCue[]
}

const cache = new Map<string, Transcript | null>()

function parse(value: unknown): Transcript | null {
  if (!value || typeof value !== 'object') return null
  const data = value as { language?: unknown; cues?: unknown }
  if (!Array.isArray(data.cues)) return null
  const cues = data.cues
    .map((cue) => {
      if (!cue || typeof cue !== 'object') return null
      const item = cue as { start?: unknown; end?: unknown; text?: unknown }
      const start = Number(item.start)
      const end = Number(item.end)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || typeof item.text !== 'string') {
        return null
      }
      return { start, end, text: item.text.trim() }
    })
    .filter((cue): cue is SubtitleCue => Boolean(cue && cue.text))
  if (!cues.length) return null
  return { language: typeof data.language === 'string' ? data.language : 'de', cues }
}

export async function loadTranscript(url: string): Promise<Transcript | null> {
  if (cache.has(url)) return cache.get(url) || null
  try {
    const response = await fetch(url, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(String(response.status))
    const transcript = parse(await response.json())
    cache.set(url, transcript)
    return transcript
  } catch {
    cache.set(url, null)
    return null
  }
}

export function cueAt(cues: SubtitleCue[], time: number): number {
  let low = 0
  let high = cues.length - 1
  let found = 0
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (cues[mid].start <= time) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}


export interface TranscriptBlock {
  start: number
  end: number
  text: string
  firstCue: number
  lastCue: number
}

/**
 * Audio transcripts read badly as one sentence per row. Keep the sentence
 * timings for seeking, but render two or three sentences as one block.
 */
export function groupCues(cues: SubtitleCue[]): TranscriptBlock[] {
  if (!cues.length) return []
  const sizes: number[] = []
  let left = cues.length
  let cursor = 0
  while (left > 0) {
    let size = Math.min(3, left)
    if (left === 4) size = 2
    if (left > 3) {
      const chars = cues.slice(cursor, cursor + 3).reduce((sum, cue) => sum + cue.text.length, 0)
      if (chars > 650) size = 2
    }
    sizes.push(size)
    left -= size
    cursor += size
  }
  let cueIndex = 0
  return sizes.map((size) => {
    const slice = cues.slice(cueIndex, cueIndex + size)
    const block: TranscriptBlock = {
      start: slice[0].start,
      end: slice[slice.length - 1].end,
      text: slice.map((cue) => cue.text).join(' '),
      firstCue: cueIndex,
      lastCue: cueIndex + size - 1,
    }
    cueIndex += size
    return block
  })
}
