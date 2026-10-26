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
