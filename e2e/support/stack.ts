import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { generateSigningKeyPem } from '../../server/src/auth/signing.ts';
import { hashPassword } from '../../server/src/auth/password.ts';
import { databaseUrl, password, ports, serverUrl } from './env.ts';

const root = new URL('../../', import.meta.url).pathname;
const compose = ['compose', '-p', 'salamifocus-e2e', '-f', 'compose.yaml', '-f', 'compose.e2e.yaml'];

function docker(...args: string[]) {
  execFileSync('docker', [...compose, ...args], { cwd: root, stdio: 'inherit' });
}

export async function waitFor(url: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fetch(url).then((r) => r.ok, () => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not come up within ${timeoutMs / 1000}s.`);
}

export function startProcess(args: string[], env: Record<string, string> = {}): ChildProcess {
  return spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'inherit'] });
}

/**
 * Starts a fresh Postgres and PowerSync, and an app server on top of them,
 * with nothing shared with development. `stop` throws all of it away.
 */
export async function startStack() {
  docker('down', '--volumes', '--remove-orphans');
  docker('up', '--detach', '--wait', 'postgres');
  const server = startProcess(['server/src/main.ts'], {
    DATABASE_URL: databaseUrl,
    POWERSYNC_URL: `http://127.0.0.1:${ports.powersync}`,
    PORT: String(ports.server),
    // The PowerSync container fetches the server's keys from outside the host's loopback.
    HOST: '0.0.0.0',
    OWNER_PASSWORD_HASH: await hashPassword(password),
    SIGNING_KEY: generateSigningKeyPem(),
  });
  await waitFor(`${serverUrl}/api/health`);
  // PowerSync can only start replicating once the server's migrations have
  // created the tables and the publication it reads from.
  docker('up', '--detach', '--wait', 'powersync');

  return {
    async stop({ failed = false } = {}) {
      server.kill();
      if (failed) docker('logs', '--tail', '100', 'powersync');
      docker('down', '--volumes', '--remove-orphans');
    },
  };
}

/** Runs a command to completion and resolves with its exit code. */
export function run(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    spawn(command, args, { cwd, stdio: 'inherit' }).on('exit', (code) => resolve(code ?? 1));
  });
}
