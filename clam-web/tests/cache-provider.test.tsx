import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChapterCacheProvider, useChapterCache } from '../src/chapter-cache'
import { deleteCached, listCached, putCached } from '../src/lib/chapter-cache'
import type { Book } from '../src/types'

const { download } = vi.hoisted(() => ({ download: vi.fn() }))
vi.mock('../src/lib/chapter-cache', async (original) => ({ ...(await original<object>()), startChapterDownload: download }))
vi.mock('../src/components/Sheet', () => ({ Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }))
const book = { id: 'book', chapters: [0, 1, 2, 3].map((index) => ({ title: `${index}` })) } as Book
function Harness() {
  const cache = useChapterCache()
  return <><p>Entries: {cache.entries.length}</p>{[2, 3].map((index) => <button key={index} onClick={() => cache.request(book, index)}>Cache {index}</button>)}</>
}
beforeEach(async () => {
  for (const entry of await listCached()) await deleteCached(entry.key)
  for (const index of [0, 1]) await putCached({ key: `book:${index}`, bookId: 'book', chapterIndex: index, title: `${index}`, cachedAt: index, size: 4, type: 'audio/mp4' }, new Blob(['data']))
  download.mockReturnValue({ promise: new Promise(() => {}), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('reserves in-flight slots and prompts before a fourth chapter', async () => {
  const view = render(<ChapterCacheProvider><Harness /></ChapterCacheProvider>)
  await view.findByText('Entries: 2')
  fireEvent.click(view.getByText('Cache 2'))
  fireEvent.click(view.getByText('Cache 3'))
  expect(download).toHaveBeenCalledTimes(1)
  expect(view.getByText('Replace the oldest chapter?')).toBeTruthy()
})

it('shows a download failure and retains the existing entries', async () => {
  download.mockImplementation(() => ({ promise: Promise.reject(new Error('offline')), cancel: vi.fn() }))
  const view = render(<ChapterCacheProvider><Harness /></ChapterCacheProvider>)
  await view.findByText('Entries: 2')
  fireEvent.click(view.getByText('Cache 2'))
  await waitFor(() => expect(view.getByRole('alert').textContent).toContain('Could not cache'))
  expect(await listCached()).toHaveLength(2)
})
