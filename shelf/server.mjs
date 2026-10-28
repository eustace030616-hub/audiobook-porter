#!/usr/bin/env node
/**
 * Clam — one login, one library, series shelves, an audio player.
 *
 * Deliberately small: no framework, no database, no admin pages. The files in
 * library folder are the data. `metadata.json` next to each .m4b supplies series,
 * title, chapters, and the ribbon colour.
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HOME = process.env.HOME || process.cwd()
const LIBRARY = path.resolve(process.env.SHELF_LIBRARY || path.join(HOME, 'shelf', 'library'))
const DATA = path.resolve(process.env.SHELF_DATA || path.join(HOME, 'shelf', 'data'))
const PUBLIC = path.join(HERE, 'public')
const PORT = Number(process.env.SHELF_PORT || 13378)
const HOST = process.env.SHELF_HOST || '0.0.0.0'
const FFMPEG = process.env.SHELF_FFMPEG || 'ffmpeg'
const FFPROBE = process.env.SHELF_FFPROBE || 'ffprobe'
const COOKIE = 'shelf_session'
const AUTH_URL = process.env.CLAM_AUTH_URL || 'http://127.0.0.1:3100/api/auth/login'
const SESSION_SECONDS = 30 * 24 * 60 * 60
const MAX_BODY = 8192
const SECRET_FILE = path.join(DATA, 'session-secret')
const PROGRESS_FILE = path.join(DATA, 'progress.json')
const SHELF_LABELS_FILE = path.join(DATA, 'shelves.json')
const LISTENING_FILE = path.join(DATA, 'listening.json')
const LAYOUT_FILE = path.join(DATA, 'layout.json')

fs.mkdirSync(DATA, { recursive: true, mode: 0o700 })
fs.mkdirSync(LIBRARY, { recursive: true })

function loadSecret() {
  try {
    const value = fs.readFileSync(SECRET_FILE, 'utf8').trim()
    if (value.length >= 32) return Buffer.from(value, 'hex')
  } catch {}
  const secret = crypto.randomBytes(32)
  const tmp = `${SECRET_FILE}.${process.pid}`
  fs.writeFileSync(tmp, secret.toString('hex'), { mode: 0o600 })
  fs.renameSync(tmp, SECRET_FILE)
  return secret
}
const SECRET = loadSecret()
let progressCache = null
let shelfLabelCache = null
let listeningCache = null
let layoutCache = null
let coverSizeCache = new Map()

function shelfLabels() {
  if (shelfLabelCache) return shelfLabelCache
  try {
    shelfLabelCache = JSON.parse(fs.readFileSync(SHELF_LABELS_FILE, 'utf8'))
  } catch {
    shelfLabelCache = {}
  }
  return shelfLabelCache
}

function setShelfLabel(key, name) {
  const data = shelfLabels()
  if (name && name !== key) data[key] = name
  else delete data[key]
  const tmp = `${SHELF_LABELS_FILE}.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, SHELF_LABELS_FILE)
}


function layoutData() {
  if (layoutCache) return layoutCache
  try {
    const parsed = JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8'))
    layoutCache = {
      shelves: Array.isArray(parsed.shelves) ? parsed.shelves.filter((key) => typeof key === 'string') : [],
      books: parsed.books && typeof parsed.books === 'object' ? parsed.books : {},
    }
  } catch {
    layoutCache = { shelves: [], books: {} }
  }
  return layoutCache
}

function saveLayout(data) {
  layoutCache = {
    shelves: [...new Set(data.shelves.filter((key) => typeof key === 'string'))],
    books: {},
  }
  for (const [key, ids] of Object.entries(data.books || {})) {
    if (Array.isArray(ids)) layoutCache.books[key] = ids.filter((id) => /^[a-f0-9]{12}$/.test(String(id)))
  }
  const tmp = `${LAYOUT_FILE}.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(layoutCache, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, LAYOUT_FILE)
  scanCache.at = 0
}

function createShelf(name) {
  const label = cleanName(name)
  if (!label) throw new Error('A shelf needs a name')
  const existing = shelves(loadBooks()).find((shelf) => shelf.name.toLowerCase() === label.toLowerCase())
  if (existing) return existing
  const key = `custom-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`
  setShelfLabel(key, label)
  const layout = layoutData()
  layout.shelves = [...layout.shelves.filter((entry) => entry !== key), key]
  layout.books[key] = []
  saveLayout(layout)
  scanCache.at = 0
  return { key, name: label, books: [] }
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function listeningData() {
  if (listeningCache) return listeningCache
  try {
    const parsed = JSON.parse(fs.readFileSync(LISTENING_FILE, 'utf8'))
    listeningCache = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    listeningCache = {}
  }
  return listeningCache
}

function saveListening() {
  const tmp = `${LISTENING_FILE}.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(listeningData(), null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, LISTENING_FILE)
}

function addListening(seconds) {
  const data = listeningData()
  const key = localDateKey()
  data[key] = Math.max(0, (Number(data[key]) || 0) + seconds)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)
  const cutoffKey = localDateKey(cutoff)
  for (const day of Object.keys(data)) {
    if (day < cutoffKey) delete data[day]
  }
  saveListening()
}

function weeklyListening() {
  const now = new Date()
  const monday = new Date(now)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const data = listeningData()
  const days = []
  let total = 0
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    const key = localDateKey(date)
    const seconds = Math.max(0, Number(data[key]) || 0)
    total += seconds
    days.push({ date: key, seconds: Math.round(seconds) })
  }
  return {
    days,
    weekSeconds: Math.round(total),
    hours: Math.round(total / 360) / 10,
  }
}

function progressData() {
  if (progressCache) return progressCache
  try {
    progressCache = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
  } catch {
    progressCache = {}
  }
  return progressCache
}

function saveProgress(id, position, updated, chapter = 0) {
  const data = progressData()
  if (Number(data[id]?.updated) >= updated) return
  data[id] = { chapter, position, updated }
  const tmp = `${PROGRESS_FILE}.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, PROGRESS_FILE)
}

function hasAuth() {
  return true
}

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url')
}

function sessionInfo(cookie) {
  if (!cookie) return null
  const split = cookie.lastIndexOf('.')
  if (split === -1) return null
  const payload = cookie.slice(0, split)
  const signature = cookie.slice(split + 1)
  if (!payload || !signature) return null
  const expected = sign(payload)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  let data
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!Number.isFinite(Number(data.expires)) || Number(data.expires) < Math.floor(Date.now() / 1000)) return null
  return { username: cleanName(data.username) || 'User', expires: Number(data.expires) }
}

function newSession(username) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS
  const payload = Buffer.from(JSON.stringify({ expires, username: cleanName(username) || 'User' })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

function validSession(cookie) {
  return Boolean(sessionInfo(cookie))
}

function cookies(req) {
  const header = req.headers.cookie || ''
  const out = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index > -1) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return out
}

function authed(req) {
  return validSession(cookies(req)[COOKIE])
}

function sessionHeader(username) {
  return `${COOKIE}=${encodeURIComponent(newSession(username))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`
}

function clearHeader() {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}

function html(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function safeColor(value, fallback = '#222222') {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))))
    req.on('error', reject)
  })
}

function readFormField(form, name) {
  return (form.get(name) || '').toString()
}

/* --- library -------------------------------------------------------------- */

const colorCache = new Map()
const chapterCache = new Map()
let scanCache = { at: 0, books: [] }

function walk(dir, found = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, found)
    } else if (entry.name === 'metadata.json') {
      found.push(dir)
    }
  }
  return found
}

function firstAudio(dir) {
  const files = fs.readdirSync(dir).filter((name) => /\.(m4b|m4a|mp3)$/i.test(name))
  files.sort((a, b) => {
    const size = (name) => {
      try { return fs.statSync(path.join(dir, name)).size } catch { return 0 }
    }
    return size(b) - size(a)
  })
  return files.length ? path.join(dir, files[0]) : null
}

function extractRibbon(cover) {
  if (!cover || !fs.existsSync(cover)) return null
  try {
    const stat = fs.statSync(cover)
    const key = `${cover}:${stat.mtimeMs}`
    if (colorCache.has(key)) return colorCache.get(key)
    const raw = execFileSync(FFMPEG, [
      '-v', 'error', '-i', cover, '-vf', 'scale=1:1', '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ], { encoding: 'buffer', maxBuffer: 16 })
    if (raw.length >= 3) {
      const color = `#${raw[0].toString(16).padStart(2, '0')}${raw[1].toString(16).padStart(2, '0')}${raw[2].toString(16).padStart(2, '0')}`
      colorCache.set(key, color)
      return color
    }
  } catch {}
  return null
}

function probeChapters(audio) {
  try {
    const stat = fs.statSync(audio)
    const key = `${audio}:${stat.mtimeMs}`
    if (chapterCache.has(key)) return chapterCache.get(key)
    const raw = execFileSync(FFPROBE, [
      '-v', 'error', '-print_format', 'json', '-show_chapters', audio,
    ], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
    const data = JSON.parse(raw)
    const chapters = (data.chapters || []).map((chapter, index) => ({
      title: chapter.tags?.title || `Chapter ${index + 1}`,
      start: Math.round(Number(chapter.start_time) * 1000),
      end: Math.round(Number(chapter.end_time) * 1000),
    }))
    chapterCache.set(key, chapters)
    return chapters
  } catch {
    return []
  }
}

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function writeMetadata(book, meta) {
  const file = path.join(book.dir, 'metadata.json')
  const tmp = `${file}.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2) + '\n', { mode: 0o644 })
  fs.renameSync(tmp, file)
}

function renameShelf(oldShelf, name) {
  setShelfLabel(oldShelf, name)
  scanCache.at = 0
  return loadBooks().filter((entry) => entry.shelfKey === oldShelf).length
}

function seriesOf(meta) {
  if (meta.series_title) return cleanName(meta.series_title)
  if (Array.isArray(meta.series) && meta.series[0]?.title) return cleanName(meta.series[0].title)
  if (Array.isArray(meta.series) && typeof meta.series[0] === 'string') return cleanName(meta.series[0])
  return ''
}

function authorsOf(meta) {
  if (Array.isArray(meta.authors)) return meta.authors.map(cleanName).filter(Boolean)
  if (typeof meta.authors === 'string') return meta.authors.split(',').map(cleanName).filter(Boolean)
  if (meta.author) return [cleanName(meta.author)]
  return []
}

function shortTitle(title, series) {
  let value = cleanName(title)
  if (series && value.toLowerCase().startsWith(series.toLowerCase())) {
    value = value.slice(series.length).replace(/^[\s:–—-]+/, '').trim()
  }
  return value || cleanName(title)
}

function durationLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`
}

function coverAspect(cover) {
  if (!cover) return null
  try {
    const stat = fs.statSync(cover)
    const key = `${cover}:${stat.mtimeMs}`
    if (coverSizeCache.has(key)) return coverSizeCache.get(key)
    const raw = execFileSync(FFPROBE, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'json', cover,
    ], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
    const stream = JSON.parse(raw).streams?.[0]
    const width = Number(stream?.width)
    const height = Number(stream?.height)
    const aspect = width > 0 && height > 0 ? width / height : null
    coverSizeCache.set(key, aspect)
    return aspect
  } catch {
    return null
  }
}

function loadBooks() {
  if (Date.now() - scanCache.at < 2000) return scanCache.books
  const books = []
  for (const dir of walk(LIBRARY)) {
    let meta
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'))
    } catch {
      continue
    }
    const rawChapters = Array.isArray(meta.chapters) ? meta.chapters : []
    const split = rawChapters.length > 0 && rawChapters.every((chapter) => chapter.file)
    let audio = null
    let chapters = []
    let id = ''
    let audioVersion = 0
    let audioMode = 'single'
    let continuousFile = null

    if (split) {
      audioMode = 'chapters'
      for (const [index, chapter] of rawChapters.entries()) {
        const candidate = path.resolve(dir, chapter.file)
        if (!candidate.startsWith(`${dir}${path.sep}`)) continue
        let stat
        try { stat = fs.statSync(candidate) } catch { continue }
        let subtitleFile = null
        const subtitleName = cleanName(chapter.subtitle_file)
        if (subtitleName) {
          const subtitleCandidate = path.resolve(dir, subtitleName)
          if (subtitleCandidate.startsWith(`${dir}${path.sep}`) && fs.existsSync(subtitleCandidate)) {
            subtitleFile = subtitleCandidate
          }
        }
        chapters.push({
          index,
          title: cleanName(chapter.title) || `Chapter ${index + 1}`,
          start: Math.max(0, Math.round(Number(chapter.start) || 0)),
          end: Math.max(0, Math.round(Number(chapter.end) || 0)),
          duration: Math.max(0, Number(chapter.duration_ms) || 0) / 1000,
          file: candidate,
          fileVersion: Math.round(stat.mtimeMs),
          subtitleFile,
          subtitleVersion: subtitleFile ? Math.round(fs.statSync(subtitleFile).mtimeMs) : 0,
        })
        audioVersion = Math.max(audioVersion, Math.round(stat.mtimeMs))
      }
      if (!chapters.length) continue
      const continuousName = cleanName(meta.continuous_file) || 'book.m4b'
      const continuousCandidate = path.resolve(dir, continuousName)
      if (continuousCandidate.startsWith(`${dir}${path.sep}`) && fs.existsSync(continuousCandidate)) {
        continuousFile = continuousCandidate
      }
      if (/^[a-f0-9]{12}$/.test(String(meta.id || ''))) {
        id = meta.id
      } else {
        id = crypto.createHash('sha1').update(path.relative(LIBRARY, path.join(dir, 'metadata.json'))).digest('hex').slice(0, 12)
      }
    } else {
      audio = firstAudio(dir)
      if (!audio) continue
      try { audioVersion = Math.round(fs.statSync(audio).mtimeMs) } catch {}
      id = /^[a-f0-9]{12}$/.test(String(meta.id || ''))
        ? meta.id
        : crypto.createHash('sha1').update(path.relative(LIBRARY, audio)).digest('hex').slice(0, 12)
      if (!rawChapters.length) {
        chapters = probeChapters(audio).map((chapter, index) => ({
          index,
          ...chapter,
          duration: Math.max(0, (chapter.end - chapter.start) / 1000),
        }))
      } else {
        chapters = rawChapters
          .map((chapter, index) => ({
            index,
            title: cleanName(chapter.title) || 'Chapter',
            start: Math.max(0, Math.round(Number(chapter.start ?? chapter.start_ms ?? 0))),
            end: Math.max(0, Math.round(Number(chapter.end ?? chapter.end_ms ?? 0))),
          }))
          .filter((chapter) => Number.isFinite(chapter.start))
          .map((chapter) => ({ ...chapter, duration: Math.max(0, (chapter.end - chapter.start) / 1000) }))
      }
    }

    const series = seriesOf(meta)
    const shelfKey = cleanName(meta.shelf_id) || series || 'Standalone'
    const shelfLabel = shelfLabels()[shelfKey] || shelfKey
    const title = cleanName(meta.title) || (audio ? path.basename(audio, path.extname(audio)) : dir.name)
    const displayTitle = shortTitle(title, series)
    const authors = authorsOf(meta)
    const coverBig = series || title
    const coverSmall = series ? displayTitle || authors[0] || 'Audiobook' : authors[0] || 'Audiobook'
    const cover = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp']
      .map((name) => path.join(dir, name))
      .find((file) => fs.existsSync(file)) || null
    let duration = Number(meta.duration_ms || 0) / 1000
    if (!duration && chapters.length) duration = (chapters[chapters.length - 1].end || 0) / 1000
    if (!duration && split) duration = chapters.reduce((total, chapter) => total + chapter.duration, 0)
    const ribbon = safeColor(meta.ribbon, extractRibbon(cover) || '#222222')

    books.push({
      id,
      file: audio,
      audioMode,
      continuousFile,
      dir,
      title,
      displayTitle: displayTitle || title,
      coverBig,
      coverSmall,
      series,
      shelfKey,
      shelf: shelfLabel,
      sequence: cleanName(meta.series_sequence),
      authors,
      narrator: Array.isArray(meta.narrators) ? meta.narrators.join(', ') : cleanName(meta.narrators),
      description: cleanName(meta.description),
      chapters,
      duration,
      durationLabel: durationLabel(duration),
      ribbon,
      audioVersion,
      coverFile: cover,
      coverAspect: coverAspect(cover),
      showCover: Boolean(meta.cover_image) && Boolean(cover),
    })
  }
  const layout = layoutData()
  const shelfOrder = new Map(layout.shelves.map((key, index) => [key, index]))
  books.sort((a, b) => {
    const aShelf = shelfOrder.has(a.shelfKey) ? shelfOrder.get(a.shelfKey) : Number.MAX_SAFE_INTEGER
    const bShelf = shelfOrder.has(b.shelfKey) ? shelfOrder.get(b.shelfKey) : Number.MAX_SAFE_INTEGER
    if (aShelf !== bShelf) return aShelf - bShelf
    const aOrder = (layout.books[a.shelfKey] || []).indexOf(a.id)
    const bOrder = (layout.books[b.shelfKey] || []).indexOf(b.id)
    if (aOrder !== bOrder) {
      if (aOrder === -1) return 1
      if (bOrder === -1) return -1
      return aOrder - bOrder
    }
    return a.shelf.localeCompare(b.shelf) || compareSequence(a, b) || a.title.localeCompare(b.title)
  })
  scanCache = { at: Date.now(), books }
  return books
}

function compareSequence(a, b) {
  const av = Number.parseFloat(a.sequence)
  const bv = Number.parseFloat(b.sequence)
  if (Number.isFinite(av) && Number.isFinite(bv)) return av - bv
  if (Number.isFinite(av)) return -1
  if (Number.isFinite(bv)) return 1
  return 0
}

function shelves(books) {
  const map = new Map()
  for (const book of books) {
    const key = book.shelfKey || book.shelf
    if (!map.has(key)) map.set(key, { key, name: book.shelf, books: [] })
    map.get(key).books.push(book)
  }
  const labels = shelfLabels()
  const layout = layoutData()
  for (const key of layout.shelves) {
    if (!map.has(key)) map.set(key, { key, name: labels[key] || key, books: [] })
  }
  const order = new Map(layout.shelves.map((key, index) => [key, index]))
  return [...map.values()].sort((a, b) => {
    const ai = order.has(a.key) ? order.get(a.key) : Number.MAX_SAFE_INTEGER
    const bi = order.has(b.key) ? order.get(b.key) : Number.MAX_SAFE_INTEGER
    if (ai !== bi) return ai - bi
    return a.name.localeCompare(b.name)
  })
}

function bookById(id) {
  return loadBooks().find((book) => book.id === id) || null
}

function publicBook(book) {
  let continuousVersion = 0
  if (book.continuousFile) {
    try { continuousVersion = Math.round(fs.statSync(book.continuousFile).mtimeMs) } catch {}
  }
  return {
    id: book.id,
    title: book.title,
    displayTitle: book.displayTitle,
    coverBig: book.coverBig,
    coverSmall: book.coverSmall,
    series: book.series,
    shelfKey: book.shelfKey,
    shelf: book.shelf,
    sequence: book.sequence,
    authors: book.authors,
    narrator: book.narrator,
    description: book.description,
    audioMode: book.audioMode,
    continuousUrl: book.continuousFile ? `/audio/${book.id}` : '',
    continuousVersion,
    chapters: book.chapters.map((chapter) => ({
      index: chapter.index,
      title: chapter.title,
      start: chapter.start,
      end: chapter.end,
      duration: chapter.duration,
      fileVersion: chapter.fileVersion || 0,
      subtitleUrl: chapter.subtitleFile ? `/subtitle/${book.id}/${chapter.index}?v=${chapter.subtitleVersion || 0}` : '',
    })),
    duration: book.duration,
    durationLabel: book.durationLabel,
    ribbon: book.ribbon,
    coverUrl: book.showCover ? `/cover/${book.id}` : '',
    coverAspect: book.coverAspect || 1,
    position: Number(progressData()[book.id]?.position) || 0,
    positionUpdated: Number(progressData()[book.id]?.updated) || 0,
    chapter: Number(progressData()[book.id]?.chapter) || 0,
    audioVersion: book.audioVersion || 0,
  }
}

function libraryPayload() {
  const books = loadBooks().map(publicBook)
  return {
    books,
    shelves: shelves(books),
    stats: weeklyListening(),
  }
}

function appShell(username = '') {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#111111">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <title>Clam</title>
  <meta name="apple-mobile-web-app-title" content="Clam">
  <link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
  <script src="/static/theme.js"></script>
  <link rel="stylesheet" href="/static/style.css">
  <script src="/static/app.js" defer></script>
</head>
<body class="app" data-username="${html(username)}">
  <div id="app"><div class="splash" role="status" aria-live="polite">
    <div class="splash-top">
      <span class="wordmark"><span class="wordmark-mark" aria-hidden="true"></span>Clam</span>
      <span class="micro">Local edition</span>
    </div>
    <div class="splash-center">
      <p class="micro">Opening shelf</p>
      <div class="splash-line" aria-hidden="true"><span></span></div>
    </div>
    <div class="splash-bottom">
      <span class="micro">Audiobooks</span>
      <span class="micro">On this device</span>
    </div>
  </div></div>
  <div id="mini" class="mini" hidden></div>
  <dialog id="chapters-dialog" class="chapters-dialog"></dialog>
  <dialog id="shelf-edit-dialog" class="chapters-dialog"></dialog>
  <dialog id="book-edit-dialog" class="chapters-dialog"></dialog>
  <audio id="audio" preload="metadata"></audio>
</body>
</html>`
}

/* --- pages ---------------------------------------------------------------- */

function layout({ title, body, authed: signedIn, bodyClass = '', script = '' }) {
  const lock = signedIn
    ? `<form method="post" action="/logout" class="lock-form"><button class="link-button" type="submit">Lock</button></form>`
    : ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#111111">
  <title>${html(title)}</title>
  <link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
  <script src="/static/theme.js"></script>
  <link rel="stylesheet" href="/static/style.css">
  ${script ? `<script src="${html(script)}" defer></script>` : ''}
</head>
<body class="${html(bodyClass)}">
  <div class="top">
    <header class="masthead">
      <a class="wordmark" href="/"><span class="wordmark-mark" aria-hidden="true"></span>Clam</a>
      ${lock}
    </header>
  </div>
  ${body}
</body>
</html>`
}

function authPage({ error = '' } = {}) {
  return layout({
    title: 'Clam',
    authed: false,
    bodyClass: 'auth',
    body: `<main class="auth-main">
      <p class="micro">Flowwing identity</p>
      <h1 class="auth-hero">Listen.</h1>
      <p class="auth-intro">Use your Flowwing account. The same username and password work in Bookreader.</p>
      ${error ? `<p class="error micro" role="alert">${html(error)}</p>` : ''}
      <form method="post" action="/login" class="auth-form">
        <div class="field">
          <label for="username">Username</label>
          <input id="username" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="64" required autofocus>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" maxlength="200" required>
        </div>
        <div class="actions">
          <button class="primary" type="submit">Sign in</button>
        </div>
      </form>
      <p class="micro auth-note">One Flowwing login for Clam and Bookreader.</p>
    </main>`,
  })
}

function coverMarkup(book, { link = false } = {}) {
  const inner = `<div class="cover" style="--ribbon:${safeColor(book.ribbon)}">
      <p class="cover-series">${html(book.coverBig)}</p>
      <p class="cover-title">${html(book.coverSmall)}</p>
    </div>`
  return link
    ? `<a class="book-link" href="/book/${book.id}" aria-label="${html(book.title)}">${inner}</a>`
    : inner
}

function shelfPage(books) {
  if (!books.length) {
    return layout({
      title: 'Clam',
      authed: true,
      body: `<main class="shelf-main">
        <div class="empty">
          <p class="micro">Empty shelf</p>
          <h1>Nothing here yet.</h1>
          <p class="muted">Convert and port a book, then refresh.</p>
        </div>
      </main>`,
    })
  }
  const sections = shelves(books).map(([shelf, entries]) => {
    const cards = entries.map((book) => `<article class="book">
        ${coverMarkup(book, { link: true })}
        <p class="book-author">${html(book.authors.join(', ') || 'Unknown author')}</p>
        <p class="micro">${html([book.durationLabel, book.sequence ? `Book ${book.sequence}` : ''].filter(Boolean).join(' · '))}</p>
      </article>`).join('')
    return `<section class="shelf">
      <header class="shelf-head">
        <h2>${html(shelf)}</h2>
        <p class="micro">${entries.length} ${entries.length === 1 ? 'book' : 'books'}</p>
      </header>
      <div class="rail">${cards}</div>
    </section>`
  }).join('')
  return layout({
    title: 'Clam',
    authed: true,
    body: `<main class="shelf-main">${sections}</main>`,
  })
}

function bookPage(book) {
  const chapterRows = book.chapters.length
    ? `<ol class="chapters">${book.chapters.map((chapter, index) => `<li>
        <button type="button" class="chapter" data-start="${chapter.start}">
          <span class="chapter-no">${String(index + 1).padStart(2, '0')}</span>
          <span class="chapter-name">${html(chapter.title)}</span>
          <span class="chapter-time">${formatTime(chapter.start / 1000)}</span>
        </button>
      </li>`).join('')}</ol>`
    : `<p class="muted">No chapters.</p>`
  return layout({
    title: `${book.title} — Clam`,
    authed: true,
    bodyClass: 'book-body',
    script: '/static/player.js',
    body: `<main class="book-main">
      <a class="back" href="/shelf">← Your shelf</a>
      <div class="book-layout">
        <div class="book-cover">${coverMarkup(book)}</div>
        <div class="book-detail">
          <p class="micro">${html(book.shelf)}${book.sequence ? ` · Book ${html(book.sequence)}` : ''}</p>
          <h1>${html(book.title)}</h1>
          <p class="byline">${html(book.authors.join(', ') || 'Unknown author')}${book.narrator ? ` · read by ${html(book.narrator)}` : ''}</p>
          ${book.description ? `<p class="description">${html(book.description)}</p>` : ''}
          <details class="series-editor">
            <summary>Edit series</summary>
            <form class="series-form" method="post" action="/book/${book.id}/series">
              <label class="sr-only" for="series">Series title</label>
              <input id="series" name="series" value="${html(book.series === 'Standalone' ? '' : book.series)}" maxlength="80" placeholder="Standalone">
              <button class="inline-button" type="submit">Save</button>
            </form>
          </details>
          <section class="chapter-section">
            <div class="shelf-head"><h2>Chapters</h2><p class="micro">${book.chapters.length || 0}</p></div>
            ${chapterRows}
          </section>
        </div>
      </div>
      <div class="player" data-book="${book.id}">
        <button class="play" id="play" type="button" aria-label="Play">Play</button>
        <span class="time" id="current">0:00</span>
        <input id="seek" class="seek" type="range" min="0" max="1" step="1" value="0" aria-label="Seek">
        <span class="time" id="duration">${formatTime(book.duration)}</span>
      </div>
      <audio id="audio" src="/audio/${book.id}" preload="metadata"></audio>
    </main>`,
  })
}

function notFound(signedIn = false) {
  return layout({
    title: 'Not found — Clam',
    authed: signedIn,
    body: `<main class="empty"><p class="micro">404</p><h1>Not found.</h1><p class="muted"><a href="/">Back to the shelf</a></p></main>`,
  })
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${minutes}:${String(secs).padStart(2, '0')}`
}

/* --- HTTP ----------------------------------------------------------------- */

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(body)
}

function redirect(res, location, cookie = '') {
  const headers = { Location: location }
  if (cookie) headers['Set-Cookie'] = cookie
  res.writeHead(303, headers)
  res.end()
}

function requireAuth(req, res) {
  if (authed(req)) return true
  redirect(res, '/login')
  return false
}

function serveStatic(req, res, pathname) {
  const name = pathname.slice('/static/'.length)
  if (!['style.css', 'app.js', 'player.js', 'favicon.svg', 'theme.js'].includes(name)) return send(res, 404, notFound())
  const file = path.join(PUBLIC, name)
  if (!fs.existsSync(file)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' })
  const type = name.endsWith('.css')
    ? 'text/css; charset=utf-8'
    : name.endsWith('.svg')
      ? 'image/svg+xml'
      : 'text/javascript; charset=utf-8'
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' })
  fs.createReadStream(file).pipe(res)
}

function serveCover(req, res, id) {
  const book = bookById(id)
  if (!book?.coverFile) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' })
  let stat
  try {
    stat = fs.statSync(book.coverFile)
  } catch {
    return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' })
  }
  const extension = path.extname(book.coverFile).toLowerCase()
  const type = extension === '.png' ? 'image/png'
    : extension === '.webp' ? 'image/webp'
      : 'image/jpeg'
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'private, max-age=86400',
    'ETag': `"${stat.size}-${Math.round(stat.mtimeMs)}"`,
    'Last-Modified': stat.mtime.toUTCString(),
  })
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(book.coverFile).pipe(res)
}

function audioMime(file) {
  const extension = path.extname(file).toLowerCase()
  if (extension === '.mp3') return 'audio/mpeg'
  if (extension === '.m4a' || extension === '.m4b') return 'audio/mp4'
  return 'application/octet-stream'
}

function serveSubtitle(req, res, id, chapterParam) {
  const book = bookById(id)
  if (!book) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' })
  const chapter = Number(chapterParam)
  if (!Number.isInteger(chapter) || chapter < 0 || chapter >= book.chapters.length) {
    return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' })
  }
  const file = book.chapters[chapter].subtitleFile
  if (!file) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' })
  let stat
  try { stat = fs.statSync(file) } catch { return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' }) }
  const etag = `"sub-${stat.size}-${Math.round(stat.mtimeMs)}"`
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'ETag': etag,
    'Last-Modified': stat.mtime.toUTCString(),
  }
  if (req.method === 'HEAD') {
    res.writeHead(200, { ...headers, 'Content-Length': stat.size })
    return res.end()
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size })
  fs.createReadStream(file).pipe(res)
}

function serveAudio(req, res, id, chapterParam) {
  const book = bookById(id)
  if (!book) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' })
  let file = book.file
  if (book.audioMode === 'chapters') {
    if (chapterParam === undefined || chapterParam === null || chapterParam === '') {
      if (!book.continuousFile) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' })
      file = book.continuousFile
    } else {
      const chapter = Number(chapterParam)
      if (!Number.isInteger(chapter) || chapter < 0 || chapter >= book.chapters.length) {
        return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' })
      }
      file = book.chapters[chapter].file
    }
  }
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' })
  }
  const total = stat.size
  const etag = `"${total}-${Math.round(stat.mtimeMs)}"`
  const common = {
    'Content-Type': audioMime(file),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=86400',
    'ETag': etag,
    'Last-Modified': stat.mtime.toUTCString(),
  }
  const range = req.headers.range
  if (!range) {
    res.writeHead(200, { ...common, 'Content-Length': total })
    if (req.method === 'HEAD') return res.end()
    return fs.createReadStream(file).pipe(res)
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match) {
    res.writeHead(416, { 'Content-Range': `bytes */${total}` })
    return res.end()
  }
  let start = match[1] === '' ? null : Number(match[1])
  let end = match[2] === '' ? null : Number(match[2])
  if (start === null) {
    start = Math.max(0, total - Number(end))
    end = total - 1
  } else if (end === null || end >= total) {
    end = total - 1
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0) {
    res.writeHead(416, { 'Content-Range': `bytes */${total}` })
    return res.end()
  }
  res.writeHead(206, { ...common, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${total}` })
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(file, { start, end }).pipe(res)
}

const failures = new Map()

function tooMany(ip) {
  const entry = failures.get(ip)
  if (!entry) return false
  if (Date.now() > entry.reset) {
    failures.delete(ip)
    return false
  }
  return entry.count >= 6
}

function failed(ip) {
  const now = Date.now()
  const entry = failures.get(ip)
  if (!entry || now > entry.reset) {
    failures.set(ip, { count: 1, reset: now + 60_000 })
  } else {
    entry.count += 1
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const pathname = decodeURIComponent(url.pathname)
  const ip = req.socket.remoteAddress || 'unknown'

  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")

  if (pathname === '/health') {
    return send(res, 200, JSON.stringify({ ok: true, books: loadBooks().length }), { 'Content-Type': 'application/json' })
  }

  if (pathname.startsWith('/static/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' })
    return serveStatic(req, res, pathname)
  }

  if (pathname === '/api/books') {
    if (!hasAuth() || !authed(req)) {
      return send(res, 401, JSON.stringify({ error: 'unauthorized' }), { 'Content-Type': 'application/json' })
    }
    return send(res, 200, JSON.stringify(libraryPayload()), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  }

  if (pathname === '/api/session') {
    const session = sessionInfo(cookies(req)[COOKIE])
    return send(res, 200, JSON.stringify({
      signedIn: Boolean(session),
      username: session?.username || null,
      expires: session?.expires || null,
    }), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  }

  if (pathname === '/api/listen') {
    if (!hasAuth() || !authed(req)) {
      return send(res, 401, JSON.stringify({ error: 'unauthorized' }), { 'Content-Type': 'application/json' })
    }
    if (req.method !== 'POST') return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' })
    const form = await parseBody(req).catch(() => null)
    if (!form) return send(res, 400, 'Could not read listening time', { 'Content-Type': 'text/plain' })
    const seconds = Number(readFormField(form, 'seconds'))
    if (!Number.isFinite(seconds) || seconds <= 0) return send(res, 400, 'Invalid listening time', { 'Content-Type': 'text/plain' })
    addListening(Math.min(7200, Math.round(seconds * 10) / 10))
    return send(res, 200, JSON.stringify(weeklyListening()), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  }

  if (pathname === '/api/series') {
    if (!hasAuth() || !authed(req)) {
      return send(res, 401, JSON.stringify({ error: 'unauthorized' }), { 'Content-Type': 'application/json' })
    }
    if (req.method !== 'POST') return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' })
    const form = await parseBody(req).catch(() => null)
    if (!form) return send(res, 400, 'Could not read the form', { 'Content-Type': 'text/plain' })
    const oldShelf = cleanName(readFormField(form, 'old'))
    const name = cleanName(readFormField(form, 'name'))
    if (!oldShelf) return send(res, 400, 'Missing shelf', { 'Content-Type': 'text/plain' })
    if (name.length > 80) return send(res, 400, 'Shelf name is too long', { 'Content-Type': 'text/plain' })
    const updated = renameShelf(oldShelf, name)
    return send(res, 200, JSON.stringify({ ok: true, updated }), { 'Content-Type': 'application/json' })
  }

  if (pathname === '/api/shelves') {
    if (!hasAuth() || !authed(req)) {
      return send(res, 401, JSON.stringify({ error: 'unauthorized' }), { 'Content-Type': 'application/json' })
    }
    if (req.method !== 'POST') return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' })
    const form = await parseBody(req).catch(() => null)
    if (!form) return send(res, 400, 'Could not read the form', { 'Content-Type': 'text/plain' })
    const name = cleanName(readFormField(form, 'name'))
    if (!name) return send(res, 400, 'A shelf needs a name', { 'Content-Type': 'text/plain' })
    if (name.length > 80) return send(res, 400, 'Shelf name is too long', { 'Content-Type': 'text/plain' })
    try {
      const shelf = createShelf(name)
      return send(res, 200, JSON.stringify({ ok: true, shelf }), { 'Content-Type': 'application/json' })
    } catch (error) {
      return send(res, 400, String(error.message || 'Could not create shelf'), { 'Content-Type': 'text/plain' })
    }
  }

  if (pathname === '/api/layout') {
    if (!hasAuth() || !authed(req)) {
      return send(res, 401, JSON.stringify({ error: 'unauthorized' }), { 'Content-Type': 'application/json' })
    }
    if (req.method !== 'POST') return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' })
    const form = await parseBody(req).catch(() => null)
    if (!form) return send(res, 400, 'Could not read the layout', { 'Content-Type': 'text/plain' })
    let shelvesInput
    let booksInput
    try {
      shelvesInput = JSON.parse(readFormField(form, 'shelves') || '[]')
      booksInput = JSON.parse(readFormField(form, 'books') || '{}')
    } catch {
      return send(res, 400, 'Invalid layout', { 'Content-Type': 'text/plain' })
    }
    if (!Array.isArray(shelvesInput) || !booksInput || typeof booksInput !== 'object') {
      return send(res, 400, 'Invalid layout', { 'Content-Type': 'text/plain' })
    }
    const known = new Set(shelves(loadBooks()).map((shelf) => shelf.key))
    const shelfKeys = [...new Set(shelvesInput.filter((key) => typeof key === 'string' && known.has(key)))]
    const books = {}
    for (const key of shelfKeys) {
      const ids = Array.isArray(booksInput[key]) ? booksInput[key] : []
      books[key] = ids.filter((id) => /^[a-f0-9]{12}$/.test(String(id)))
    }
    saveLayout({ shelves: shelfKeys, books })
    return send(res, 200, JSON.stringify(libraryPayload()), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  }

  if (/^\/api\/books\/[a-f0-9]{12}$/.test(pathname)) {
    if (!hasAuth() || !authed(req)) {
      return send(res, 401, JSON.stringify({ error: 'unauthorized' }), { 'Content-Type': 'application/json' })
    }
    if (req.method !== 'POST') return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' })
    const id = pathname.split('/')[3]
    const book = bookById(id)
    if (!book) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' })
    const form = await parseBody(req).catch(() => null)
    if (!form) return send(res, 400, 'Could not read the form', { 'Content-Type': 'text/plain' })
    let meta
    try {
      meta = JSON.parse(fs.readFileSync(path.join(book.dir, 'metadata.json'), 'utf8'))
    } catch {
      return send(res, 500, 'Could not read metadata', { 'Content-Type': 'text/plain' })
    }
    const title = cleanName(readFormField(form, 'title'))
    if (!title) return send(res, 400, 'A book needs a title', { 'Content-Type': 'text/plain' })
    if (title.length > 240) return send(res, 400, 'Title is too long', { 'Content-Type': 'text/plain' })
    const authors = readFormField(form, 'authors').split(',').map(cleanName).filter(Boolean)
    const narrators = readFormField(form, 'narrators').split(',').map(cleanName).filter(Boolean)
    const seriesTitle = cleanName(readFormField(form, 'series_title'))
    const seriesSequence = cleanName(readFormField(form, 'series_sequence'))
    const description = cleanName(readFormField(form, 'description'))
    const shelfKey = cleanName(readFormField(form, 'shelfKey'))
    if (shelfKey && !shelves(loadBooks()).some((shelf) => shelf.key === shelfKey)) {
      return send(res, 400, 'Unknown shelf', { 'Content-Type': 'text/plain' })
    }
    meta.title = title
    meta.authors = authors
    meta.narrators = narrators
    meta.series_title = seriesTitle
    meta.series_sequence = seriesSequence
    meta.series = seriesTitle ? [{ title: seriesTitle, sequence: seriesSequence }] : []
    meta.description = description
    if (shelfKey) meta.shelf_id = shelfKey
    else delete meta.shelf_id
    writeMetadata(book, meta)
    scanCache.at = 0
    return send(res, 200, JSON.stringify({ ok: true, book: publicBook(bookById(id)) }), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  }

  if (/^\/api\/progress\/[a-f0-9]{12}$/.test(pathname)) {
    if (!hasAuth() || !authed(req)) {
      return send(res, 401, JSON.stringify({ error: 'unauthorized' }), { 'Content-Type': 'application/json' })
    }
    if (req.method !== 'POST') return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' })
    const id = pathname.split('/')[3]
    if (!bookById(id)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' })
    const form = await parseBody(req).catch(() => null)
    if (!form) return send(res, 400, 'Could not read progress', { 'Content-Type': 'text/plain' })
    const position = Number(readFormField(form, 'position'))
    const chapter = Number(readFormField(form, 'chapter')) || 0
    const rawUpdated = readFormField(form, 'updated')
    const updated = rawUpdated ? Number(rawUpdated) : Date.now()
    if (!Number.isFinite(position) || position < 0) return send(res, 400, 'Invalid position', { 'Content-Type': 'text/plain' })
    if (!Number.isInteger(chapter) || chapter < 0) return send(res, 400, 'Invalid chapter', { 'Content-Type': 'text/plain' })
    if (!Number.isFinite(updated) || updated <= 0 || updated > Date.now() + 60_000) return send(res, 400, 'Invalid timestamp', { 'Content-Type': 'text/plain' })
    saveProgress(id, Math.round(position * 1000) / 1000, Math.round(updated), chapter)
    return send(res, 204, '', { 'Cache-Control': 'no-store' })
  }

  if (pathname === '/login') {
    if (req.method === 'GET') {
      if (authed(req)) return redirect(res, '/')
      return send(res, 200, authPage())
    }
    if (req.method === 'POST') {
      if (tooMany(ip)) return send(res, 429, authPage({ error: 'Too many attempts. Wait a minute.' }))
      const form = await parseBody(req).catch(() => null)
      if (!form) return send(res, 400, authPage({ error: 'Could not read the form.' }))
      const username = cleanName(readFormField(form, 'username'))
      const password = readFormField(form, 'password')
      if (!username || !password) return send(res, 400, authPage({ error: 'Username and password are required.' }))
      let response
      try {
        response = await fetch(AUTH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
          signal: AbortSignal.timeout(8000),
        })
      } catch {
        return send(res, 503, authPage({ error: 'Flowwing identity is unavailable. Try again.' }))
      }
      if (!response.ok) {
        if (response.status === 401) {
          failed(ip)
          return send(res, 401, authPage({ error: 'Wrong name or password.' }))
        }
        return send(res, 503, authPage({ error: 'Flowwing identity is unavailable. Try again.' }))
      }
      const data = await response.json().catch(() => ({}))
      const name = cleanName(data.username) || username
      failures.delete(ip)
      return redirect(res, '/', sessionHeader(name))
    }
    return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' })
  }

  if (pathname === '/setup') return redirect(res, '/login')

  if (pathname === '/logout') {
    if (req.method !== 'POST' && req.method !== 'GET') return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' })
    return redirect(res, '/login', clearHeader())
  }

  if (pathname === '/' || pathname === '/shelf' || pathname === '/play/' || /^\/(book|play)\/[a-f0-9]+\/?$/.test(pathname)) {
    if (!authed(req)) return redirect(res, '/login')
    const info = sessionInfo(cookies(req)[COOKIE])
    return send(res, 200, appShell(info?.username || ''))
  }

  if (/^\/cover\/[a-f0-9]{12}$/.test(pathname)) {
    if (!requireAuth(req, res)) return
    return serveCover(req, res, pathname.split('/')[2])
  }

  if (pathname.startsWith('/subtitle/')) {
    if (!requireAuth(req, res)) return
    const parts = pathname.slice('/subtitle/'.length).split('/')
    if (parts.length !== 2 || !parts[0]) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' })
    return serveSubtitle(req, res, parts[0], parts[1])
  }

  if (pathname.startsWith('/audio/')) {
    if (!requireAuth(req, res)) return
    const parts = pathname.slice('/audio/'.length).split('/')
    if (parts.length > 2 || !parts[0]) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' })
    return serveAudio(req, res, parts[0], parts[1])
  }

  if (pathname === '/favicon.ico') {
    res.writeHead(204)
    return res.end()
  }

  send(res, 404, notFound(authed(req)))
})

server.listen(PORT, HOST, () => {
  console.log(`Clam listening on http://${HOST}:${PORT}`)
  console.log(`Clam library: ${LIBRARY}`)
  console.log(`Data: ${DATA}`)
})

function stop(signal) {
  console.log(`${signal}; closing`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
