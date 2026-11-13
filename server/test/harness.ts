import { OperationName } from '@salamifocus/domain';
import postgres from 'postgres';
import { createApplication, type Actor, type OperationRequest } from '../src/application/index.ts';
import { connect, migrate, type Sql } from '../src/db.ts';

export const owner: Actor = { type: 'user', id: 'owner' };

export class TestClock {
  #now = new Date('2026-11-13T09:00:00.000Z');
  now = () => new Date(this.#now);
  advance(ms: number) {
    this.#now = new Date(this.#now.getTime() + ms);
  }
}

/**
 * A fresh, migrated database and the application on top of it. Tests drive
 * the application's public operations and queries and assert on what they
 * return, not on tables.
 */
export async function createHarness() {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) throw new Error('TEST_DATABASE_URL must point at a Postgres server the tests can create databases on.');
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `salamifocus_test_${crypto.randomUUID().replaceAll('-', '')}`;
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const sql = connect(url.toString());
  await migrate(sql);

  const clock = new TestClock();
  const application = createApplication({ sql, clock: clock.now });

  return {
    sql: sql as Sql,
    clock,
    application,
    async close() {
      await sql.end();
      await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;

export function captureRequest(text: string, overrides: Partial<{ taskId: string; captureId: string; capturedAt: string }> = {}): OperationRequest & { taskId: string } {
  const taskId = overrides.taskId ?? crypto.randomUUID();
  return {
    opId: crypto.randomUUID(),
    name: OperationName.captureText,
    actor: owner,
    source: 'test',
    args: { taskId, captureId: overrides.captureId ?? crypto.randomUUID(), text, capturedAt: overrides.capturedAt ?? '2026-11-13T08:30:00.000Z' },
    taskId,
  };
}

export function renameRequest(taskId: string, title: string): OperationRequest {
  return { opId: crypto.randomUUID(), name: OperationName.renameTask, actor: owner, source: 'test', args: { taskId, title } };
}

/** Any operation, as the user would perform it from a client. */
export function request(name: string, args: Record<string, unknown>): OperationRequest {
  return { opId: crypto.randomUUID(), name, actor: owner, source: 'test', args };
}

export const testPassword = 'correct horse battery staple';

/** The HTTP adapter over the harness's application, as the clients see it. */
export async function createHttpHarness(h: Harness, overrides: { signInLimit?: { failures: number; windowMs: number } } = {}) {
  const { createHttpApp } = await import('../src/http/app.ts');
  const { createSigner, generateSigningKeyPem } = await import('../src/auth/signing.ts');
  const { hashPassword } = await import('../src/auth/password.ts');
  const signer = await createSigner(generateSigningKeyPem(), 'powersync');
  const http = createHttpApp({
    application: h.application,
    sql: h.sql,
    signer,
    ownerPasswordHash: await hashPassword(testPassword),
    powersyncUrl: 'http://127.0.0.1:9',
    clock: h.clock.now,
    failedSignInDelayMs: 0,
    ...overrides,
  });

  const request = (path: string, init: { method?: string; body?: unknown; token?: string } = {}) =>
    http.request(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': 'application/json',
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  const signIn = async (client = 'test-device') => {
    const response = await request('/api/auth/sign-in', { body: { password: testPassword, client } });
    return ((await response.json()) as { token: string }).token;
  };

  return { http, signer, request, signIn };
}
