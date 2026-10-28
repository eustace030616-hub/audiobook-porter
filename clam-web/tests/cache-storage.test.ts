import 'fake-indexeddb/auto'
import { beforeEach, expect, it } from 'vitest'
import { deleteCached, listCached, putCached, getCachedBlob, type CachedChapterMeta } from '../src/lib/chapter-cache'

const meta = (index: number): CachedChapterMeta => ({ key: `book:${index}`, bookId: 'book', chapterIndex: index, title: `${index}`, cachedAt: index, size: 4, type: 'audio/mp4' })
beforeEach(async () => {
  for (const entry of await listCached()) await deleteCached(entry.key)
})

it('enforces capacity across simultaneous writers', async () => {
  const writes = await Promise.allSettled([0, 1, 2, 3].map((index) => putCached(meta(index), new Blob(['data']))))
  expect(writes.filter((write) => write.status === 'fulfilled')).toHaveLength(3)
  expect(await listCached()).toHaveLength(3)
})

it('rolls back eviction if storing the replacement fails', async () => {
  await putCached(meta(0), new Blob(['original']))
  // Functions cannot be structured-cloned into IndexedDB. The real transaction
  // aborts after its eviction, just as it does for a failed blob/quota write.
  await expect(putCached(meta(1), (() => {}) as unknown as Blob, 'book:0')).rejects.toBeDefined()
  expect((await listCached()).map((entry) => entry.key)).toEqual(['book:0'])
  expect(await getCachedBlob('book:0')).toBeTruthy()
})

it('atomically replaces an entry in a full cache', async () => {
  for (const index of [0, 1, 2]) await putCached(meta(index), new Blob(['data']))
  await putCached(meta(3), new Blob(['new']), 'book:0')
  expect((await listCached()).map((entry) => entry.key)).toEqual(['book:1', 'book:2', 'book:3'])
  expect(await getCachedBlob('book:0')).toBeNull()
})
