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
