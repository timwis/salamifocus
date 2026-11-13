import type { Context } from 'hono';

const hopByHop = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host', 'content-length'];

/**
 * Forwards client sync traffic to the PowerSync service, so both clients
 * need only one server address. Responses are streamed through unbuffered.
 */
export function proxyTo(target: string, prefix: string) {
  return async (c: Context) => {
    const incoming = new URL(c.req.url);
    const url = new URL(incoming.pathname.slice(prefix.length) + incoming.search, target);
    const headers = new Headers(c.req.raw.headers);
    for (const name of hopByHop) headers.delete(name);
    headers.delete('accept-encoding');

    const hasBody = !['GET', 'HEAD'].includes(c.req.method);
    let upstream: Response;
    try {
      upstream = await fetch(url, {
        method: c.req.method,
        headers,
        body: hasBody ? c.req.raw.body : null,
        signal: c.req.raw.signal,
        redirect: 'manual',
        ...(hasBody ? { duplex: 'half' } : {}),
      } as RequestInit);
    } catch {
      return c.json({ error: 'The sync service is unavailable.' }, 502);
    }

    const responseHeaders = new Headers(upstream.headers);
    for (const name of [...hopByHop, 'content-encoding']) responseHeaders.delete(name);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  };
}
