import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

if (existsSync('../.env')) process.loadEnvFile('../.env');
const { ports } = await import('./support/env.ts');

// Expects Postgres and PowerSync to be running already (`pnpm dev:infra`).
// Starts the app server, the web dev server, and the network switch in front
// of the web dev server that the browser talks to.
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
      command: 'node ../server/src/main.ts',
      url: `http://127.0.0.1:${ports.server}/api/health`,
      env: { PORT: String(ports.server), HOST: process.env.HOST ?? '0.0.0.0' },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @salamifocus/web exec vite',
      url: `http://127.0.0.1:${ports.webDev}`,
      env: { WEB_PORT: String(ports.webDev), WEB_HMR: 'false', SALAMIFOCUS_SERVER_URL: `http://127.0.0.1:${ports.server}` },
      reuseExistingServer: false,
    },
    {
      command: `node support/network-switch.ts --listen ${ports.web} --control ${ports.switchControl} --target http://127.0.0.1:${ports.webDev} --only /api,/powersync`,
      url: `http://127.0.0.1:${ports.switchControl}/`,
      reuseExistingServer: false,
    },
  ],
});
