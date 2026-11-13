// The end-to-end tests run against their own throwaway stack (see stack.ts),
// on ports that do not clash with development.
export const ports = {
  postgres: 54339,
  powersync: 8090,
  server: 3101,
  /** Where the browser loads the web client: the network switch. */
  web: 5174,
  webDev: 5175,
  webSwitchControl: 5176,
  /** The network switch between the Android emulator and the server. */
  androidSwitch: 3199,
  androidSwitchControl: 3198,
};

export const serverUrl = `http://127.0.0.1:${ports.server}`;
export const databaseUrl = `postgres://salamifocus:salamifocus@127.0.0.1:${ports.postgres}/salamifocus`;
export const password = 'salami';
