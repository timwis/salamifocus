import { defineConfig, devices } from '@playwright/test';
import { ports, serverUrl } from './support/env.ts';

// Run through `pnpm test:e2e:web`, which first starts a throwaway stack with
// its own app server. This starts the web dev server pointed at that server,
// and the network switch in front of it that the browser talks to.
export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${ports.web}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @salamifocus/web exec vite',
      url: `http://127.0.0.1:${ports.webDev}`,
      env: { WEB_PORT: String(ports.webDev), WEB_HMR: 'false', SALAMIFOCUS_SERVER_URL: serverUrl },
      reuseExistingServer: false,
    },
    {
      command: `node support/network-switch.ts --listen ${ports.web} --control ${ports.webSwitchControl} --target http://127.0.0.1:${ports.webDev} --only /api,/powersync`,
      url: `http://127.0.0.1:${ports.webSwitchControl}/`,
      reuseExistingServer: false,
    },
  ],
});
