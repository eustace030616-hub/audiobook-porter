import { beforeEach, expect, it } from 'vitest'
import { audioUrl, isContinuous, isHls, savedProgress } from '../src/lib/progress'
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

it('uses split chapter URLs by default', () => {
  const book = {
    id: 'book', audioMode: 'chapters', continuousUrl: '/audio/book/continuous',
    chapters: [{ index: 0, fileVersion: 3 }, { index: 1, fileVersion: 4 }],
  } as unknown as Book
  expect(isHls(book)).toBe(false)
  expect(isContinuous(book)).toBe(false)
  expect(audioUrl(book, 1)).toBe('/audio/book/1?v=4')
})
