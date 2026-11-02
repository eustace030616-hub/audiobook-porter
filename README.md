# Clam

A single-user audiobook shelf with a React PWA, one Node service, and a Pi-side
library. One process serves the PWA, API, covers, transcripts, Range audio and
HLS; Cloudflare Tunnel exposes it at `https://clam.flowwing.uk`.

## What is running

```
Mac                                              berry
┌─────────────────────────────┐     rsync       ┌──────────────────────────────┐
│ m4b + cover + metadata.json │ ──────────────▶ │ Clam                         │
└─────────────────────────────┘                 │ 127.0.0.1:13378              │
                                                │ PWA · auth · API · audio/HLS │
                                                │ ~/shelf/library               │
                                                └──────────────┬───────────────┘
                                                               │ cloudflared
                                                    https://clam.flowwing.uk
```

| | |
|---|---|
| UI | `https://clam.flowwing.uk` |
| API | same origin |
| Login | Flowwing account |
| Library | `/home/eustace/shelf/library` |
| Daemon | `shelf.service` |
| Public ingress | `cloudflared.service` |

The Flowwing password is never stored on the Pi. The API keeps only a signed
session cookie.

## Client

The React client is the only client. It provides:

- home, shelf, book, play and cache screens;
- split chapter files for reliable public streaming and fallback; HLS for lock-screen playback (HP1 packaged first);
- chapter-relative progress and a three-slot IndexedDB chapter cache;
- EPUB-backed transcripts, one sentence per row, with timestamp jump buttons;
- a word lookup card with German wordbook data and a 3-second dismissal animation;
- system-following theme, PWA manifest and service worker;
- private-cache cleanup and session expiry handling.

Build and run locally:

```bash
cd clam-web
pnpm build
cd ..
CLAM_WEB_DIR=clam-web/dist SHELF_PORT=13379 SHELF_LIBRARY=... SHELF_DATA=... \
  node shelf/server.mjs
```

The single server needs the built `dist/`, the library and the data directory.
Vite remains a development tool:

```bash
cd clam-web
pnpm dev
```

## Library

```
~/shelf/library/
  J.K. Rowling/
    Harry Potter und der Orden des Phönix/
      book.m4b
      chapters/01.m4b … 40.m4b
      subtitles/10.json
      cover.jpg
      metadata.json
```

Each chapter is a small M4B under `chapters/`; `book.m4b` is the continuous
playback source. `continuous_file` in `metadata.json` points at it. The split
files support offline chapter playback and cache recovery.

Split an existing book without re-encoding:

```bash
python3 scripts/split_book.py --library ~/shelf/library --book "<book-folder>"
python3 scripts/make_continuous.py --library ~/shelf/library --ffmpeg ~/shelf/bin/ffmpeg
```

## Authentication

Clam delegates login to Flowwing. The API posts the username and password to
`CLAM_AUTH_URL` (default `http://127.0.0.1:3100/api/auth/login`) and keeps a
signed session cookie. The same process validates the cookie for API, media and
PWA requests.

## Deploy

The full deployment notes are in [`deploy/README.md`](deploy/README.md). The
short version:

```bash
rsync -az --delete shelf/ eustace@berry:~/shelf/app/
ssh eustace@berry 'sudo systemctl restart shelf'

rsync -az --delete clam-web/dist/ eustace@berry:~/shelf/clam-web/dist/
```

Cloudflare Tunnel publishes `https://clam.flowwing.uk`.

## Tests

```bash
cd clam-web
pnpm build
pnpm test
pnpm test:server

cd ..
python3 -m unittest discover -s tests -v
```

`clam-web/tests` covers progress ordering, chapter-cache transactions, offline
playback recovery, auth/session behavior and accessible transport controls.
`tests/web-server.test.mjs` starts the legacy dev proxy against the real shelf
service and fixture library.
