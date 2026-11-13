import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';

/**
 * Serves the built web client from `root`, so the browser reaches the API,
 * sync and the app itself at one origin. Other page paths get the app's page.
 */
export function serveWebClient(http: Hono<any>, root: string) {
  const file = serveStatic({ root });
  const page = serveStatic({ root, path: 'index.html' });
  http.get('*', async (c, next) => {
    const assets = c.req.path.startsWith('/assets/');
    const response = (await file(c, async () => {})) ?? (assets ? undefined : await page(c, async () => {}));
    if (!response) return next();
    const html = response.headers.get('content-type')?.startsWith('text/html');
    response.headers.set('Cache-Control', html ? 'no-cache' : 'public, max-age=31536000, immutable');
    return response;
  });
}
