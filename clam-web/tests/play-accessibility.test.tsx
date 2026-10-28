import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Play } from '../src/pages/Play'
import type { Book } from '../src/types'

const { player } = vi.hoisted(() => ({ player: {
  book: { id: 'book' }, chapter: 0, playing: true, current: 0, duration: 100,
  speed: 1, sleep: null, error: '', prepare: vi.fn(), seekTo: vi.fn(),
} }))
vi.mock('../src/player', () => ({ usePlayer: () => player }))
vi.mock('../src/lib/subtitles', () => ({ cueAt: () => 0, loadTranscript: async () => ({ cues: [{ start: 0, end: 10, text: 'Hallo' }] }) }))
vi.mock('../src/lib/wordlookup', () => ({ loadWordbook: async () => {}, segmentWords: () => [{ word: true, text: 'Hallo' }] }))
vi.mock('../src/components/CacheButton', () => ({ CacheButton: () => null }))
vi.mock('../src/components/TransportButton', () => ({ TransportButton: () => null }))
vi.mock('../src/components/WordDropdown', () => ({ WordDropdown: () => null }))
vi.mock('../src/components/Cover', () => ({ Cover: () => null }))
vi.mock('../src/components/Sheet', () => ({ Sheet: () => null }))
afterEach(cleanup)

it('makes hidden transcript controls inert and reveals them only in transcript mode', async () => {
  const book = { id: 'book', title: 'Fixture', authors: [], chapters: [{ start: 0, duration: 100, title: 'One', subtitleUrl: '/subtitle/book/0' }] } as unknown as Book
  const view = render(<Play book={book} search={new URLSearchParams()} />)
  await waitFor(() => expect(view.container.querySelector('.transcript__word')).toBeTruthy())
  const overlay = view.container.querySelector('.play-text-overlay')!
  expect(overlay.hasAttribute('inert')).toBe(true)
  expect(view.queryByRole('button', { name: 'Jump to 0:00' })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: 'Show transcript' }))
  expect(overlay.hasAttribute('inert')).toBe(false)
  expect(view.getByRole('button', { name: 'Jump to 0:00' })).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Show cover' }))
  expect(overlay.hasAttribute('inert')).toBe(true)
})
