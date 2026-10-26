# berry deployment

Shelf is moving to the same shape as the other Pi apps:

| App | Unit | Bind | Exposure |
|---|---|---|---|
| bookshelf | system | `127.0.0.1:8080` | `tailscale serve` → `berry:8080` |
| timetable | system | `127.0.0.1:8000/8001` | serve + direct IP |
| flowwing | system | `127.0.0.1:3100` | `tailscale serve` → `berry:3100` |
| **shelf** | **system** | **`127.0.0.1:13378`** | **`tailscale serve` → `berry:13378`** |

The migration is complete: Shelf runs as the system unit on `127.0.0.1:13378`,
published by `tailscale serve` at `http://berry:13378`.

## Layout

```
/home/eustace/shelf/
  app/          server.mjs + public/
  data/         session-secret, progress.json, listening.json,
                shelves.json, layout.json
  bin/          ffmpeg + ffprobe
  library/      Author/Title/cover.jpg, metadata.json, chapters/01.m4b…
```

## Service

`/etc/systemd/system/shelf.service`, installed from `shelf.service` in this
directory. It is loopback-only behind Tailscale, like bookshelf and flowwing.

There is no user-level `shelf.service`. The system unit is the only owner of
`127.0.0.1:13378`; a duplicate user unit used to race it at boot and is removed.

## Deploying code

```bash
rsync -az --delete shelf/ eustace@berry:~/shelf/app/
ssh eustace@berry 'sudo systemctl restart shelf'
curl -fsS http://127.0.0.1:13378/health
```

## Logs

```bash
ssh eustace@berry 'sudo systemctl status shelf'
ssh eustace@berry 'sudo journalctl -u shelf -f'
```

## Old Audiobookshelf

`audiobookshelf.service` is stopped and disabled. Its files remain under
`~/audiobookshelf`; port 13378 belongs to Shelf.

## Why there is no build step

`server.mjs` uses only Node's standard library. `public/` is plain CSS and JS. A deploy
is an rsync and a restart, so the Pi never needs npm or a toolchain.
