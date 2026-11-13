export const ports = {
  server: Number(process.env.E2E_SERVER_PORT ?? 3100),
  switchControl: Number(process.env.E2E_SWITCH_CONTROL_PORT ?? 5176),
  /** Where the browser loads the web client: the network switch. */
  web: Number(process.env.E2E_WEB_PORT ?? 5174),
  webDev: Number(process.env.E2E_WEB_DEV_PORT ?? 5175),
};

export const serverUrl = `http://127.0.0.1:${ports.server}`;
export const password = process.env.SALAMIFOCUS_PASSWORD ?? 'salami';
