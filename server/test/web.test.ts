import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createSigner, generateSigningKeyPem } from '../src/auth/signing.ts';
import { createHttpApp } from '../src/http/app.ts';

let root: string;
let http: ReturnType<typeof createHttpApp>;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'salamifocus-web-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>salamifocus</title>');
  await writeFile(join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
  await writeFile(join(root, 'assets', 'wa-sqlite-abc123.wasm'), new Uint8Array([0, 97, 115, 109]));
  http = createHttpApp({
    application: null as never,
    sql: null as never,
    signer: await createSigner(generateSigningKeyPem(), 'powersync'),
    ownerPasswordHash: 'unused',
    powersyncUrl: 'http://127.0.0.1:9',
    webRoot: root,
  });
});
after(() => rm(root, { recursive: true, force: true }));

describe('the web client', () => {
  it('is served at the root, and revalidated so a deploy takes effect', async () => {
    const response = await http.request('/');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<title>salamifocus<\/title>/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
  });

  it('serves its hashed assets with long-lived caching and the right types', async () => {
    const script = await http.request('/assets/index-abc123.js');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type') ?? '', /javascript/);
    assert.match(script.headers.get('cache-control') ?? '', /immutable/);

    const wasm = await http.request('/assets/wa-sqlite-abc123.wasm');
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  });

  it('answers other page paths with the app page, but not missing assets or API routes', async () => {
    assert.match(await (await http.request('/inbox')).text(), /salamifocus/);
    assert.equal((await http.request('/assets/gone-123.js')).status, 404);
    const api = await http.request('/api/nothing-here');
    assert.equal(api.status, 404);
    assert.deepEqual(await api.json(), { error: 'Not found.' });
  });

  it('still answers the API', async () => {
    assert.deepEqual(await (await http.request('/api/health')).json(), { ok: true });
  });
});
