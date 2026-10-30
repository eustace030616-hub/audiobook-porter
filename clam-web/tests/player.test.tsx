import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PlayerProvider, usePlayer } from '../src/player'
import type { Book } from '../src/types'

const { getCachedBlob } = vi.hoisted(() => ({ getCachedBlob: vi.fn() }))
vi.mock('../src/lib/chapter-cache', () => ({ cacheKey: (id: string, index: number) => `${id}:${index}`, getCachedBlob }))
vi.mock('../src/api', () => ({ api: { progress: vi.fn(async () => {}), listening: vi.fn(async () => null) } }))
let player: ReturnType<typeof usePlayer>
function Harness() { player = usePlayer(); return <p role="alert">{player.error}</p> }
const book = {
  id: '123456789abc', title: 'Fixture', authors: [], audioMode: 'chapters',
  continuousUrl: '/audio/123456789abc/continuous', position: 0, chapter: 0,
  chapters: [0, 1].map((index) => ({ index, title: `Chapter ${index}`, start: index * 100_000, end: (index + 1) * 100_000, duration: 100 })),
} as unknown as Book

beforeEach(() => {
  window.history.replaceState({}, '', '/?continuous=1')
  localStorage.clear()
  getCachedBlob.mockResolvedValue(null)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:http://localhost/cached')
    static revokeObjectURL = vi.fn()
  })
  const paused = new WeakMap<HTMLMediaElement, boolean>()
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (this: HTMLMediaElement) { return paused.get(this) ?? true })
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(1)
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(200)
  vi.spyOn(HTMLMediaElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLMediaElement, value) {
    this.setAttribute('src', value)
    queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')))
  })
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    paused.set(this, false)
    this.dispatchEvent(new Event('play'))
    this.dispatchEvent(new Event('playing'))
    return Promise.resolve()
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    if (paused.get(this) === false) {
      paused.set(this, true)
      this.dispatchEvent(new Event('pause'))
    }
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function start() {
  render(<PlayerProvider onListening={() => {}} onStats={() => {}}><Harness /></PlayerProvider>)
  await act(async () => { await player.prepare(book, { chapterIndex: 1, position: 25, autoplay: true }) })
  const audio = document.querySelector('audio')!
  expect(audio.currentTime).toBe(125)
  return audio
}

it('switches a playing continuous source to its cached chapter when going offline', async () => {
  const audio = await start()
  getCachedBlob.mockResolvedValue(new Blob(['audio']))
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  act(() => window.dispatchEvent(new Event('offline')))
  await waitFor(() => expect(audio.src).toContain('blob:'))
  await waitFor(() => expect(audio.currentTime).toBe(25))
  expect(player.chapter).toBe(1)
  expect(audio.paused).toBe(false)
})

it('recovers a failed media request even when the browser reports online', async () => {
  const audio = await start()
  getCachedBlob.mockResolvedValue(new Blob(['audio']))
  act(() => audio.dispatchEvent(new Event('error')))
  await waitFor(() => expect(audio.src).toContain('blob:'))
  await waitFor(() => expect(audio.currentTime).toBe(25))
})

it('keeps the continuous source when no cached chapter exists and reports a failed playback', async () => {
  const audio = await start()
  act(() => window.dispatchEvent(new Event('offline')))
  await waitFor(() => expect(getCachedBlob).toHaveBeenCalled())
  expect(audio.src).toContain('/continuous')
  act(() => audio.dispatchEvent(new Event('error')))
  await waitFor(() => expect(player.error).toContain('Playback interrupted'))
})
