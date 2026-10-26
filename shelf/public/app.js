/* Shelf client: persistent audio, shelves, book, now playing. */
(() => {
  const app = document.getElementById('app')
  const mini = document.getElementById('mini')
  const bootAt = Date.now()
  let booted = false
  const audio = document.getElementById('audio')
  const dialog = document.getElementById('chapters-dialog')
  const bookDialog = document.getElementById('book-edit-dialog')
  const boundTransport = new WeakSet()
  for (const sheet of [dialog, bookDialog]) {
    if (!sheet) continue
    sheet.addEventListener('click', (event) => {
      if (event.target === sheet) sheet.close()
    })
  }

  const state = {
    books: [],
    shelves: [],
    data: null,
    audioBook: null,
    audioChapter: 0,
    routeBook: null,
    loading: false,
    renderId: 0,
    autoplayNext: false,
    saveAt: 0,
    seeking: false,
    lastServerSave: 0,
    progressReady: false,
    stats: null,
    listenSince: 0,
    arranging: false,
  }

  const iconPlay = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'
  const iconPause = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'
  const iconBack = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>'
  const iconList = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>'
  const iconChevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'
  const iconSeek = (direction) => direction < 0
    ? '<span class="seek-mark" aria-hidden="true"><span class="seek-arrow">↺</span><span class="skip-num">15</span></span>'
    : '<span class="seek-mark" aria-hidden="true"><span class="seek-arrow">↻</span><span class="skip-num">15</span></span>'

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

  function clock(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${minutes}:${String(secs).padStart(2, '0')}`
  }

  function bookById(id) {
    return state.books.find((book) => book.id === id) || null
  }

  async function loadLibrary(force = false) {
    if (state.loading) return
    if (state.data && !force) return
    state.loading = true
    try {
      const response = await fetch('/api/books', { headers: { Accept: 'application/json' } })
      if (response.status === 401) {
        location.href = '/login'
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      state.data = await response.json()
      state.books = state.data.books || []
      state.shelves = state.data.shelves || []
      state.stats = state.data.stats || null
    } finally {
      state.loading = false
    }
  }

  function topBar() {
    const username = document.body.dataset.username || 'User'
    const initial = (username.trim().charAt(0) || 'U').toUpperCase()
    return `<div class="top"><header class="masthead">
      <a class="wordmark" href="/" data-link><span class="wordmark-mark" aria-hidden="true"></span>Clam</a>
      <div class="user-control">
        <button class="user-button" type="button" data-user-menu aria-label="Account and style for ${esc(username)}" aria-expanded="false">${esc(initial)}</button>
        <div class="user-popover" data-user-popover hidden>
          <form method="post" action="/logout"><button class="user-action" type="submit">Log out</button></form>
          <div class="user-style">
            <p class="micro">Style</p>
            <div class="theme-options">
              <button type="button" class="theme-choice" data-theme-choice="paper"><span class="theme-swatch theme-paper">Aa</span><span>Paper</span></button>
              <button type="button" class="theme-choice" data-theme-choice="sepia"><span class="theme-swatch theme-sepia">Aa</span><span>Sepia</span></button>
              <button type="button" class="theme-choice" data-theme-choice="night"><span class="theme-swatch theme-night">Aa</span><span>Night</span></button>
            </div>
          </div>
        </div>
      </div>
    </header></div>`
  }

  function closeUserMenu() {
    const popover = document.querySelector('[data-user-popover]')
    const button = document.querySelector('[data-user-menu]')
    if (popover) popover.hidden = true
    if (button) button.setAttribute('aria-expanded', 'false')
  }

  function cover(book, extra = '') {
    if (book.coverUrl) {
      return `<div class="cover cover--image ${extra}" style="--cover-aspect:${Number(book.coverAspect) || 1}">
        <img src="${esc(book.coverUrl)}" alt="">
      </div>`
    }
    return `<div class="cover ${extra}" style="--ribbon:${esc(book.ribbon)}">
      <p class="cover-series">${esc(book.coverBig)}</p>
      <p class="cover-title">${esc(book.coverSmall)}</p>
    </div>`
  }

  function notFound() {
    app.innerHTML = `${topBar()}<main class="empty"><p class="micro">404</p><h1>Not found.</h1><p class="muted"><a href="/shelf" data-link>Back to your shelf</a></p></main>`
    document.body.classList.remove('has-mini')
  }

  function lastListeningBook() {
    if (state.audioBook) return state.audioBook
    let id = ''
    try { id = localStorage.getItem('shelf:last') || '' } catch {}
    return bookById(id)
  }

  function continueMarkup(book) {
    if (!book) {
      return `<section class="home-section" aria-labelledby="continue-title">
        <div class="section-head"><h2 class="micro" id="continue-title">Continue listening</h2><span class="section-rule"></span></div>
        <div class="continue-empty">
          <p>Nothing in progress.</p>
          <a href="/shelf" data-link>Choose a book <span aria-hidden="true">→</span></a>
        </div>
      </section>`
    }
    const index = Math.max(0, Math.min((book.chapters.length || 1) - 1, Number(book.chapter) || 0))
    const chapter = book.chapters[index]
    const duration = chapter?.duration || 0
    const position = Math.max(0, Number(book.position) || 0)
    const percent = duration ? Math.min(100, (position / duration) * 100) : 0
    return `<section class="home-section" aria-labelledby="continue-title">
      <div class="section-head"><h2 class="micro" id="continue-title">Continue listening</h2><span class="section-rule"></span></div>
      <a class="continue-card" href="/play/${book.id}" data-link>
        <div class="continue-cover">${cover(book)}</div>
        <div class="continue-body">
          <p class="micro">${esc(book.shelf)}</p>
          <h3 class="continue-title">${esc(book.title)}</h3>
          <p class="continue-chapter">${chapter ? `Chapter ${index + 1} · ${esc(chapter.title)}` : 'Open player'}</p>
          <div class="continue-progress"><span style="width:${percent}%"></span></div>
          <p class="continue-meta">${position > 0 ? `${clock(position)} / ${clock(duration)}` : book.durationLabel || 'Start listening'}</p>
        </div>
        <span class="continue-action" aria-hidden="true">${iconChevron}</span>
      </a>
    </section>`
  }

  function weekBarsMarkup(stats) {
    const dayNames = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
    let days = Array.isArray(stats?.days) ? stats.days : []
    if (days.length !== 7) {
      days = dayNames.map((_, index) => ({ date: `day-${index}`, seconds: 0 }))
    }
    const max = Math.max(1, ...days.map((day) => Number(day.seconds) || 0))
    return days.map((day, index) => {
      const value = Math.max(0, Number(day.seconds) || 0)
      const height = value > 0 ? Math.max(4, (value / max) * 100) : 0
      return `<div class="week-day">
        <span class="week-bar"><span class="week-bar-fill" style="height:${height}%"></span></span>
        <span class="week-label">${dayNames[index]}</span>
      </div>`
    }).join('')
  }

  function statsMarkup(stats) {
    const seconds = Math.max(0, Number(stats?.weekSeconds) || 0)
    const hours = (seconds / 3600).toFixed(1)
    return `<section class="stats-banner" aria-labelledby="stats-title">
      <div class="section-head"><h2 class="micro" id="stats-title">Listening this week</h2><span class="section-rule"></span><p class="micro">Mon–Sun</p></div>
      <div class="stats-figure"><span data-week-hours>${hours}</span><span class="stats-unit">hours</span></div>
      <div data-week-bars>${weekBarsMarkup(stats)}</div>
    </section>`
  }

  function updateStatsBanner() {
    const seconds = Math.max(0, Number(state.stats?.weekSeconds) || 0)
    const hours = document.querySelector('[data-week-hours]')
    if (hours) hours.textContent = (seconds / 3600).toFixed(1)
    const bars = document.querySelector('[data-week-bars]')
    if (bars) bars.innerHTML = weekBarsMarkup(state.stats)
  }

  function addLocalListening(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return
    if (!state.stats) state.stats = { days: [], weekSeconds: 0 }
    state.stats.weekSeconds = Math.max(0, Number(state.stats.weekSeconds) || 0) + seconds
    const today = new Date()
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const day = Array.isArray(state.stats.days) ? state.stats.days.find((entry) => entry.date === key) : null
    if (day) day.seconds = (Number(day.seconds) || 0) + seconds
    updateStatsBanner()
  }

  function homeView() {
    const current = lastListeningBook()
    app.innerHTML = `${topBar()}<main class="home-main">
      <a class="home-title-link" href="/shelf" data-link>
        <h1 class="home-title">Your shelf</h1>
        <span class="home-title-cta">All books <span aria-hidden="true">→</span></span>
      </a>
      ${continueMarkup(current)}
      ${statsMarkup(state.stats)}
    </main>`
    updateStatsBanner()
  }

  function bookPercent(book) {
    const chapters = book.chapters || []
    const index = Math.max(0, Math.min((chapters.length || 1) - 1, Number(book.chapter) || 0))
    let total = 0
    let before = 0
    if (chapters.length) {
      for (let i = 0; i < chapters.length; i += 1) {
        total += Number(chapters[i].duration) || 0
        if (i < index) before += Number(chapters[i].duration) || 0
      }
    }
    if (!total) total = Number(book.duration) || 0
    if (!total) return 0
    return Math.max(0, Math.min(100, ((before + (Number(book.position) || 0)) / total) * 100))
  }

  function shelfView() {
    const sections = state.shelves.map((shelf, shelfIndex) => {
      const cards = shelf.books.map((book, index) => {
        const coverView = state.arranging
          ? `<button class="book-link book-link--arrange" type="button" data-arrange-book="${book.id}" aria-label="Edit ${esc(book.title)}">${cover(book)}</button>`
          : `<a class="book-link" href="/book/${book.id}" data-link aria-label="${esc(book.title)}">${cover(book)}</a>`
        return `<article class="book${state.arranging ? ' book--arranging' : ''}" data-book-id="${book.id}">
        ${coverView}
        <div class="book-progress" aria-hidden="true"><span style="width:${bookPercent(book)}%"></span></div>
        <p class="book-title">${esc(book.title)}</p>
        <p class="book-author">${esc(book.authors.join(', ') || 'Unknown author')}</p>
        <p class="micro">${esc([book.durationLabel, book.sequence ? `Book ${book.sequence}` : ''].filter(Boolean).join(' · '))}</p>
        ${state.arranging && (index > 0 || index < shelf.books.length - 1) ? `<div class="arrange-row">
          ${index > 0 ? `<button type="button" data-move-book data-shelf-key="${esc(shelf.key)}" data-book-id="${book.id}" data-dir="-1" aria-label="Move ${esc(book.title)} left">←</button>` : ''}
          ${index < shelf.books.length - 1 ? `<button type="button" data-move-book data-shelf-key="${esc(shelf.key)}" data-book-id="${book.id}" data-dir="1" aria-label="Move ${esc(book.title)} right">→</button>` : ''}
        </div>` : ''}
      </article>`
      }).join('')
      return `<section class="shelf" data-shelf-key="${esc(shelf.key)}">
        <header class="shelf-head">
          <div class="shelf-title-row">
            <h2>${esc(shelf.name)}</h2>
            ${state.arranging ? `<button class="shelf-edit" type="button" data-edit-shelf="${esc(shelf.key)}" data-edit-name="${esc(shelf.name)}" data-edit-count="${shelf.books.length}">Edit</button>` : ''}
          </div>
          <div class="shelf-actions">
            ${state.arranging && shelfIndex > 0 ? `<button class="arrange-button" type="button" data-move-shelf="${esc(shelf.key)}" data-dir="-1" aria-label="Move ${esc(shelf.name)} up">↑</button>` : ''}
            ${state.arranging && shelfIndex < state.shelves.length - 1 ? `<button class="arrange-button" type="button" data-move-shelf="${esc(shelf.key)}" data-dir="1" aria-label="Move ${esc(shelf.name)} down">↓</button>` : ''}
            <p class="micro">${shelf.books.length} ${shelf.books.length === 1 ? 'book' : 'books'}</p>
          </div>
        </header>
        ${cards ? `<div class="rail">${cards}</div>` : '<p class="shelf-empty">No books on this shelf yet. Use Arrange to move one here.</p>'}
      </section>`
    }).join('')
    app.innerHTML = `${topBar()}<main class="shelf-main">
      <div class="shelf-page-head">
        <a class="back" href="/" data-link>← Home</a>
        <h1>Your shelf</h1>
        <div class="shelf-summary">
          <p class="micro">${state.books.length} ${state.books.length === 1 ? 'book' : 'books'} · ${state.shelves.length} ${state.shelves.length === 1 ? 'shelf' : 'shelves'}</p>
          <div class="shelf-summary-actions">
            ${state.arranging ? '<button class="text-action" type="button" data-new-shelf>New shelf</button>' : ''}
            <button class="text-action" type="button" data-arrange>${state.arranging ? 'Done' : 'Arrange'}</button>
          </div>
        </div>
      </div>
      ${sections || `<div class="empty"><p class="micro">No shelves</p><h1>Create your first shelf.</h1></div>`}
    </main>`
    for (const button of app.querySelectorAll('[data-edit-shelf]')) {
      button.addEventListener('click', () => openShelfEditor(button.dataset.editShelf, button.dataset.editName, Number(button.dataset.editCount) || 0))
    }
    app.querySelector('[data-new-shelf]')?.addEventListener('click', openNewShelf)
    app.querySelector('[data-arrange]')?.addEventListener('click', () => {
      state.arranging = !state.arranging
      shelfView()
    })
    for (const button of app.querySelectorAll('[data-arrange-book]')) {
      button.addEventListener('click', () => {
        const book = bookById(button.dataset.arrangeBook)
        if (book) openBookEditor(book)
      })
    }
    for (const button of app.querySelectorAll('[data-move-shelf]')) {
      button.addEventListener('click', () => moveShelf(button.dataset.moveShelf, Number(button.dataset.dir)))
    }
    for (const button of app.querySelectorAll('[data-move-book]')) {
      button.addEventListener('click', () => moveBook(button.dataset.shelfKey, button.dataset.bookId, Number(button.dataset.dir)))
    }
    for (const card of app.querySelectorAll('.book[data-book-id]')) {
      card.addEventListener('click', (event) => {
        if (event.target.closest('a, button')) return
        const book = bookById(card.dataset.bookId)
        if (!book) return
        if (state.arranging) openBookEditor(book)
        else navigate(`/book/${book.id}`)
      })
    }
  }

  function bookView(book) {
    state.routeBook = book
    const chapters = book.chapters.length
      ? `<ol class="chapters">${book.chapters.map((chapter, index) => `<li>
          <button type="button" class="chapter" data-chapter-index="${index}">
            <span class="chapter-no">${String(index + 1).padStart(2, '0')}</span>
            <span class="chapter-name">${esc(chapter.title)}</span>
            <span class="chapter-time">${clock(chapter.start / 1000)}</span>
          </button>
        </li>`).join('')}</ol>`
      : `<p class="muted">No chapters.</p>`
    app.innerHTML = `${topBar()}<main class="book-main">
      <a class="back" href="/shelf" data-link>← Your shelf</a>
      <div class="book-layout">
        <div class="book-cover">${cover(book)}</div>
        <div class="book-detail">
          <p class="micro">${esc(book.shelf)}${book.sequence ? ` · Book ${esc(book.sequence)}` : ''}</p>
          <h1>${esc(book.title)}</h1>
          <p class="byline">${esc(book.authors.join(', ') || 'Unknown author')}${book.narrator ? ` · read by ${esc(book.narrator)}` : ''}</p>
          ${book.description ? `<p class="description">${esc(book.description)}</p>` : ''}
          <section class="chapter-section">
            <div class="shelf-head"><h2>Chapters</h2><p class="micro">${book.chapters.length || 0}</p></div>
            ${chapters}
          </section>
        </div>
      </div>
    </main>`
    bindBook()
    if (!state.audioBook) {
      prepareAudio(book, { restore: true }).then(() => {
        if (state.audioBook?.id === book.id) {
          buildMini()
          syncMini()
        }
      })
    }
  }

  function playView(book, params) {
    state.routeBook = book
    const chapterParam = Number(params.get('chapter'))
    const fromChapterClick = state.autoplayNext
    const saved = savedProgress(book)
    let target = fromChapterClick && Number.isInteger(chapterParam) && chapterParam > 0
      ? chapterParam - 1
      : saved.chapter
    target = Math.max(0, Math.min((book.chapters.length || 1) - 1, target))
    const chapter = book.chapters[target] || null
    const chapterTitle = chapter?.title || book.title
    const chapterLine = book.chapters.length
      ? `Chapter ${target + 1} of ${book.chapters.length}`
      : book.title
    app.innerHTML = `<main class="play-page">
      <header class="play-top">
        <a class="icon-button" href="/book/${book.id}" data-link aria-label="Back to book">${iconBack}</a>
        <p class="micro">Now playing</p>
        <span class="play-top-spacer" aria-hidden="true"></span>
      </header>
      <div class="play-content">
        <div class="play-stage" data-play-stage role="button" tabindex="0" aria-label="Show book description">
          <div class="play-cover-view" data-play-cover>
            <div class="play-cover">${cover(book)}</div>
            <div class="play-meta">
              <h1 class="play-title" id="play-title">${esc(chapterTitle)}</h1>
            </div>
          </div>
          <div class="play-description-view" data-play-description aria-hidden="true">
            <p class="micro">From the book</p>
            <h1 class="play-title">${esc(book.title)}</h1>
            <p class="play-description-author">${esc(book.authors.join(', ') || 'Unknown author')}</p>
            <p class="play-description-text">${esc(book.description || 'No description for this book.')}</p>
            <p class="micro">Tap to return to the cover</p>
          </div>
        </div>
        <button class="micro chapter-list-button" id="play-micro" type="button" data-open-chapters aria-label="Open chapter list">${esc(chapterLine)}</button>
        <div class="play-timeline">
          <div class="seek-wrap">
            <div class="seek-track" aria-hidden="true"><div class="seek-fill" id="play-seek-fill"></div></div>
            <input id="play-seek" class="seek" type="range" min="0" max="1" step="1" value="0" aria-label="Seek">
          </div>
          <div class="timeline-times"><span id="play-current">0:00</span><span id="play-duration"></span></div>
        </div>
        <div class="play-controls">
          <button class="transport" type="button" data-seek="-1" aria-label="Back 15 seconds, hold for previous chapter">${iconSeek(-1)}</button>
          <button class="transport play-toggle" type="button" data-toggle-play aria-label="Play">${iconPlay}</button>
          <button class="transport" type="button" data-seek="1" aria-label="Forward 15 seconds, hold for next chapter">${iconSeek(1)}</button>
        </div>
      </div>
    </main>`
    buildChapterDialog(book)
    bindPlay()
    prepareAudio(book, {
      chapterIndex: target,
      restore: !fromChapterClick,
      autoplay: fromChapterClick,
    }).then(() => {
      if (state.audioBook?.id === book.id) {
        state.autoplayNext = false
        syncMini()
        updateUI()
      }
    })
    syncMini()
    updateUI()
  }

  function bindBook() {
    for (const button of document.querySelectorAll('[data-chapter-index]')) {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.chapterIndex)
        const book = state.routeBook
        if (!book) return
        state.autoplayNext = true
        if (state.audioBook?.id === book.id) {
          prepareAudio(book, { chapterIndex: index, restore: false, autoplay: true })
        }
        navigate(`/play/${book.id}?chapter=${index + 1}`)
      })
    }
  }

  function openBookEditor(book) {
    if (!bookDialog) return
    const shelves = state.shelves.length ? state.shelves : [{ key: book.shelfKey, name: book.shelf }]
    const options = shelves.map((shelf) => `<option value="${esc(shelf.key)}"${shelf.key === book.shelfKey ? ' selected' : ''}>${esc(shelf.name)}</option>`).join('')
    bookDialog.innerHTML = `<header class="dialog-head">
      <h2>Edit book</h2>
      <button class="link-button" type="button" data-close-book>Close</button>
    </header>
    <form class="book-form">
      <div class="book-form-grid">
        <label>Title<input name="title" value="${esc(book.title)}" maxlength="240" required></label>
        <label>Authors<input name="authors" value="${esc(book.authors.join(', '))}" placeholder="Comma separated"></label>
        <label>Narrators<input name="narrators" value="${esc(book.narrator || '')}" placeholder="Comma separated"></label>
        <label>Series<input name="series_title" value="${esc(book.series || '')}" placeholder="Standalone if empty"></label>
        <label>Sequence<input name="series_sequence" value="${esc(book.sequence || '')}" inputmode="decimal"></label>
        <label>Shelf<select name="shelfKey">${options}</select></label>
      </div>
      <label>Description<textarea name="description" rows="5">${esc(book.description || '')}</textarea></label>
      <p class="micro">Series controls the cover. Shelf controls where the book sits.</p>
      <div class="actions"><button class="primary" type="submit">Save book</button></div>
    </form>`
    bookDialog.querySelector('[data-close-book]')?.addEventListener('click', () => bookDialog.close())
    bookDialog.querySelector('form')?.addEventListener('submit', (event) => saveBook(event, book, bookDialog))
    bookDialog.showModal()
    bookDialog.querySelector('input[name="title"]')?.focus()
  }

  async function saveBook(event, book, editor) {
    event.preventDefault()
    const form = event.currentTarget
    const button = form.querySelector('button[type="submit"]')
    if (!button) return
    button.disabled = true
    try {
      const response = await fetch(`/api/books/${book.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form)),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      editor.close()
      await loadLibrary(true)
      if (mini) mini.dataset.book = ''
      renderRoute()
    } catch {
      button.disabled = false
    }
  }

  function openNewShelf() {
    const editor = document.getElementById('shelf-edit-dialog')
    if (!editor) return
    editor.innerHTML = `<header class="dialog-head">
      <h2>New shelf</h2>
      <button class="link-button" type="button" data-close-shelf>Close</button>
    </header>
    <form class="shelf-form">
      <label class="sr-only" for="new-shelf-name">Shelf name</label>
      <input id="new-shelf-name" name="name" maxlength="80" placeholder="Shelf name" required>
      <p class="micro">Creates an empty shelf. Move books into it from Arrange mode.</p>
      <div class="actions"><button class="primary" type="submit">Create shelf</button></div>
    </form>`
    editor.querySelector('[data-close-shelf]')?.addEventListener('click', () => editor.close())
    editor.addEventListener('click', (event) => {
      if (event.target === editor) editor.close()
    }, { once: true })
    editor.querySelector('form')?.addEventListener('submit', async (event) => {
      event.preventDefault()
      const form = event.currentTarget
      const button = form.querySelector('button[type="submit"]')
      button.disabled = true
      try {
        const response = await fetch('/api/shelves', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(new FormData(form)),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        editor.close()
        await loadLibrary(true)
        renderRoute()
      } catch {
        button.disabled = false
      }
    })
    editor.showModal()
    editor.querySelector('input')?.focus()
  }

  function captureRects(selector, key) {
    const rects = new Map()
    for (const element of app.querySelectorAll(selector)) {
      const value = element.dataset[key]
      if (value) rects.set(value, element.getBoundingClientRect())
    }
    return rects
  }

  function animateRects(selector, key, before) {
    for (const element of app.querySelectorAll(selector)) {
      const old = before.get(element.dataset[key])
      if (!old) continue
      const now = element.getBoundingClientRect()
      const dx = old.left - now.left
      const dy = old.top - now.top
      if (!dx && !dy) continue
      element.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 240, easing: 'cubic-bezier(.2, .7, .2, 1)' },
      )
    }
  }

  async function saveLayout({ render = true } = {}) {
    const shelves = state.shelves.map((shelf) => shelf.key)
    const books = Object.fromEntries(state.shelves.map((shelf) => [shelf.key, shelf.books.map((book) => book.id)]))
    const response = await fetch('/api/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ shelves: JSON.stringify(shelves), books: JSON.stringify(books) }),
    }).catch(() => null)
    if (!response?.ok) {
      await loadLibrary(true)
      shelfView()
      return
    }
    state.data = await response.json()
    state.books = state.data.books || []
    state.shelves = state.data.shelves || []
    state.stats = state.data.stats || state.stats
    if (render) shelfView()
  }

  function moveShelf(key, direction) {
    const index = state.shelves.findIndex((shelf) => shelf.key === key)
    const target = index + direction
    if (index < 0 || target < 0 || target >= state.shelves.length) return
    const before = captureRects('.shelf[data-shelf-key]', 'shelfKey')
    ;[state.shelves[index], state.shelves[target]] = [state.shelves[target], state.shelves[index]]
    shelfView()
    requestAnimationFrame(() => animateRects('.shelf[data-shelf-key]', 'shelfKey', before))
    saveLayout({ render: false })
  }

  function moveBook(shelfKey, bookId, direction) {
    const shelf = state.shelves.find((entry) => entry.key === shelfKey)
    if (!shelf) return
    const index = shelf.books.findIndex((book) => book.id === bookId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= shelf.books.length) return
    const before = captureRects('.book[data-book-id]', 'bookId')
    ;[shelf.books[index], shelf.books[target]] = [shelf.books[target], shelf.books[index]]
    shelfView()
    requestAnimationFrame(() => animateRects('.book[data-book-id]', 'bookId', before))
    saveLayout({ render: false })
  }

  function openShelfEditor(key, name, count) {
    const editor = document.getElementById('shelf-edit-dialog')
    if (!editor) return
    editor.innerHTML = `<header class="dialog-head">
      <h2>Edit shelf</h2>
      <button class="link-button" type="button" data-close-shelf>Close</button>
    </header>
    <form class="shelf-form" method="post" action="/api/series">
      <label class="sr-only" for="shelf-name">Shelf name</label>
      <input id="shelf-name" name="name" value="${esc(name)}" maxlength="80" required>
      <p class="micro">Changes the shelf label only. Book covers keep their series title.</p>
      <div class="actions"><button class="primary" type="submit">Save shelf</button></div>
    </form>`
    editor.querySelector('[data-close-shelf]')?.addEventListener('click', () => editor.close())
    editor.addEventListener('click', (event) => {
      if (event.target === editor) editor.close()
    }, { once: true })
    editor.querySelector('form')?.addEventListener('submit', (event) => saveShelf(event, key, editor))
    editor.showModal()
    editor.querySelector('input')?.focus()
    editor.querySelector('input')?.select()
  }

  async function saveShelf(event, shelfKey, editor) {
    event.preventDefault()
    const form = event.currentTarget
    const input = form.querySelector('input[name="name"]')
    const button = form.querySelector('button[type="submit"]')
    if (!input || !button) return
    button.disabled = true
    try {
      const response = await fetch('/api/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ old: shelfKey, name: input.value.trim() }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      editor.close()
      await loadLibrary(true)
      if (mini) mini.dataset.book = ''
      renderRoute()
    } catch {
      button.disabled = false
    }
  }

  function bindPlay() {
    const stage = document.querySelector('[data-play-stage]')
    if (stage) {
      const toggleStage = () => {
        const coverView = stage.querySelector('[data-play-cover]')
        const descriptionView = stage.querySelector('[data-play-description]')
        if (!coverView || !descriptionView) return
        const showDescription = !stage.classList.contains('show-description')
        stage.classList.toggle('show-description', showDescription)
        coverView.setAttribute('aria-hidden', showDescription ? 'true' : 'false')
        descriptionView.setAttribute('aria-hidden', showDescription ? 'false' : 'true')
        stage.setAttribute('aria-label', showDescription ? 'Show cover' : 'Show book description')
      }
      stage.addEventListener('click', () => toggleStage())
      stage.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        toggleStage()
      })
    }
    const seek = document.getElementById('play-seek')
    if (seek) {
      seek.addEventListener('pointerdown', () => { state.seeking = true })
      seek.addEventListener('pointerup', () => { state.seeking = false })
      seek.addEventListener('change', () => { state.seeking = false })
      seek.addEventListener('input', () => {
        state.seeking = true
        clearTimeout(state.seekTimer)
        state.seekTimer = setTimeout(() => { state.seeking = false }, 900)
        try {
          if (Number.isFinite(Number(seek.value))) audio.currentTime = Number(seek.value)
        } catch {}
        updateUI()
      })
    }
    for (const button of document.querySelectorAll('[data-open-chapters]')) {
      button.addEventListener('click', openChapters)
    }
    bindTransport(document)
    updateUI()
  }

  function buildChapterDialog(book) {
    if (!dialog) return
    dialog.innerHTML = `<header class="dialog-head">
      <h2>Chapters</h2>
    </header>
    <div class="dialog-list">${book.chapters.map((chapter, index) => `<button class="dialog-chapter" type="button" data-chapter-index="${index}">
      <span class="micro">${String(index + 1).padStart(2, '0')}</span>
      <span>${esc(chapter.title)}</span>
      <span class="micro">${clock(chapter.start / 1000)}</span>
    </button>`).join('')}</div>`
  }

  function openChapters() {
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    requestAnimationFrame(() => {
      const current = dialog.querySelector('[aria-current="true"]')
      if (!current) return
      const previous = current.previousElementSibling
      ;(previous || current).scrollIntoView({ block: 'start' })
    })
  }

  function bindTransport(root) {
    for (const button of root.querySelectorAll('[data-toggle-play]')) {
      if (boundTransport.has(button)) continue
      boundTransport.add(button)
      button.addEventListener('click', togglePlay)
    }
    for (const button of root.querySelectorAll('[data-seek]')) {
      if (boundTransport.has(button)) continue
      boundTransport.add(button)
      bindHold(button, Number(button.dataset.seek))
    }
    for (const button of root.querySelectorAll('[data-chapter-index]')) {
      if (!button.closest('.chapters') && !button.closest('.dialog-chapter')) continue
      if (boundTransport.has(button)) continue
      boundTransport.add(button)
      button.addEventListener('click', () => {
        const index = Number(button.dataset.chapterIndex)
        if (!Number.isFinite(index)) return
        const book = state.audioBook || state.routeBook
        if (!book) return
        setChapter(book, index, true)
        if (dialog?.open) dialog.close()
      })
    }
    updatePlayIcons()
  }

  function bindHold(button, direction) {
    let timer = null
    let fired = false
    const clear = () => { if (timer) clearTimeout(timer); timer = null }
    const start = (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      try { button.setPointerCapture(event.pointerId) } catch {}
      clear()
      fired = false
      timer = setTimeout(() => {
        fired = true
        jumpChapter(direction)
      }, 550)
    }
    const end = () => {
      clear()
      if (!fired) skip(direction * 15)
    }
    const cancel = () => { clear() }
    button.addEventListener('pointerdown', start)
    button.addEventListener('pointerup', end)
    button.addEventListener('pointercancel', cancel)
    button.addEventListener('pointerleave', (event) => { if (event.pointerType === 'mouse') cancel() })
    button.addEventListener('contextmenu', (event) => event.preventDefault())
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        skip(direction * 15)
      }
    })
  }

  function chapterFor(book, index) {
    if (!book?.chapters?.length) return null
    return book.chapters[Math.max(0, Math.min(book.chapters.length - 1, index))] || null
  }

  function audioUrl(book, index) {
    if (book.audioMode === 'chapters') {
      const chapter = chapterFor(book, index)
      return `/audio/${book.id}/${index}?v=${chapter?.fileVersion || 0}`
    }
    return `/audio/${book.id}?v=${book.audioVersion || 0}`
  }

  function absoluteToProgress(book, seconds) {
    if (book.audioMode !== 'chapters' || !book.chapters.length) {
      return { chapter: 0, position: Math.max(0, seconds), updated: 0 }
    }
    const ms = Math.max(0, seconds) * 1000
    let index = 0
    for (let i = 0; i < book.chapters.length; i += 1) {
      if (ms >= (book.chapters[i].start || 0)) index = i
      else break
    }
    const chapter = book.chapters[index]
    return {
      chapter: index,
      position: Math.max(0, seconds - (chapter.start || 0) / 1000),
      updated: 0,
    }
  }

  function localProgress(book) {
    try {
      const raw = localStorage.getItem(`shelf:pos:${book.id}`)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && Number.isFinite(Number(parsed.position))) {
          const position = Number(parsed.position)
          const legacyRaw = localStorage.getItem(`shelf:position:${book.id}`)
          const legacy = legacyRaw && Number.isFinite(Number(legacyRaw)) ? Number(legacyRaw) : 0
          if (position === 0 && legacy > 0) return absoluteToProgress(book, legacy)
          if (Number.isFinite(Number(parsed.chapter))) {
            return {
              chapter: Number(parsed.chapter),
              position,
              updated: Number(parsed.updated) || 0,
            }
          }
          return { ...absoluteToProgress(book, position), updated: Number(parsed.updated) || 0 }
        }
        if (typeof parsed === 'number') return absoluteToProgress(book, parsed)
      }
      const legacyRaw = localStorage.getItem(`shelf:position:${book.id}`)
      if (legacyRaw && Number.isFinite(Number(legacyRaw))) return absoluteToProgress(book, Number(legacyRaw))
    } catch {}
    return null
  }

  function savedProgress(book) {
    const local = localProgress(book)
    const server = {
      chapter: Math.max(0, Number(book.chapter) || 0),
      position: Math.max(0, Number(book.position) || 0),
      updated: Number(book.positionUpdated) || 0,
    }
    if (!local) return server
    if (local.position > 0 && server.position === 0) return local
    if (!server.updated) return local
    return local.updated >= server.updated ? local : server
  }

  function prepareAudio(book, { restore = false, chapterIndex = null, autoplay = false, position = null } = {}) {
    if (!book) return Promise.resolve()
    const saved = savedProgress(book)
    let target = chapterIndex
    if (target === null || target === undefined) {
      if (state.audioBook?.id === book.id) target = state.audioChapter
      else target = restore ? saved.chapter : 0
    }
    target = Math.max(0, Math.min((book.chapters.length || 1) - 1, target))
    const chapter = chapterFor(book, target)
    const sameBook = state.audioBook?.id === book.id
    const sameChapter = sameBook && state.audioChapter === target && audio.dataset.chapter === String(target)
    if (sameChapter) {
      if (audio.readyState >= 1) state.progressReady = true
      if (position !== null) {
        try { audio.currentTime = position } catch {}
      }
      if (autoplay) play()
      updateUI()
      updateChapterLabels()
      buildMini()
      syncMini()
      return Promise.resolve()
    }

    savePosition()
    state.audioBook = book
    state.audioChapter = target
    state.progressReady = false
    try { localStorage.setItem('shelf:last', book.id) } catch {}
    audio.pause()
    audio.dataset.book = book.id
    audio.dataset.chapter = String(target)
    const ready = new Promise((resolve) => {
      const finish = () => {
        audio.removeEventListener('loadedmetadata', finish)
        audio.removeEventListener('error', finish)
        clearTimeout(timeout)
        resolve()
      }
      const timeout = setTimeout(finish, 8000)
      audio.addEventListener('loadedmetadata', finish, { once: true })
      audio.addEventListener('error', finish, { once: true })
    })
    audio.src = audioUrl(book, target)
    audio.load()
    buildMini()
    syncMini()
    updateUI()
    updateChapterLabels()
    return ready.then(() => {
      if (state.audioBook?.id !== book.id || state.audioChapter !== target) return
      let seekTo = position
      if (seekTo === null && restore && saved.chapter === target) seekTo = saved.position
      const duration = Number.isFinite(audio.duration) ? audio.duration : chapter?.duration || 0
      if (seekTo && seekTo > 0 && (!duration || seekTo < duration - 1)) {
        try { audio.currentTime = seekTo } catch {}
      }
      state.progressReady = true
      buildMini()
      syncMini()
      updateUI()
      updateChapterLabels()
      savePosition()
      if (autoplay) play()
    })
  }

  function sendListening(seconds, beacon = false) {
    if (!Number.isFinite(seconds) || seconds <= 0) return
    const body = new URLSearchParams({ seconds: String(Math.round(seconds * 10) / 10) })
    if (beacon && navigator.sendBeacon) {
      try {
        if (navigator.sendBeacon('/api/listen', body)) return
      } catch {}
    }
    fetch('/api/listen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      keepalive: beacon,
    }).then((response) => response.ok ? response.json() : null).then((stats) => {
      if (stats) {
        state.stats = stats
        updateStatsBanner()
      }
    }).catch(() => {})
  }

  function flushListening({ beacon = false } = {}) {
    if (!state.listenSince) return
    const now = Date.now()
    const seconds = (now - state.listenSince) / 1000
    state.listenSince = audio.paused ? 0 : now
    if (seconds < 1) return
    addLocalListening(seconds)
    sendListening(seconds, beacon)
  }

  function savePosition({ beacon = false } = {}) {
    const book = state.audioBook
    if (!book || !state.progressReady || audio.readyState < 1 || !Number.isFinite(audio.currentTime)) return
    const position = Math.max(0, audio.currentTime)
    const updated = Date.now()
    try {
      localStorage.setItem(`shelf:pos:${book.id}`, JSON.stringify({
        chapter: state.audioChapter,
        position,
        updated,
      }))
      localStorage.removeItem(`shelf:position:${book.id}`)
    } catch {}
    book.chapter = state.audioChapter
    book.position = position
    book.positionUpdated = updated
    if (beacon) {
      sendProgress(book, position, updated, true)
      state.lastServerSave = updated
    } else if (updated - state.lastServerSave > 5000) {
      state.lastServerSave = updated
      sendProgress(book, position, updated, false)
    }
  }

  function sendProgress(book, position, updated, beacon) {
    const url = `/api/progress/${book.id}`
    const body = new URLSearchParams({
      chapter: String(state.audioChapter),
      position: String(position),
      updated: String(updated),
    })
    if (beacon && navigator.sendBeacon) {
      try {
        if (navigator.sendBeacon(url, body)) return
      } catch {}
    }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      keepalive: beacon,
    }).catch(() => {})
  }

  function setChapter(book, index, playNow = false) {
    if (!book?.chapters?.length) return
    const target = Math.max(0, Math.min(book.chapters.length - 1, index))
    if (state.audioBook?.id === book.id && state.audioChapter === target) {
      try { audio.currentTime = 0 } catch {}
      state.progressReady = true
      savePosition()
      if (playNow) play()
      updateUI()
      updateChapterLabels()
      return
    }
    prepareAudio(book, { chapterIndex: target, restore: false, autoplay: playNow, position: 0 })
  }

  function jumpChapter(direction) {
    const book = state.audioBook
    if (book?.audioMode !== 'chapters' || !book.chapters.length) return
    const target = Math.max(0, Math.min(book.chapters.length - 1, state.audioChapter + direction))
    setChapter(book, target, !audio.paused)
  }

  function skip(seconds) {
    if (!Number.isFinite(audio.duration)) return
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds))
    updateUI()
  }

  function togglePlay() {
    if (!state.audioBook) return
    if (audio.paused) play()
    else audio.pause()
  }

  async function play() {
    if (audio.readyState >= 1) state.progressReady = true
    try { await audio.play() } catch {}
    updateUI()
  }

  function updateChapterLabels() {
    const book = state.audioBook
    if (!book) return
    const chapter = chapterFor(book, state.audioChapter)
    const title = document.getElementById('play-title')
    const micro = document.getElementById('play-micro')
    if (title) title.textContent = chapter?.title || book.title
    if (micro) micro.textContent = book.chapters.length
      ? `Chapter ${state.audioChapter + 1} of ${book.chapters.length}`
      : book.title
  }

  function updatePlayIcons() {
    const icon = audio.paused ? iconPlay : iconPause
    for (const button of document.querySelectorAll('[data-toggle-play]')) {
      button.innerHTML = icon
      button.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause')
    }
  }

  function updateUI() {
    const chapter = state.audioBook?.chapters?.[state.audioChapter]
    const duration = Number.isFinite(audio.duration) ? audio.duration : chapter?.duration || state.audioBook?.duration || 0
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0
    const seek = document.getElementById('play-seek')
    if (seek) {
      seek.max = String(Math.max(1, duration || 1))
      if (!state.seeking) seek.value = String(current)
    }
    const currentEl = document.getElementById('play-current')
    const durationEl = document.getElementById('play-duration')
    if (currentEl) currentEl.textContent = clock(current)
    if (durationEl) durationEl.textContent = clock(duration)
    const seekFill = document.getElementById('play-seek-fill')
    if (seekFill) seekFill.style.width = duration ? `${Math.min(100, (current / duration) * 100)}%` : '0%'
    const miniFill = document.getElementById('mini-fill')
    if (miniFill) miniFill.style.width = duration ? `${Math.min(100, (current / duration) * 100)}%` : '0%'
    const miniTime = document.getElementById('mini-time')
    if (miniTime) miniTime.textContent = clock(current)
    updatePlayIcons()
    updateChapterCurrent()
    document.body.classList.toggle('has-mini', !location.pathname.startsWith('/play/'))
  }

  function updateChapterCurrent() {
    const book = state.audioBook
    if (!book) return
    const index = state.audioChapter
    for (const button of document.querySelectorAll('[data-chapter-index]')) {
      const active = Number(button.dataset.chapterIndex) === index
      if (button.classList.contains('dialog-chapter')) {
        if (active) button.setAttribute('aria-current', 'true')
        else button.removeAttribute('aria-current')
      }
    }
  }

  function buildMini() {
    const book = state.audioBook
    if (!mini) return
    if (!book) {
      if (mini.dataset.book === 'empty') return
      mini.dataset.book = 'empty'
      mini.innerHTML = `<div class="mini-progress-track"><div class="mini-progress-fill" id="mini-fill"></div></div>
        <a class="mini-empty" href="/shelf" data-link>
          <span class="mini-empty-copy">
            <span class="mini-title">Nothing playing</span>
            <span class="mini-sub">${location.pathname === '/shelf' ? 'Choose a book above' : 'Open your shelf'}</span>
          </span>
          <span class="mini-empty-arrow" aria-hidden="true">→</span>
        </a>`
      return
    }
    const key = `${book.id}:${state.audioChapter}`
    if (mini.dataset.book === key) return
    const chapter = chapterFor(book, state.audioChapter)
    mini.dataset.book = key
    mini.innerHTML = `<div class="mini-progress-track"><div class="mini-progress-fill" id="mini-fill"></div></div>
      <a class="mini-progress-hit" href="/play/${book.id}" data-link aria-label="Open player"></a>
      <div class="mini-inner">
        <div class="mini-cover${book.coverUrl ? ' mini-cover--image' : ''}" style="--ribbon:${esc(book.ribbon)}">
          ${book.coverUrl ? `<img src="${esc(book.coverUrl)}" alt="">` : ''}
        </div>
        <a class="mini-copy" href="/play/${book.id}" data-link title="Open player">
          <div class="mini-title">${esc(chapter?.title || book.title)}</div>
          <div class="mini-sub">${esc(book.title)} · <span id="mini-time">0:00</span></div>
        </a>
        <div class="mini-controls">
          <button class="icon-button" type="button" data-seek="-1" aria-label="Back 15 seconds, hold for previous chapter">${iconSeek(-1)}</button>
          <button class="icon-button mini-pause" type="button" data-toggle-play aria-label="Play">${iconPlay}</button>
          <button class="icon-button" type="button" data-seek="1" aria-label="Forward 15 seconds, hold for next chapter">${iconSeek(1)}</button>
          <a class="icon-button mini-open" href="/play/${book.id}" data-link aria-label="Open player" title="Open player">${iconChevron}</a>
        </div>
      </div>`
    bindTransport(mini)
    updateUI()
  }

  function syncMini() {
    const show = !location.pathname.startsWith('/play/')
    if (mini) {
      if (show && !state.audioBook) buildMini()
      mini.hidden = !show
    }
    document.body.classList.toggle('has-mini', show)
  }

  function navigate(path, { replace = false } = {}) {
    if (replace) history.replaceState({}, '', path)
    else history.pushState({}, '', path)
    renderRoute()
  }

  async function renderRoute() {
    if (dialog?.open) dialog.close()
    const shelfDialog = document.getElementById('shelf-edit-dialog')
    if (shelfDialog?.open) shelfDialog.close()
    if (bookDialog?.open) bookDialog.close()
    const renderId = ++state.renderId
    await loadLibrary()
    if (renderId !== state.renderId) return
    if (!booted) {
      booted = true
      const delay = 500 - (Date.now() - bootAt)
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
      if (renderId !== state.renderId) return
    }
    if (state.audioBook) {
      const refreshed = bookById(state.audioBook.id)
      if (refreshed) {
        if (mini && (refreshed.shelf !== state.audioBook.shelf || refreshed.title !== state.audioBook.title)) {
          mini.dataset.book = ''
        }
        state.audioBook = refreshed
      }
    }
    const path = location.pathname
    const params = new URLSearchParams(location.search)
    const playMatch = path.match(/^\/play\/([a-f0-9]{12})\/?$/)
    const bookMatch = path.match(/^\/book\/([a-f0-9]{12})\/?$/)
    if (path === '/' || path === '') {
      homeView()
      if (!state.audioBook) {
        let lastId = ''
        try { lastId = localStorage.getItem('shelf:last') || '' } catch {}
        const last = bookById(lastId)
        if (last) prepareAudio(last, { restore: true }).then(() => { buildMini(); syncMini(); updateUI() })
      }
    } else if (path === '/shelf') {
      shelfView()
      if (!state.audioBook) {
        let lastId = ''
        try { lastId = localStorage.getItem('shelf:last') || '' } catch {}
        const last = bookById(lastId)
        if (last) prepareAudio(last, { restore: true }).then(() => { buildMini(); syncMini(); updateUI() })
      }
    } else if (bookMatch) {
      const book = bookById(bookMatch[1])
      if (!book) return notFound()
      bookView(book)
    } else if (playMatch) {
      const book = bookById(playMatch[1])
      if (!book) return notFound()
      playView(book, params)
    } else {
      return notFound()
    }
    buildMini()
    syncMini()
    updateUI()
    window.scrollTo(0, 0)
  }

  function handleLink(event) {
    const anchor = event.target.closest('a[href]')
    if (!anchor) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (anchor.target || anchor.hasAttribute('download')) return
    const url = new URL(anchor.href, location.href)
    if (url.origin !== location.origin) return
    if (url.pathname.startsWith('/static/') || url.pathname.startsWith('/audio/')) return
    event.preventDefault()
    if (url.pathname === location.pathname && url.search === location.search) return
    navigate(`${url.pathname}${url.search}`)
  }

  audio.addEventListener('timeupdate', () => {
    updateUI()
    const now = Date.now()
    if (now - state.saveAt > 2000) {
      state.saveAt = now
      savePosition()
    }
  })
  audio.addEventListener('loadedmetadata', updateUI)
  audio.addEventListener('durationchange', updateUI)
  audio.addEventListener('play', updateUI)
  audio.addEventListener('playing', () => {
    if (!state.listenSince) state.listenSince = Date.now()
    updateUI()
  })
  audio.addEventListener('pause', () => {
    flushListening()
    state.listenSince = 0
    savePosition()
    updateUI()
  })
  audio.addEventListener('ended', () => {
    flushListening()
    state.listenSince = 0
    const book = state.audioBook
    if (book?.audioMode === 'chapters' && state.audioChapter < book.chapters.length - 1) {
      prepareAudio(book, { chapterIndex: state.audioChapter + 1, restore: false, autoplay: true })
      return
    }
    savePosition()
    updateUI()
  })
  window.addEventListener('pagehide', () => {
    flushListening({ beacon: true })
    savePosition({ beacon: true })
  })
  window.addEventListener('beforeunload', () => {
    flushListening()
    savePosition()
  })
  document.addEventListener('freeze', () => {
    flushListening({ beacon: true })
    savePosition({ beacon: true })
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushListening({ beacon: true })
      savePosition({ beacon: true })
    }
  })
  setInterval(() => {
    if (!audio.paused) flushListening()
  }, 15000)
  document.addEventListener('click', handleLink)
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-user-menu]')
    if (trigger) {
      const popover = trigger.parentElement?.querySelector('[data-user-popover]')
      if (popover) {
        const opening = popover.hidden
        popover.hidden = !opening
        trigger.setAttribute('aria-expanded', String(opening))
        if (opening) {
          for (const button of popover.querySelectorAll('[data-theme-choice]')) {
            button.setAttribute('aria-pressed', String(button.dataset.themeChoice === document.documentElement.dataset.theme))
          }
        }
      }
      return
    }
    const choice = event.target.closest('[data-theme-choice]')
    if (choice) {
      window.ClamTheme?.apply(choice.dataset.themeChoice)
      closeUserMenu()
      return
    }
    if (!event.target.closest('[data-user-popover]')) closeUserMenu()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeUserMenu()
  })
  window.addEventListener('popstate', renderRoute)

  if ('mediaSession' in navigator) {
    const updateMedia = () => {
      const book = state.audioBook
      if (!book) return
      try {
        const chapter = chapterFor(book, state.audioChapter)
        navigator.mediaSession.metadata = new MediaMetadata({ title: chapter?.title || book.title, artist: book.authors.join(', '), album: book.title })
        navigator.mediaSession.setActionHandler('play', play)
        navigator.mediaSession.setActionHandler('pause', () => audio.pause())
        navigator.mediaSession.setActionHandler('seekbackward', () => skip(-15))
        navigator.mediaSession.setActionHandler('seekforward', () => skip(15))
        navigator.mediaSession.setActionHandler('previoustrack', () => jumpChapter(-1))
        navigator.mediaSession.setActionHandler('nexttrack', () => jumpChapter(1))
      } catch {}
    }
    audio.addEventListener('play', updateMedia)
    audio.addEventListener('loadedmetadata', updateMedia)
  }

  renderRoute().catch(() => {
    app.innerHTML = `<main class="empty"><p class="micro">Error</p><h1>Could not load the shelf.</h1><p class="muted"><a href="/">Try again</a></p></main>`
  })
})()
