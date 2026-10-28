# berry deployment

Clam is two processes: a loopback Node API and a React PWA proxy.

| App | Unit | Bind | Exposure |
|---|---|---|---|
| shelf API | `shelf.service` (system) | `127.0.0.1:13378` | internal; media/auth API |
| clam-web | `clam-web.service` (user) | `127.0.0.1:13379` | `tailscale serve` / PWA |

The old vanilla client is gone. Port `13378` no longer serves a UI.

## Layout

```
/home/eustace/shelf/
  app/          server.mjs only
  data/         session-secret, progress.json, listening.json,
                shelves.json, layout.json
  bin/          ffmpeg + ffprobe
  library/      Author/Title/cover.jpg, metadata.json, chapters/01.m4b…
  clam-web/
    dist/       built React PWA
    server/     static + API proxy on 13379
```

## Deploy both services

```bash
# API
rsync -az --delete shelf/ eustace@berry:~/shelf/app/
ssh eustace@berry 'sudo systemctl restart shelf'

# PWA
rsync -az --delete clam-web/dist/ eustace@berry:~/shelf/clam-web/dist/
rsync -az clam-web/server/ eustace@berry:~/shelf/clam-web/server/
ssh eustace@berry 'systemctl --user restart clam-web'
```

Authentication is validated by the API's `/api/session` endpoint, so a PWA
deploy that lands before the API update will return `503` until the API is also
updated.

## Service notes

`shelf.service` is the system unit at `/etc/systemd/system/shelf.service`; it is
loopback-only. `clam-web.service` is a user unit with linger enabled, also
loopback-only.

PWA/offline support needs HTTPS:

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:13379
# https://berry.taild3bc35.ts.net/
```

`http://berry:13379` works as a plain-HTTP client but does not register the
service worker.

The old Audiobookshelf service remains stopped and disabled; its files are under
`~/audiobookshelf`. Port `13378` belongs to the Clam API.
