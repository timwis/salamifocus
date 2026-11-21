import { portsVariable, type Ports } from './ports.ts';

// The end-to-end tests run against their own throwaway stack (see stack.ts),
// on free ports the runner picks at the start of each run (see ports.ts).
const chosen = process.env[portsVariable];
if (!chosen) {
  throw new Error('Run the end-to-end tests through `pnpm test:e2e:web` or `pnpm test:e2e:android`.');
}

/**
 * `web` is where the browser loads the web client: the network switch in
 * front of the dev server on `webDev`. `androidSwitch` is the network switch
 * between the Android emulator and the server.
 */
export const ports: Ports = JSON.parse(chosen);

export const serverUrl = `http://127.0.0.1:${ports.server}`;
export const databaseUrl = `postgres://salamifocus:salamifocus@127.0.0.1:${ports.postgres}/salamifocus`;
export const password = 'salami';
