# clam-web

React + Vite + TypeScript + Tailwind client for Clam. Production is one Node
server: `shelf/server.mjs` serves the built `dist/` and the API on `:13378`;
Cloudflare Tunnel publishes it at `https://clam.flowwing.uk`.

`server/server.mjs` remains as a development/test proxy only and is not a
production daemon.

## Local development

```bash
pnpm install
pnpm start          # terminal 1: auth/API proxy on 13379; API must run on 13378
pnpm dev            # terminal 2: Vite on 5173; auth/API via 13379, media via 13378
```

The proxy can run without a production build during development. Deploy the API
and PWA together when changing the auth contract. Subtitles are proxied by Vite.

## Build

```bash
pnpm build
```

Production serves `dist/` from `shelf/server.mjs`; `pnpm start` remains useful
only for proxy tests.

## QA

Home, shelf, book, play, login, cache and chapter-sheet screens are exercised at
390 × 844 and 1280 × 900. Transport, range seek, hold-to-skip, theme persistence,
session validation, offline recovery and chapter-cache transactions have client
and server regression tests.

## Production deploy

```bash
pnpm build
rsync -az --delete dist/ eustace@berry:~/shelf/clam-web/dist/
rsync -az ../shelf/ eustace@berry:~/shelf/app/
ssh eustace@berry 'sudo systemctl restart shelf'
```

The public URL is `https://clam.flowwing.uk`; `clam-web.service` is retired.

## Stack status

```
React 19 + Vite 8 + TypeScript + Tailwind 4     follows pi-frame
Node API + filesystem library                   deliberate at this stage
```

The PWA is the accepted client. The Node service owns auth, library metadata,
progress, subtitles, covers and range-streamed audio.


## Playback source

The web client streams the split chapter files (`/audio/<book>/<index>`). They
are small, range-friendly and work through the public Cloudflare Tunnel.

The continuous `book.m4b` remains in the library for the lock-screen work, but is
not the default playback source. It is available only for diagnostics with
`?continuous=1`. The public Tunnel does not reliably serve the single 600 MB MP4,
which produced a player that appeared and then disappeared.

HLS is now packaged for HP1. Safari/iOS uses the native HLS playlist
(`/hls/<book>/book.m3u8`); desktop Chromium keeps split chapters. Other books
continue on split chapters until their HLS trees are built. Short segments let
iOS advance through chapters while locked without one large response. If HLS
fails, the player switches to the network split chapter at the same chapter
position; offline, it uses the cached split chapter.

## PWA, system theme and chapter cache

The new client is a PWA:

```
manifest.webmanifest   standalone, Clam icon, 192/512 + Apple touch icon
sw.js                  app shell, /api/books and /__auth/me network-first
                       cover images and hashed assets cache-first
theme                  default follows prefers-color-scheme; Auto returns to it
chapter cache          IndexedDB, split chapter files, 3 slots, oldest evicted
```

The service worker registers on the HTTPS Cloudflare origin. There is no
plain-HTTP production client.

### Chapter cache

Each chapter row (Book page and chapter sheet) has a download control. The
first three chapters are stored as split chapter files in IndexedDB; a fourth
download opens a prompt naming the oldest cached chapter before replacing it.
Cached chapters are used when the browser is offline or HLS/network playback fails.
Online Safari playback uses HLS when packaged; other clients use split chapters.

```
key          bookId:chapterIndex
limit        3 chapters, global across the library
source       /audio/:bookId/:chapterIndex (split file)
offline      blob URL via media-src blob:
online       ignored; continuous file remains the playback source
```

The service worker caches `/__auth/me` and `/api/books` separately from the public
app shell, so an app opened online can boot offline until its cached session
expires. Login and logout clear private responses; explicit logout blocks offline
session restoration even if the logout request cannot reach the server.
Progress writes are local while offline; the next
online save catches the server up. Listening-time deltas are not queued.

If connectivity is lost during continuous playback, the player switches to the
cached split chapter at the current chapter-relative position. This also recovers
from a media error when the browser still reports that it is online. A missing
cached chapter produces a reconnect message if playback fails. Split-file chapter
advancement still depends on JavaScript and has the iOS lock-screen limitation
described above.

Cache downloads reserve one of the three slots immediately. Replacing a chapter
is atomic: a failed write keeps the existing chapter, and storage/download errors
are shown in a dialog. The storage transaction also enforces capacity across tabs.


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


## Automated checks

```bash
pnpm build          # type-check application/tests and build production assets
pnpm test           # progress, cache transactions, playback recovery, accessibility
pnpm test:server    # service-worker lifecycle and real shelf/proxy/Vite integration
# from the repository root:
python3 -m unittest discover -s tests -v
```

The transport buttons support ordinary clicks, Enter and Space for a 15-second
seek. Shift+Enter skips a chapter; pointer users can still hold for the same action.
The hidden transcript is inert until Transcript mode is opened.

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

In the transcript, every word is a button. Tapping one fills a thin persistent
banner below the transcript with the original dictionary form and its English
translation, plus a saved-word star. Known words use the cached German wordbook
(`public/wordbook/`), and unknown words fall back to `/api/word/translate`.
Word taps never seek. The banner keeps one text line of space above the
transcript header.

In the Play screen, the `Transcript` / `Cover` button at the left end of the
chapter row switches the stage. Tapping the cover is no longer a control. If
the current chapter has no `subtitleUrl`, the button says `Description` and opens
the existing description placeholder. Cues are chapter-relative so they work with the continuous
`book.m4b`; tapping a cue seeks the player. The service worker caches
`/subtitle/` for offline use.
