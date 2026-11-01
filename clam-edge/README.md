# Clam edge proxy

Stable `workers.dev` URL in front of the Pi's public Clam origin.

```
https://clam.penghaoxi030616.workers.dev  →  https://berry.taild3bc35.ts.net
```

It forwards cookies, methods, Range headers, audio, HLS playlists/segments and
Set-Cookie responses. The Pi remains the source of truth; the Worker only proxies.

## Deploy

```bash
cd clam-edge
npx wrangler login
npx wrangler deploy
```

Set a different upstream with:

```bash
npx wrangler deploy --var CLAM_ORIGIN:https://your-origin.example
```

The URL is `https://clam.penghaoxi030616.workers.dev` if that workers.dev
subdomain is active. Sign in there; cookies are scoped to the Worker hostname.
