# clam-web

React + Vite + TypeScript + Tailwind client for Clam, running beside the
existing vanilla client until it is accepted.

```
old client   http://berry:13378   shelf/server.mjs
new client   http://berry:13379   clam-web/server/server.mjs
```

The new server proxies the old one; it does not touch the library, progress,
sessions or auth:

```
/__auth/login    JSON wrapper around the old Flowwing form endpoint
/__auth/logout   clears the old session cookie
/__auth/me       decodes the session name for display only
/api/*           proxied to 127.0.0.1:13378
/audio/*         proxied, Range headers preserved
/cover/*         proxied
/*               built React app, SPA fallback
```

## Local development

```bash
pnpm install
pnpm dev            # Vite on 5173, API proxy to 127.0.0.1:13378
```

## Build and run

```bash
pnpm build
CLAM_ORIGIN=http://127.0.0.1:13378 \\
CLAM_WEB_PORT=13379 \\
CLAM_WEB_HOST=127.0.0.1 \\
node server/server.mjs
```

## QA

The old client and the new client were compared at 390 × 844 and 1280 × 900
against the same library. Home, shelf, book, play, login, user menu and chapter
sheet were checked at both sizes; the transport, range seek, hold-to-skip,
theme persistence and logout were exercised in Chromium.

## Deploy (user service, no sudo)

The production copy lives at `/home/eustace/shelf/clam-web`:

```bash
rsync -az --delete dist/ eustace@berry:~/shelf/clam-web/dist/
rsync -az server/ eustace@berry:~/shelf/clam-web/server/
ssh eustace@berry 'systemctl --user daemon-reload'
ssh eustace@berry 'systemctl --user enable --now clam-web.service'
```

Access: `http://berry:13379`. The old client remains at `:13378`.


## Stack status

```
React 19 + Vite 8 + TypeScript + Tailwind 4     follows pi-frame
Hono + Store + fs/D1                            does not yet — this is a client preview
proxy to the old Clam Node service              deliberate during acceptance
```

The preview proves the client and the visual system. It is **not yet a pi-frame app**: the API,
auth and audio still belong to `shelf/server.mjs`. Moving them behind the `Store`/Hono seam is the
teardown step after acceptance; until then the old service must stay up.


## Continuous playback (iOS lock screen)

A split chapter file cannot be advanced by JavaScript while the iPhone screen is locked: the
`ended` event is queued until the app returns to the foreground. The new client therefore plays one
continuous `book.m4b` per book and maps the existing chapter start/end times onto it. The OS media
stack advances through chapter boundaries; JS only updates the chapter label when it resumes.

```bash
# on the Pi, after the split chapters exist
python3 scripts/make_continuous.py --library ~/shelf/library --ffmpeg ~/shelf/bin/ffmpeg
```

The script writes `book.m4b` and `continuous_file` into `metadata.json`. The old client continues to
use the split files; the API exposes `continuousUrl` only as an extra field, so the old client is
unaffected until it is retired.

## PWA, system theme and chapter cache

The new client is a PWA:

```
manifest.webmanifest   standalone, Clam icon, 192/512 + Apple touch icon
sw.js                  app shell, /api/books and /__auth/me network-first
                       cover images and hashed assets cache-first
theme                  default follows prefers-color-scheme; Auto returns to it
chapter cache          IndexedDB, split chapter files, 3 slots, oldest evicted
```

The service worker only registers in a secure context. `http://berry:13379` is
plain HTTP, so the worker is skipped there. Add to Home Screen may still create
a shortcut, but there is no offline shell. To use the installed PWA and the
offline shell, serve the same app through Tailscale HTTPS:

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:13379
# then open https://berry.taild3bc35.ts.net/
```

The HTTPS origin has its own cookies and localStorage, so sign in and choose the
theme once there. The old `:13378` client and the HTTP preview keep working.

### Chapter cache

Each chapter row (Book page and chapter sheet) has a download control. The
first three chapters are stored as split chapter files in IndexedDB; a fourth
download opens a prompt naming the oldest cached chapter before replacing it.
Cached chapters are used only when the browser is offline; online playback still
uses the continuous `book.m4b` so lock-screen chapter advance stays native.

```
key          bookId:chapterIndex
limit        3 chapters, global across the library
source       /audio/:bookId/:chapterIndex (split file)
offline      blob URL via media-src blob:
online       ignored; continuous file remains the playback source
```

The service worker caches `/__auth/me` and `/api/books`, so an app that has been
opened online can boot offline. Progress writes are local while offline; the next
online save catches the server up. Listening-time deltas are not queued.


## Player and cache controls

The current chapter title is accent red in the chapter list, the chapter sheet
and the player title. A red current chapter is the only chapter-list colour; the
number and time stay muted.

The Play header replaces the old `Now playing` label with:

```
Sleep       15 / 30 / 45 minutes, end of chapter, or off
1×          cycles 0.8× · 1× · 1.25× · 1.5×, persisted in clam:speed
```

The sleep timer pauses through the normal player, so it also saves progress.
Its last 20 seconds fade the media element's volume to zero; `End of chapter`
fades the final 20 seconds of the chapter instead. JavaScript timers are
suspended while iOS is locked, so the timer is reliable while the app is running
in the foreground; it is not a substitute for a native sleep timer behind the
lock screen. The fade uses `HTMLMediaElement.volume`; iOS ignores programmatic
element volume on some versions, in which case the pause still happens but the
fade is inaudible.

Media Session exposes previous/next chapter, seek, playback state, chapter
metadata and position. The next/previous handlers call the same `jumpChapter`
as the UI; the lock screen progress is chapter-relative.

The download control is a four-state button:

```
↓     cache
pause / %   downloading; tap to pause
play / %    paused; tap to resume
✓     cached; tap to delete immediately
```

A paused download keeps its reader and chunks in memory and resumes from the
same offset. The cache page at `/cache` groups downloaded chapters by book,
shows their sizes and removes individual entries. The Shelf `Cache` button opens
it beside `Arrange`.


## Chapter transcription

Chapter 10 of *Harry Potter und der Orden des Phönix* is the first transcript
example. The displayed text comes from the German EPUB; only the timeline comes
from speech recognition.

```
subtitles/10.json         EPUB sentences with chapter-relative start/end
metadata.json             chapters[9].subtitle_file = "subtitles/10.json"
/subtitle/:book/:chapter  authenticated JSON route
```

The JSON shape is:

```json
{
  "language": "de",
  "cues": [
    { "start": 6.6, "end": 9.46, "text": "Dumbledores abruptes Verschwinden …" }
  ]
}
```

The generator splits the EPUB into sentences first, aligns EPUB tokens to
Whisper word timestamps, then uses the matched first/last word of each sentence
as its cue. It does not display the Whisper text. Tiny/base ASR is only a
clock; the EPUB is the transcript.

The chapter-10 example currently has 565 sentence rows. Paragraph and dialogue
boundaries are preserved; a single row never contains multiple sentences.

In the transcript, every word is a button. Tapping one opens a small card with
the German wordbook sense and a saved-word star; the card closes itself after
three seconds. Known words use the cached German wordbook (`public/wordbook/`),
and unknown words fall back to `/api/word/translate`. Word taps never seek.

In the Play screen, the `Transcript` / `Cover` button at the left end of the
chapter row switches the stage. Tapping the cover is no longer a control. If
the current chapter has no `subtitleUrl`, the button says `Description` and opens
the existing description placeholder. Cues are chapter-relative so they work with the continuous
`book.m4b`; tapping a cue seeks the player. The service worker caches
`/subtitle/` for offline use.
