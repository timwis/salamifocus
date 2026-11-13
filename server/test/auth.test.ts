import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { createHarness, createHttpHarness, testPassword, type Harness } from './harness.ts';

let h: Harness;
let api: Awaited<ReturnType<typeof createHttpHarness>>;
before(async () => {
  h = await createHarness();
  api = await createHttpHarness(h);
});
after(() => h.close());

describe('signing in', () => {
  it('refuses the wrong password', async () => {
    const response = await api.request('/api/auth/sign-in', { body: { password: 'guess', client: 'web' } });
    assert.equal(response.status, 401);
  });

  it('gives a session token for the right password', async () => {
    const response = await api.request('/api/auth/sign-in', { body: { password: testPassword, client: 'web' } });
    assert.equal(response.status, 200);
    const { token } = (await response.json()) as { token: string };

    const session = await api.request('/api/auth/session', { token });
    assert.deepEqual(await session.json(), { client: 'web' });
  });

  it('stops accepting a session after signing out', async () => {
    const token = await api.signIn();
    assert.equal((await api.request('/api/auth/sign-out', { method: 'POST', token })).status, 204);
    assert.equal((await api.request('/api/auth/session', { token })).status, 401);
  });

  it('requires a session for the sync endpoints', async () => {
    assert.equal((await api.request('/api/sync/token', { method: 'POST' })).status, 401);
    assert.equal((await api.request('/api/sync/upload', { body: { entries: [] } })).status, 401);
    assert.equal((await api.request('/api/sync/upload', { body: { entries: [] }, token: 'made-up' })).status, 401);
  });
});

describe('repeated wrong passwords', () => {
  const limit = { failures: 3, windowMs: 15 * 60 * 1000 };
  const signIn = (limited: typeof api, password: string) =>
    limited.request('/api/auth/sign-in', { body: { password, client: 'web' } });

  it('stop all sign-ins for a while, then let the owner back in', async () => {
    const limited = await createHttpHarness(h, { signInLimit: limit });
    for (let i = 0; i < 3; i++) assert.equal((await signIn(limited, 'guess')).status, 401);

    const refused = await signIn(limited, testPassword);
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get('retry-after'), String(15 * 60));
    assert.match(((await refused.json()) as { error: string }).error, /Too many wrong passwords/);

    h.clock.advance(limit.windowMs + 1);
    assert.equal((await signIn(limited, testPassword)).status, 200);
  });

  it('do not count successful sign-ins against the limit', async () => {
    const limited = await createHttpHarness(h, { signInLimit: limit });
    for (let i = 0; i < 5; i++) assert.equal((await signIn(limited, testPassword)).status, 200);
    assert.equal((await signIn(limited, 'guess')).status, 401);
  });

  it('are limited even when sent all at once', async () => {
    const limited = await createHttpHarness(h, { signInLimit: limit });
    const statuses = (await Promise.all(Array.from({ length: 10 }, () => signIn(limited, 'guess')))).map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 401).length, 3);
    assert.equal(statuses.filter((s) => s === 429).length, 7);
  });
});

describe('sync credentials', () => {
  it('are short-lived tokens the sync service can verify from the published keys', async () => {
    const token = await api.signIn();
    const response = await api.request('/api/sync/token', { method: 'POST', token });
    const { token: jwt } = (await response.json()) as { token: string };
    const jwks = await (await api.request('/.well-known/jwks.json')).json();

    const { payload, protectedHeader } = await jwtVerify(jwt, createLocalJWKSet(jwks as never), {
      audience: 'powersync',
      currentDate: h.clock.now(),
    });

    assert.equal(payload.sub, 'owner');
    assert.ok(protectedHeader.kid);
    assert.ok(payload.exp! - payload.iat! <= 60 * 60);
  });
});
