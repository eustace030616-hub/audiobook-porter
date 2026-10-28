# Clam

A single-user audiobook shelf with a React PWA, a small Node API, and a Pi-side
library. The old vanilla client has been removed; the Node service is now the
API/audio backend only.

## What is running

```
Mac                                              berry
┌─────────────────────────────┐     rsync       ┌──────────────────────────────┐
│ m4b + cover + metadata.json │ ──────────────▶ │ Clam API                      │
└─────────────────────────────┘                 │ 127.0.0.1:13378               │
                                                │ auth · library · range audio  │
                                                │ ~/shelf/library               │
                                                └──────────────┬───────────────┘
                                                               │ proxy
                                                ┌──────────────▼───────────────┐
                                                │ Clam PWA                     │
                                                │ 127.0.0.1:13379              │
                                                │ React · service worker       │
                                                └──────────────┬───────────────┘
                                                               │
                                                    https://berry.taild3bc35.ts.net/
```

| | |
|---|---|
| UI | `http://berry:13379`, or the HTTPS PWA URL above |
| API | `http://berry:13378` — not a UI |
| Login | Flowwing account, same credentials as Bookreader |
| Library | `/home/eustace/shelf/library` |
| API service | `shelf.service` (systemd system) |
| UI service | `clam-web.service` (systemd user, linger enabled) |

The Flowwing password is never stored on the Pi. The API keeps only a signed
session cookie.

## Client

The React client is the only client. It provides:

- home, shelf, book, play and cache screens;
- one continuous `book.m4b` per book for iOS lock-screen playback;
- chapter-relative progress and a three-slot IndexedDB chapter cache;
- EPUB-backed transcripts, one sentence per row, with timestamp jump buttons;
- a word lookup card with German wordbook data and a 3-second dismissal animation;
- system-following theme, PWA manifest and service worker;
- private-cache cleanup and session expiry handling.

Build and run locally:

```bash
cd clam-web
pnpm install
pnpm build
CLAM_ORIGIN=http://127.0.0.1:13378 \
CLAM_WEB_PORT=13379 \
node server/server.mjs
```

The API must be running on `13378`. Vite development uses the same proxy:

```bash
pnpm start   # API proxy on 13379
pnpm dev     # Vite on 5173
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
signed session cookie. The proxy validates that cookie through `/api/session`
on every auth check. Deploy `shelf/` and `clam-web/` together when changing this
contract.

## Deploy

The full deployment notes are in [`deploy/README.md`](deploy/README.md). The
short version:

```bash
rsync -az --delete shelf/ eustace@berry:~/shelf/app/
ssh eustace@berry 'sudo systemctl restart shelf'

rsync -az --delete clam-web/dist/ eustace@berry:~/shelf/clam-web/dist/
rsync -az clam-web/server/ eustace@berry:~/shelf/clam-web/server/
ssh eustace@berry 'systemctl --user restart clam-web'
```

PWA/offline support needs HTTPS:

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:13379
```

Then open `https://berry.taild3bc35.ts.net/`.

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
`tests/web-server.test.mjs` starts the real shelf and proxy services against a
fixture library.
