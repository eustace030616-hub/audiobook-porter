export interface Chapter {
  index: number
  title: string
  start: number
  end: number
  duration: number
  fileVersion: number
  subtitleUrl?: string
}

export interface Book {
  id: string
  title: string
  displayTitle: string
  coverBig: string
  coverSmall: string
  series: string
  shelfKey: string
  shelf: string
  sequence: string
  authors: string[]
  narrator: string
  description: string
  audioMode: 'single' | 'chapters'
  continuousUrl: string
  continuousVersion: number
  chapters: Chapter[]
  duration: number
  durationLabel: string
  ribbon: string
  coverUrl: string
  coverAspect: number
  position: number
  positionUpdated: number
  chapter: number
  audioVersion: number
}

export interface Shelf {
  key: string
  name: string
  books: Book[]
}

export interface DayStat {
  date: string
  seconds: number
}

export interface Stats {
  weekSeconds: number
  days: DayStat[]
}

export interface Library {
  books: Book[]
  shelves: Shelf[]
  stats: Stats
}

export interface SavedProgress {
  chapter: number
  position: number
  updated: number
}

export type Theme = 'paper' | 'sepia' | 'night'
