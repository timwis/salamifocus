import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Application } from '../application/index.ts';
import type { Actor } from '../application/types.ts';
import { verifyPassword } from '../auth/password.ts';
import { FailedSignIns } from '../auth/rate-limit.ts';
import { createSession, findSession, revokeSession, type Session } from '../auth/sessions.ts';
import type { Signer } from '../auth/signing.ts';
import type { Sql } from '../db.ts';
import { operationsFromCrud, type CrudEntry } from '../sync/crud.ts';
import { proxyTo } from './proxy.ts';
import { serveWebClient } from './web.ts';

export const owner: Actor = { type: 'user', id: 'owner' };

export interface HttpOptions {
  application: Application;
  sql: Sql;
  signer: Signer;
  ownerPasswordHash: string;
  powersyncUrl: string;
  /** The built web client to serve, if any. */
  webRoot?: string | null;
  clock?: () => Date;
  failedSignInDelayMs?: number;
  signInLimit?: { failures: number; windowMs: number };
}

type Env = { Variables: { session: Session } };

export function createHttpApp(options: HttpOptions) {
  const { application, sql, signer, clock = () => new Date() } = options;
  const http = new Hono<Env>();
  const { failures, windowMs } = options.signInLimit ?? { failures: 10, windowMs: 15 * 60 * 1000 };
  const failedSignIns = new FailedSignIns(failures, windowMs);

  http.get('/api/health', (c) => c.json({ ok: true }));
  http.get('/.well-known/jwks.json', (c) => c.json(signer.jwks));

  http.post('/api/auth/sign-in', async (c) => {
    const attempt = failedSignIns.attempt(clock());
    if ('retryAfterMs' in attempt) {
      c.header('Retry-After', String(Math.ceil(attempt.retryAfterMs / 1000)));
      return c.json({ error: 'Too many wrong passwords. Try again in a few minutes.' }, 429);
    }
    const body = await c.req.json().catch(() => null);
    const password = typeof body?.password === 'string' ? body.password : '';
    const client = typeof body?.client === 'string' && body.client.trim() ? body.client.trim().slice(0, 40) : 'unknown';
    if (!(await verifyPassword(password, options.ownerPasswordHash))) {
      await new Promise((resolve) => setTimeout(resolve, options.failedSignInDelayMs ?? 1000));
      return c.json({ error: 'That password is not right.' }, 401);
    }
    attempt.succeeded();
    const { token } = await createSession(sql, client, clock());
    return c.json({ token });
  });

  const requireSession = createMiddleware<Env>(async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const session = token ? await findSession(sql, token, clock()) : null;
    if (!session) return c.json({ error: 'Sign in again.' }, 401);
    c.set('session', session);
    await next();
  });

  http.get('/api/auth/session', requireSession, (c) => c.json({ client: c.get('session').client }));

  http.post('/api/auth/sign-out', requireSession, async (c) => {
    await revokeSession(sql, c.get('session').id, clock());
    return c.body(null, 204);
  });

  http.post('/api/sync/token', requireSession, async (c) => c.json(await signer.powersyncToken(owner.id, clock())));

  // Receives one client transaction from a PowerSync upload queue. Business
  // rejections are recorded and still acknowledged with 200; only transport or
  // server faults return an error, so the client retries them.
  http.post('/api/sync/upload', requireSession, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!Array.isArray(body?.entries)) return c.json({ error: 'Expected { entries: [...] }.' }, 400);
    const session = c.get('session');
    const results = [];
    for (const submitted of operationsFromCrud(body.entries as CrudEntry[])) {
      results.push(
        await application.execute({ ...submitted, actor: owner, sessionId: session.id, source: session.client }),
      );
    }
    return c.json({ results });
  });

  http.all('/powersync/*', proxyTo(options.powersyncUrl, '/powersync'));
  http.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));
  if (options.webRoot) serveWebClient(http, options.webRoot);

  return http;
}
