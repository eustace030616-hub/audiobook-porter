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
