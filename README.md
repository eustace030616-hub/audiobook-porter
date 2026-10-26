# Clam

One login, one shelf, series shelves, and an audio player. Running natively on `berry`
at **<http://berry:13378>**.

Audiobookshelf is stopped and disabled; its configuration pages are no longer exposed.
There is no Docker.

## What is running

```
Mac                                                       berry
┌──────────────────────────────┐        rsync             ┌───────────────────────────┐
│ m4b + cover + metadata.json  │ ───────────────────────▶ │ Clam                      │
│ (crude port, for now)        │                          │ Node 24 · systemd system  │
└──────────────────────────────┘                          │ 127.0.0.1:13378           │
                                                           │ ~/shelf/library           │
                                                           └───────────────────────────┘
                                                                    tailscale serve → berry:13378
```

| | |
|---|---|
| UI | `http://berry:13378` |
| Access | tailnet only, via `tailscale serve` |
| Login | Flowwing account (same credentials as Bookreader) |
| Library | `/home/eustace/shelf/library` |
| Service | `shelf.service` (systemd system, loopback, enabled at boot) |
| Old UI | `audiobookshelf.service` stopped and disabled |

Sign in with your Flowwing username and password. Clam keeps its own session cookie;
the Flowwing password is never stored on the Pi. After login, the home page shows
**Your shelf**, **Continue listening**, and the current week’s listening hours.
The books live on `/shelf`.

## The screens

```
/login         Flowwing username + password
/              home: continue listening + weekly stats
/shelf         all series shelves and books
/book/:id      cover, details, chapters
/play/:id      now-playing page
/audio/:id     HTTP range streaming
```

The home, shelf, book, and play screens are one small client-side app so the audio
element keeps playing while you move between them. A fixed mini-player banner
sits on every non-play page: with no selected book it is a placeholder that opens
the shelf; with a book it shows chapter progress and transport controls.

Everything else is 404. No `/config`, no `/settings`, no library administration.

## How books are arranged

```
~/shelf/library/
  J.K. Rowling/
    Harry Potter und der Orden des Phönix/
      chapters/
        01.m4b
        02.m4b
        …
        40.m4b
      cover.jpg
      metadata.json
```

`metadata.json` is what the UI reads. A downloaded Audible book will have this written
by the future converter; for now a book is ported with the fields below.

```json
{
  "title": "Harry Potter und der Orden des Phönix",
  "authors": ["J.K. Rowling"],
  "narrators": [],
  "series_title": "Harry Potter",
  "series_sequence": "5",
  "description": "…",
  "id": "6bbe813318ce",
  "split": true,
  "chapters": [
    {
      "title": "Vorspann",
      "start": 0,
      "end": 41180,
      "duration_ms": 41192,
      "file": "chapters/01.m4b"
    }
  ],
  "duration_ms": 124654748,
  "ribbon": "#d2b973"
}
```

- Shelf grouping is `shelf_id` when set, otherwise `series_title`. The cover
  always shows the series; moving a book between shelves does not rewrite it.
- Books without a series go on a `Standalone` shelf.
- On `/shelf`, **Arrange** is the editing mode: click a book cover to edit its
  metadata and shelf; **Edit** beside a shelf title renames the shelf; **New
  shelf** creates an empty shelf; arrows reorder shelves and books.
- `ribbon` is the book's accent strip. It comes from the cover's main colour.
- Each chapter is a separate small M4B under `chapters/`. The huge full-book
  index is gone; a chapter starts in seconds and its progress bar is chapter-sized.
- To split another book without re-encoding:
  `python3 scripts/split_book.py --library ~/shelf/library --book <book-folder>`
- On the home page, the **Edit** button in a shelf header changes only the shelf
  label. Book covers and `series_title` metadata stay unchanged. Labels live in
  `~/shelf/data/shelves.json`; custom shelf order lives in `layout.json`.
- `cover.jpg` is optional and supplies the ribbon fallback. A book can opt into
  the publisher image with `"cover_image": true`; its natural aspect ratio is
  used, so the square Harry Potter 1 cover stays square.

### The play page

The play page follows the iPhone music-player shape rather than a web page with
an embedded player:

- large typographic cover
- chapter title, with the book as the context line
- seekable **chapter** progress bar with elapsed and remaining time
- back to the book page
- chapter list button opening a bottom sheet
- previous/next buttons: tap = ±15 seconds, hold = previous/next chapter
- play/pause

The mini-player uses the same gesture model.

Split chapter files are still used for fast first start. For continuous playback — especially
while an iPhone is locked — each book also has a concatenated `book.m4b`:

```bash
python3 scripts/make_continuous.py --library ~/shelf/library --ffmpeg ~/shelf/bin/ffmpeg
```

The API exposes `continuousUrl`; the new client plays that one file and maps chapter boundaries onto
it. The old client keeps using `chapters/` until it is retired.

Playback position is written to `localStorage` while playing and to
`~/shelf/data/progress.json` every few seconds and on page close. Listening time
is accumulated in `~/shelf/data/listening.json` and shown as the current week’s
hours on home. The book page
and play page restore it after a refresh or a new browser session. The audio is
served with `+faststart`, so the player can begin without downloading to the end
of a 1.9 GB file.

## The cover

By default the cover is not the publisher's image. It is a black rectangle with white type:

```
┌──────────────┐
│              │
│              │
│              │
│ Harry Potter │  ← series, larger, bottom-left
│ und der      │  ← title, smaller, just beneath
│ Orden des    │
│ Phönix       │
└──────────────┘
  ↑ a ribbon in the book cover's colour
```

This is deliberate: one consistent shelf, no mixed cover artwork, no white boxes.

## Porting a book by hand, for now

The CLI is deliberately paused. For this stage, the pipeline is four crude commands.

```bash
BOOK="$HOME/Desktop/Some Book.m4b"
AUTHOR="J.K. Rowling"
TITLE="Some Book"
SERIES="Harry Potter"
SEQ="5"
REMOTE="/home/eustace/shelf/library/$AUTHOR/$TITLE"

# 1. Make the remote folder.
ssh eustace@berry "mkdir -p \"$REMOTE\""

# 2. Extract a cover and write metadata on the Mac.
#    (See examples/metadata.json for the shape.)
ffmpeg -i "$BOOK" -map 0:v:0 -frames:v 1 -c:v mjpeg /tmp/cover.jpg

# 3. Send the audio, cover, and metadata.
rsync -av --partial "$BOOK" "eustace@berry:\"$REMOTE/$TITLE.m4b\""
rsync -av /tmp/cover.jpg /tmp/metadata.json "eustace@berry:\"$REMOTE/\""

# 4. Refresh the shelf in the browser.
```

The UI scans `metadata.json` recursively and updates on the next request. No server
restart and no scan button.

`.m4b` is the expected file. The server will also serve `.m4a` and `.mp3`, but the
one-file-per-book layout and chapters are designed around `.m4b`.

## Authentication

Clam delegates login to Flowwing. It posts the username and password to
`http://127.0.0.1:3100/api/auth/login` (override with `CLAM_AUTH_URL`) and keeps only
a signed session cookie. The Flowwing password is never written to disk.

```
/home/eustace/shelf/data/session-secret   0600, generated on first start
```

Sessions last 30 days. The cookie is `HttpOnly` and `SameSite=Lax`. Use the account
menu → **Log out** to clear it. There is no local password, no `/setup` screen and no
`auth.json`; resetting the password happens in Flowwing.

## Operating it

```bash
ssh eustace@berry 'sudo systemctl status shelf'
ssh eustace@berry 'sudo systemctl restart shelf'
ssh eustace@berry 'sudo journalctl -u shelf -f'
```

Redeploy the UI after changing `shelf/`:

```bash
rsync -az --delete shelf/ eustace@berry:~/shelf/app/
ssh eustace@berry 'sudo systemctl restart shelf'
```

The app has no build step and no npm dependencies. Node 24 serves the files directly.

Shelf runs as a system unit on `127.0.0.1:13378` and is published by
`tailscale serve` at `http://berry:13378`.

## What exists in this checkout

| | |
|---|---|
| `shelf/server.mjs` | auth, shelves, book page, range streaming |
| `shelf/public/style.css` | Swiss-style shelf and cover system |
| `shelf/public/player.js` | play/pause, seek, resume, chapters |
| `deploy/shelf.service` | the unit running on berry |
| `porter/` | earlier CLI work, paused for this stage |
| `tests/` | Python conversion tests from the earlier stage |

## Next, and deliberately not now

The later CLI will live on the Pi, not the Mac:

```
porter download → porter convert → porter port
```

All three jobs should run on berry so the Mac never has to hold the 1.8 GB source.
This stage is only the UI and the first manually ported book.


## New client: PWA and cached chapters

The React client at `:13379` carries a PWA manifest, service worker, system-theme
auto mode and a three-slot chapter cache. Full offline support needs HTTPS; on
the Pi:

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:13379
```

Open `https://berry.taild3bc35.ts.net/`. See `clam-web/README.md` for the cache
semantics and the old `:13378` boundary.
