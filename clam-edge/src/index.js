const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
])

function rewriteLocation(value, origin, requestUrl) {
  if (!value) return value
  try {
    const target = new URL(value, origin)
    if (target.origin === origin) return new URL(target.pathname + target.search, requestUrl.origin).toString()
  } catch {}
  return value
}

export default {
  async fetch(request, env) {
    const origin = (env.CLAM_ORIGIN || 'https://berry.taild3bc35.ts.net').replace(/\/$/, '')
    const incoming = new URL(request.url)
    const target = new URL(incoming.pathname + incoming.search, origin)
    const headers = new Headers()
    for (const [key, value] of request.headers) {
      if (!HOP_BY_HOP.has(key.toLowerCase())) headers.append(key, value)
    }
    // The edge Worker is the browser's origin; the upstream proxy must see its
    // own hostname and the original cookies.
    headers.set('x-forwarded-host', incoming.host)

    let upstream
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual',
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: 'clam origin unavailable', detail: String(error) }), {
        status: 502,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }

    const out = new Headers()
    for (const [key, value] of upstream.headers) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue
      out.append(key, key.toLowerCase() === 'location' ? rewriteLocation(value, origin, incoming) : value)
    }
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out })
  },
}
