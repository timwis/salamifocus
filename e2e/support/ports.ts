import { createServer, type Server } from 'node:net';

// Each end-to-end run takes free ports from the operating system, so runs in
// different checkouts of the repository can happen at the same time. The
// runner puts them in this environment variable, which the processes it
// starts (Playwright and its workers, the dev server) inherit, and env.ts
// reads them from it.
export const portsVariable = 'SALAMIFOCUS_E2E_PORTS';

const names = [
  'postgres',
  'powersync',
  'server',
  'web',
  'webDev',
  'webSwitchControl',
  'androidSwitch',
  'androidSwitchControl',
] as const;

export type Ports = Record<(typeof names)[number], number>;

function listen(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer().on('error', reject);
    server.listen(0, () => resolve(server));
  });
}

/** Picks a free port for each part of the stack and records them for env.ts. */
export async function allocatePorts() {
  // Hold every port open until all are chosen, so none is handed out twice.
  const servers = await Promise.all(names.map(listen));
  const ports = Object.fromEntries(
    servers.map((server, i) => [names[i], (server.address() as { port: number }).port]),
  ) as Ports;
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  process.env[portsVariable] = JSON.stringify(ports);
}
