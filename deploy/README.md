# berry deployment

Clam is two daemons:

| Unit | Bind | Job |
|---|---|---|
| `shelf.service` (system) | `127.0.0.1:13378` | PWA, auth, API, covers, subtitles, audio, HLS |
| `cloudflared.service` (system) | outbound | public `https://clam.flowwing.uk` |

`clam-web` and the two queue services are disabled. Their code and data remain,
but they are not part of the running system.

## Layout

```
/home/eustace/shelf/
  app/          server.mjs
  data/         session-secret, progress.json, listening.json, shelves, layout
  bin/          ffmpeg + ffprobe
  library/      Author/Title/cover.jpg, metadata.json, chapters/, hls/
  clam-web/
    dist/       built React PWA, served by shelf
    server/     legacy dev proxy, not a production unit
```

## Deploy

```bash
rsync -az --delete shelf/ eustace@berry:~/shelf/app/
rsync -az --delete clam-web/dist/ eustace@berry:~/shelf/clam-web/dist/
ssh eustace@berry 'sudo systemctl restart shelf'
```

The system unit sets `CLAM_WEB_DIR=/home/eustace/shelf/clam-web/dist` and
`SHELF_PORT=13378`. Cloudflare Tunnel routes `clam.flowwing.uk` to
`http://127.0.0.1:13378`.

## Retired units

```bash
systemctl --user disable --now clam-web clam-ingest clam-transcribe
```

Ingest and transcription remain runnable as explicit jobs; they are no longer
always-on services.
