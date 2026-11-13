import { ports } from './env.ts';

const control = (path: string) =>
  fetch(`http://127.0.0.1:${ports.webSwitchControl}${path}`, { method: 'POST' }).then((r) => r.json());

/** Cuts the web client off from the app server, or reconnects it. */
export const network = {
  offline: () => control('/offline'),
  online: () => control('/online'),
};
