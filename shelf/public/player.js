/* Shelf player: a thin layer over the browser's audio element. */
(() => {
  const audio = document.getElementById('audio')
  const player = document.querySelector('.player')
  const play = document.getElementById('play')
  const seek = document.getElementById('seek')
  const current = document.getElementById('current')
  const duration = document.getElementById('duration')
  if (!audio || !player || !play || !seek) return

  const bookId = player.dataset.book || 'book'
  const positionKey = `shelf:position:${bookId}`
  let dragging = false

  const clock = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${minutes}:${String(secs).padStart(2, '0')}`
  }

  const save = () => {
    if (!Number.isFinite(audio.currentTime)) return
    try {
      localStorage.setItem(positionKey, String(audio.currentTime))
    } catch {}
  }

  const restore = () => {
    let saved = 0
    try {
      saved = Number(localStorage.getItem(positionKey) || 0)
    } catch {}
    if (Number.isFinite(saved) && saved > 3 && (!Number.isFinite(audio.duration) || saved < audio.duration - 5)) {
      audio.currentTime = saved
      current.textContent = clock(saved)
      seek.value = String(saved)
    }
  }

  const paint = () => {
    const total = audio.duration
    if (Number.isFinite(total) && total > 0) {
      seek.max = String(total)
      duration.textContent = clock(total)
    }
    current.textContent = clock(audio.currentTime)
    if (!dragging) seek.value = String(audio.currentTime || 0)
    play.textContent = audio.paused ? 'Play' : 'Pause'
    play.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause')
  }

  play.addEventListener('click', async () => {
    if (audio.paused) {
      try {
        await audio.play()
      } catch {
        play.textContent = 'Play'
      }
    } else {
      audio.pause()
    }
  })

  audio.addEventListener('loadedmetadata', () => {
    restore()
    paint()
  })

  audio.addEventListener('timeupdate', () => {
    paint()
    if (Math.floor(audio.currentTime) % 5 === 0) save()
  })

  audio.addEventListener('play', paint)
  audio.addEventListener('pause', () => {
    save()
    paint()
  })
  audio.addEventListener('ended', () => {
    try { localStorage.removeItem(positionKey) } catch {}
    paint()
  })

  seek.addEventListener('input', () => {
    dragging = true
    current.textContent = clock(Number(seek.value))
  })

  seek.addEventListener('change', () => {
    dragging = false
    if (Number.isFinite(Number(seek.value))) audio.currentTime = Number(seek.value)
    paint()
  })

  for (const button of document.querySelectorAll('.chapter')) {
    button.addEventListener('click', async () => {
      const start = Number(button.dataset.start)
      if (!Number.isFinite(start)) return
      audio.currentTime = start / 1000
      try {
        await audio.play()
      } catch {}
      paint()
    })
  }

  window.addEventListener('pagehide', save)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save()
  })

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: document.querySelector('.book-detail h1')?.textContent || 'Audiobook',
        artist: document.querySelector('.byline')?.textContent || 'Shelf',
      })
      navigator.mediaSession.setActionHandler('play', () => audio.play())
      navigator.mediaSession.setActionHandler('pause', () => audio.pause())
      navigator.mediaSession.setActionHandler('seekbackward', () => { audio.currentTime = Math.max(0, audio.currentTime - 30) })
      navigator.mediaSession.setActionHandler('seekforward', () => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 30) })
    } catch {}
  }

  paint()
})()
