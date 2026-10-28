import { beforeEach, expect, it } from 'vitest'
import { savedProgress } from '../src/lib/progress'
import type { Book } from '../src/types'

beforeEach(() => localStorage.clear())

it('restores a newer server chapter even when its relative position is zero', () => {
  localStorage.setItem('shelf:pos:book', JSON.stringify({ chapter: 0, position: 50, updated: 100 }))
  const book = { id: 'book', chapter: 5, position: 0, positionUpdated: 200, chapters: [] } as unknown as Book
  expect(savedProgress(book)).toEqual({ chapter: 5, position: 0, updated: 200 })
})

it('keeps genuinely newer offline progress', () => {
  localStorage.setItem('shelf:pos:book', JSON.stringify({ chapter: 2, position: 15, updated: 300 }))
  const book = { id: 'book', chapter: 5, position: 0, positionUpdated: 200, chapters: [] } as unknown as Book
  expect(savedProgress(book)).toEqual({ chapter: 2, position: 15, updated: 300 })
})
