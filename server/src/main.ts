import { serve } from '@hono/node-server';
import { createApplication } from './application/index.ts';
import { createSigner, loadSigningKey } from './auth/signing.ts';
import { loadConfig } from './config.ts';
import { connect, migrate } from './db.ts';
import { createHttpApp } from './http/app.ts';

const config = loadConfig();
const sql = connect(config.databaseUrl);
const applied = await migrate(sql);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);

const signer = await createSigner(await loadSigningKey(config), config.powersyncAudience);
const http = createHttpApp({
  application: createApplication({ sql }),
  sql,
  signer,
  ownerPasswordHash: config.ownerPasswordHash,
  powersyncUrl: config.powersyncUrl,
  webRoot: config.webRoot,
});

const server = serve({ fetch: http.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`salamifocus server listening on http://${info.address}:${info.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void sql.end({ timeout: 5 }).then(() => process.exit(0));
  });
}
